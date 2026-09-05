import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { Keypair, TransactionBuilder, Address, nativeToScVal } from "@stellar/stellar-sdk";
import { getStatus, getCommitment } from "../src/stellar/client.js";
import { deployContractInstance, initializeArgs } from "../src/stellar/deploy.js";
import { buildInvokeTransaction, submitSignedTransaction } from "../src/stellar/tx.js";
import { networkPassphrase } from "../src/stellar/rpc.js";
import { submitMultiPartyCall, submitSingleSignerCall, fundTestnetAccount, simulateFreighterSignAuthEntry } from "./helpers.js";
import { upsertCommitment } from "../src/db/commitments.js";
import { applyReputationConsequences } from "../src/reputation.js";
import { getStanding } from "../src/db/reputation.js";
import { getAllocationMembers } from "../src/db/allocationMembers.js";
import { buildServer } from "../src/server.js";

/**
 * Every test here hits real Stellar testnet infrastructure — no mocks.
 * Same discipline as HarvestLock-Contracts/src/test.rs: a test that
 * doesn't touch the network can't tell you the SDK usage is actually
 * right, only that the types line up.
 */

const KNOWN_SETTLED_CONTRACT_ID = "CDVF6UVJOLF3OHCFSYSJ72RMG2T6DUQ42VRJ6IHL6MVEFDYEBZ3KTFK4";
// Stands in for token/buyer/cooperative/warehouse in the write-path test below —
// `initialize` only stores these as Addresses, it never touches the token
// contract, so a real-but-otherwise-unrelated address is a valid stand-in here.
const PLACEHOLDER_TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// Built once, closed once, at file scope -- shared by every describe block
// below that needs the real HTTP layer. buildServer()'s onClose hook
// calls pool.end() on the module-level Postgres pool singleton
// (db/pool.ts), which is shared process-wide, not per-server-instance --
// a second buildServer()/afterAll(() => app.close()) pair in a different
// describe block would close that same pool out from under whichever
// describe block runs after it (a real bug this file hit once already).
const app = buildServer();
afterAll(() => app.close());

describe("stellar/client (live testnet reads)", () => {
  // Real testnet RPC latency varies enough under load that vitest's
  // default 5s per-test timeout is unreliable here — not flaky logic,
  // just real network variance. Same generous timeout the write-path
  // tests already use, applied here too after a false failure.
  it(
    "reads status from a known deployed contract",
    async () => {
      const status = await getStatus(KNOWN_SETTLED_CONTRACT_ID);
      expect(typeof status).toBe("string");
      expect(status.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "reads the full commitment struct from a known deployed contract",
    async () => {
      const commitment = await getCommitment(KNOWN_SETTLED_CONTRACT_ID);
      expect(commitment.buyer).toMatch(/^G[A-Z0-9]{55}$/);
      expect(commitment.cooperative).toMatch(/^G[A-Z0-9]{55}$/);
      expect(commitment.warehouse_operator).toMatch(/^G[A-Z0-9]{55}$/);
      expect(commitment.token).toMatch(/^C[A-Z0-9]{55}$/);
      expect(typeof commitment.total_amount).toBe("bigint");
      expect(commitment.total_amount).toBeGreaterThan(0n);
    },
    30_000,
  );
});

describe("stellar/deploy (live testnet writes)", () => {
  it(
    "deploys a fresh, uninitialized contract instance",
    async () => {
      const contractId = await deployContractInstance();
      expect(contractId).toMatch(/^C[A-Z0-9]{55}$/);

      // Uninitialized contracts have no Commitment in storage yet —
      // get_status must fail with Error::NotInitialized (#2), not
      // return a value. Confirms the deploy actually landed a working
      // instance of *this* WASM, not just some contract.
      await expect(getStatus(contractId)).rejects.toThrow(/NotInitialized|Error\(Contract, #2\)/);
    },
    30_000,
  );

  it(
    "builds, signs, and submits an initialize transaction end to end",
    async () => {
      const deployer = Keypair.fromSecret(process.env.DEPLOYER_SECRET_KEY!);
      const contractId = await deployContractInstance();

      const unsignedXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: deployer.publicKey(),
        args: initializeArgs({
          buyer: deployer.publicKey(),
          cooperative: deployer.publicKey(),
          warehouseOperator: deployer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 3600n,
          deliveryWindowSecs: 86_400n,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
        }),
      });

      // Mirrors what a frontend wallet does with the XDR the API hands back:
      // parse it, sign with the party's key, hand the signed envelope back.
      const tx = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase);
      tx.sign(deployer);

      const result = await submitSignedTransaction(tx.toXDR());
      expect(result.status).toBe("SUCCESS");

      const status = await getStatus(contractId);
      expect(status).toBe("Draft");

      const commitment = await getCommitment(contractId);
      expect(commitment.buyer).toBe(deployer.publicKey());
      expect(commitment.total_amount).toBe(1_000_000_000n);
      expect(commitment.advance1_bps).toBe(1500);
    },
    60_000,
  );

  it(
    "cancel requires two genuinely different signers, correctly authorized per-entry",
    async () => {
      // lib.rs's cancel() calls both buyer.require_auth() and
      // cooperative.require_auth() — the one contract method needing two
      // *different* parties' auth on the same call. See test/helpers.ts's
      // submitMultiPartyCall doc comment for why the obvious approach
      // (sign the envelope twice) doesn't work and what does.
      const deployer = Keypair.fromSecret(process.env.DEPLOYER_SECRET_KEY!);
      const cooperative = Keypair.random();
      await fundTestnetAccount(cooperative.publicKey());

      const contractId = await deployContractInstance();

      const initXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: deployer.publicKey(),
        args: initializeArgs({
          buyer: deployer.publicKey(),
          cooperative: cooperative.publicKey(),
          warehouseOperator: deployer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 3600n,
          deliveryWindowSecs: 86_400n,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
        }),
      });
      const initTx = TransactionBuilder.fromXDR(initXdr, networkPassphrase);
      initTx.sign(deployer);
      await submitSignedTransaction(initTx.toXDR());

      const lockXdr = await buildInvokeTransaction({
        contractId,
        method: "lock",
        sourcePublicKey: deployer.publicKey(),
      });
      const lockTx = TransactionBuilder.fromXDR(lockXdr, networkPassphrase);
      lockTx.sign(deployer);
      await submitSignedTransaction(lockTx.toXDR());
      expect(await getStatus(contractId)).toBe("Locked");

      const result = await submitMultiPartyCall({
        contractId,
        method: "cancel",
        sourceSigner: deployer,
        otherSigners: [cooperative],
      });
      expect(result.status).toBe("SUCCESS");
      expect(await getStatus(contractId)).toBe("Cancelled");
    },
    120_000,
  );

  it(
    "reassign_buyer requires three genuinely different signers and actually changes the buyer",
    async () => {
      // lib.rs's reassign_buyer() calls buyer.require_auth(),
      // cooperative.require_auth(), AND new_buyer.require_auth() -- three
      // parties on one call, the only method in the contract that needs
      // that many. Exercises submitMultiPartyCall's `args` support too
      // (reassign_buyer takes the new buyer address; cancel, the only
      // other multi-party method, takes none).
      const deployer = Keypair.fromSecret(process.env.DEPLOYER_SECRET_KEY!);
      const cooperative = Keypair.random();
      const newBuyer = Keypair.random();
      await Promise.all([fundTestnetAccount(cooperative.publicKey()), fundTestnetAccount(newBuyer.publicKey())]);

      const contractId = await deployContractInstance();

      const initXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: deployer.publicKey(),
        args: initializeArgs({
          buyer: deployer.publicKey(),
          cooperative: cooperative.publicKey(),
          warehouseOperator: deployer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 3600n,
          deliveryWindowSecs: 86_400n,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
        }),
      });
      const initTx = TransactionBuilder.fromXDR(initXdr, networkPassphrase);
      initTx.sign(deployer);
      await submitSignedTransaction(initTx.toXDR());

      const lockXdr = await buildInvokeTransaction({
        contractId,
        method: "lock",
        sourcePublicKey: deployer.publicKey(),
      });
      const lockTx = TransactionBuilder.fromXDR(lockXdr, networkPassphrase);
      lockTx.sign(deployer);
      await submitSignedTransaction(lockTx.toXDR());

      const result = await submitMultiPartyCall({
        contractId,
        method: "reassign_buyer",
        args: [new Address(newBuyer.publicKey()).toScVal()],
        sourceSigner: deployer,
        otherSigners: [cooperative, newBuyer],
      });
      expect(result.status).toBe("SUCCESS");

      const commitment = await getCommitment(contractId);
      expect(commitment.buyer).toBe(newBuyer.publicKey());
      expect(commitment.buyer).not.toBe(deployer.publicKey());
    },
    120_000,
  );

  it(
    "two-phase funding: lock escrows only the deposit, fund_remainder escrows the rest",
    async () => {
      // lib.rs's headline change this session: lock() no longer pulls the
      // full total_amount, only advance1_bps + advance2_bps of it. This is
      // the SDK-layer proof that the new field (remainder_window_secs) and
      // the two new calls (ready_for_delivery, fund_remainder) actually
      // work through the real API build/sign/submit path, not just
      // cargo test's simulated ledger — the contract-level walk already
      // covers the same ground, this covers the API layer specifically.
      const deployer = Keypair.fromSecret(process.env.DEPLOYER_SECRET_KEY!);
      const contractId = await deployContractInstance();

      const initXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: deployer.publicKey(),
        args: initializeArgs({
          buyer: deployer.publicKey(),
          cooperative: deployer.publicKey(),
          warehouseOperator: deployer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 3600n,
          deliveryWindowSecs: 86_400n,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
        }),
      });
      const initTx = TransactionBuilder.fromXDR(initXdr, networkPassphrase);
      initTx.sign(deployer);
      await submitSignedTransaction(initTx.toXDR());

      await submitSingleSignerCall({ contractId, method: "lock", signer: deployer });
      const afterLock = await getCommitment(contractId);
      expect(afterLock.remainder_funded).toBe(false);

      for (const method of ["release_advance_1", "claim_advance_1", "mark_checkpoint", "release_advance_2", "claim_advance_2"]) {
        await submitSingleSignerCall({ contractId, method, signer: deployer });
      }
      expect(await getStatus(contractId)).toBe("Advance2Released");

      await submitSingleSignerCall({ contractId, method: "ready_for_delivery", signer: deployer });
      expect(await getStatus(contractId)).toBe("ReadyForDelivery");

      const confirmDeliveryArgs = [
        nativeToScVal(1_000, { type: "u32" }), // delivered_quantity -- full contracted amount
        nativeToScVal(0, { type: "u32" }), // grade_index 0 -- top of gradePriceBps, full price
      ];

      // Not funded yet -- confirm_delivery must still be rejected.
      await expect(
        submitSingleSignerCall({ contractId, method: "confirm_delivery", args: confirmDeliveryArgs, signer: deployer }),
      ).rejects.toThrow();

      await submitSingleSignerCall({ contractId, method: "fund_remainder", signer: deployer });
      const afterFund = await getCommitment(contractId);
      expect(afterFund.remainder_funded).toBe(true);

      await submitSingleSignerCall({ contractId, method: "confirm_delivery", args: confirmDeliveryArgs, signer: deployer });
      await submitSingleSignerCall({ contractId, method: "settle", signer: deployer });
      expect(await getStatus(contractId)).toBe("Settled");
    },
    180_000,
  );

  it(
    "expire_remainder_window: buyer default sweeps escrow to the cooperative, callable by an unrelated third party, and bars the buyer",
    async () => {
      // A short remainderWindowSecs (bypasses the API's 1-hour floor --
      // that's an HTTP-layer check in server.ts, not a contract one, and
      // this test calls buildInvokeTransaction/initializeArgs directly)
      // so the deadline can actually lapse within a test, real time, the
      // same demo-only reasoning HarvestLock-Contracts/HANDOFF.md uses for
      // its short-window testnet deployments.
      //
      // A fresh `buyer` keypair, not the shared `deployer` account: this
      // test ends by barring its buyer address in the real local
      // Postgres, and DEPLOYER_SECRET_KEY's address is reused as the
      // source/signer across most of this file's other tests -- barring
      // it for real would be a surprising, sticky side effect on a
      // shared identity, not a throwaway one.
      const deployer = Keypair.fromSecret(process.env.DEPLOYER_SECRET_KEY!);
      const buyer = Keypair.random();
      const cooperative = Keypair.random();
      const unrelatedThirdParty = Keypair.random();
      await Promise.all([
        fundTestnetAccount(buyer.publicKey()),
        fundTestnetAccount(cooperative.publicKey()),
        fundTestnetAccount(unrelatedThirdParty.publicKey()),
      ]);

      const contractId = await deployContractInstance();
      const initXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: buyer.publicKey(),
        args: initializeArgs({
          buyer: buyer.publicKey(),
          cooperative: cooperative.publicKey(),
          warehouseOperator: deployer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 12n, // seconds -- deliberately short, see above
          deliveryWindowSecs: 86_400n,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
        }),
      });
      const initTx = TransactionBuilder.fromXDR(initXdr, networkPassphrase);
      initTx.sign(buyer);
      await submitSignedTransaction(initTx.toXDR());

      await submitSingleSignerCall({ contractId, method: "lock", signer: buyer });
      await submitSingleSignerCall({ contractId, method: "release_advance_1", signer: deployer });
      await submitSingleSignerCall({ contractId, method: "mark_checkpoint", signer: deployer });
      await submitSingleSignerCall({ contractId, method: "release_advance_2", signer: deployer });
      // ready_for_delivery is cooperative-gated -- signed and sourced by
      // the cooperative itself, not the deployer.
      await submitSingleSignerCall({ contractId, method: "ready_for_delivery", signer: cooperative });
      expect(await getStatus(contractId)).toBe("ReadyForDelivery");

      // The buyer never calls fund_remainder. Wait past the 12-second
      // window, real time -- not a simulated-clock trick, this is exactly
      // what a caller waiting on a real testnet deadline experiences.
      await new Promise((r) => setTimeout(r, 15_000));

      // Called by neither the buyer nor the cooperative -- proves
      // expire_remainder_window is genuinely permissionless, not just
      // "works when I happen to also be a party," the same thing the
      // contract-level testnet walk in HarvestLock-Contracts/HANDOFF.md
      // proved with stellar-cli.
      await submitSingleSignerCall({
        contractId,
        method: "expire_remainder_window",
        signer: unrelatedThirdParty,
      });
      expect(await getStatus(contractId)).toBe("Defaulted");

      // The same sequence server.ts's GET /commitments/:contractId and
      // POST /transactions/submit routes run on every refresh -- proving
      // the reputation consequence actually fires end to end against a
      // real chain read, not just against a hand-built Commitment object
      // (see test/reputation.test.ts for that narrower unit coverage).
      const commitment = await getCommitment(contractId);
      const { previousStatus } = await upsertCommitment(contractId, commitment);
      await applyReputationConsequences(contractId, previousStatus, commitment);

      const standing = await getStanding(buyer.publicKey());
      expect(standing?.barred).toBe(true);
      expect(standing?.barred_reason).toBe("buyer_default");
      // The cooperative wasn't at fault here -- confirms the consequence
      // lands on the right party, not just "someone."
      expect(await getStanding(cooperative.publicKey())).toBeNull();
    },
    120_000,
  );

  it(
    "reclaim_on_nondelivery: seller non-delivery returns escrow to the buyer past the delivery deadline, and strikes the cooperative",
    async () => {
      // Fresh buyer/cooperative keypairs, not the shared deployer account
      // -- see the previous test's comment for why (this one strikes the
      // cooperative's reputation for real).
      const deployer = Keypair.fromSecret(process.env.DEPLOYER_SECRET_KEY!);
      const buyer = Keypair.random();
      const cooperative = Keypair.random();
      await Promise.all([fundTestnetAccount(buyer.publicKey()), fundTestnetAccount(cooperative.publicKey())]);

      const contractId = await deployContractInstance();

      const initXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: buyer.publicKey(),
        args: initializeArgs({
          buyer: buyer.publicKey(),
          cooperative: cooperative.publicKey(),
          warehouseOperator: deployer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 1500,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 3600n,
          deliveryWindowSecs: 12n, // seconds -- deliberately short, see the previous test's comment
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
        }),
      });
      const initTx = TransactionBuilder.fromXDR(initXdr, networkPassphrase);
      initTx.sign(buyer);
      await submitSignedTransaction(initTx.toXDR());

      await submitSingleSignerCall({ contractId, method: "lock", signer: buyer });
      expect(await getStatus(contractId)).toBe("Locked");

      // The cooperative never takes another action -- no checkpoint, no
      // ready_for_delivery, nothing. Wait past the 12-second delivery
      // deadline, real time.
      await new Promise((r) => setTimeout(r, 15_000));

      await submitSingleSignerCall({ contractId, method: "reclaim_on_nondelivery", signer: buyer });
      expect(await getStatus(contractId)).toBe("Forfeited");

      const commitment = await getCommitment(contractId);
      const { previousStatus } = await upsertCommitment(contractId, commitment);
      await applyReputationConsequences(contractId, previousStatus, commitment);

      const coopStanding = await getStanding(cooperative.publicKey());
      expect(coopStanding?.strike_count).toBe(1);
      expect(coopStanding?.barred).toBe(false); // one strike, not three yet
      // The buyer wasn't at fault here -- confirms the consequence lands
      // on the right party.
      expect(await getStanding(buyer.publicKey())).toBeNull();
    },
    120_000,
  );
});

describe("staged multi-party proposals (propose / sign / finalize, live testnet + real HTTP layer)", () => {
  // Uses the file-scoped `app` declared above -- server.test.ts covers
  // validation-only routes without touching the network; every test above
  // this describe block calls src/stellar/*.ts directly, only this block
  // and the allocation-ledger one below need the real HTTP layer.

  it(
    "buyer proposes, cooperative signs their own auth entry via a separate request, buyer finalizes -- ends in a real Cancelled commitment",
    async () => {
      // The whole point of this feature: the cooperative's signature
      // never touches a process that holds the buyer's key, or vice
      // versa -- unlike submitMultiPartyCall (used elsewhere in this
      // file), which exists specifically because a *test* can hold both.
      // simulateFreighterSignAuthEntry stands in for the one thing that
      // can't be exercised in this environment: a real installed
      // Freighter extension.
      const buyer = Keypair.random();
      const cooperative = Keypair.random();
      await Promise.all([fundTestnetAccount(buyer.publicKey()), fundTestnetAccount(cooperative.publicKey())]);

      const contractId = await deployContractInstance();
      const initXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: buyer.publicKey(),
        args: initializeArgs({
          buyer: buyer.publicKey(),
          cooperative: cooperative.publicKey(),
          warehouseOperator: buyer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 3600n,
          deliveryWindowSecs: 86_400n,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
        }),
      });
      const initTx = TransactionBuilder.fromXDR(initXdr, networkPassphrase);
      initTx.sign(buyer);
      await submitSignedTransaction(initTx.toXDR());
      expect(await getStatus(contractId)).toBe("Draft");

      // An unrelated third party can't propose a cancellation on someone
      // else's commitment -- the business-rule check that needs a live
      // commitment read (getCommitment), which is why this lives here and
      // not in server.test.ts's network-free validation suite.
      const unrelatedThirdParty = Keypair.random();
      const rejectedProposeRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/cancel/propose`,
        payload: { proposerPublicKey: unrelatedThirdParty.publicKey() },
      });
      expect(rejectedProposeRes.statusCode).toBe(403);

      // 1. Buyer proposes.
      const proposeRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/cancel/propose`,
        payload: { proposerPublicKey: buyer.publicKey() },
      });
      expect(proposeRes.statusCode).toBe(201);
      const proposal = proposeRes.json();
      expect(proposal.status).toBe("pending");
      // Buyer is the proposer/source -- their own auth is satisfied by
      // the classic signature at finalize time, so the only pending
      // entry should be the cooperative's.
      expect(proposal.pending_entries).toHaveLength(1);
      expect(proposal.pending_entries[0].address).toBe(cooperative.publicKey());

      // Proposing again for the same contract returns the SAME proposal,
      // not a duplicate -- confirms the "at most one active proposal"
      // behavior, not just asserted separately.
      const reProposeRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/cancel/propose`,
        payload: { proposerPublicKey: buyer.publicKey() },
      });
      expect(reProposeRes.statusCode).toBe(200);
      expect(reProposeRes.json().id).toBe(proposal.id);

      // 2. Cooperative, on what's meant to be an entirely separate
      // device/app, signs their own entry.
      const signedEntryXdr = await simulateFreighterSignAuthEntry(proposal.pending_entries[0].entry_xdr, cooperative);
      const signRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/propose/${proposal.id}/sign`,
        payload: { signerPublicKey: cooperative.publicKey(), signedEntryXdr },
      });
      expect(signRes.statusCode).toBe(200);
      const afterSign = signRes.json();
      expect(afterSign.status).toBe("ready");
      expect(afterSign.pending_entries).toHaveLength(0);
      expect(typeof afterSign.ready_xdr).toBe("string");

      // Signing again with the same entry should be rejected -- nothing
      // left pending for that address.
      const doubleSignRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/propose/${proposal.id}/sign`,
        payload: { signerPublicKey: cooperative.publicKey(), signedEntryXdr },
      });
      expect(doubleSignRes.statusCode).toBe(400);

      // 3. Buyer finalizes: classically signs the ready XDR (an ordinary
      // signature now, no different from any other write in this API)
      // and submits through the *existing* generic submit endpoint.
      const finalTx = TransactionBuilder.fromXDR(afterSign.ready_xdr, networkPassphrase);
      finalTx.sign(buyer);
      const submitRes = await app.inject({
        method: "POST",
        url: "/transactions/submit",
        payload: { xdr: finalTx.toXDR(), refreshContractId: contractId, completeProposalId: proposal.id },
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("SUCCESS");

      expect(await getStatus(contractId)).toBe("Cancelled");

      // The proposal is completed, not lingering as "ready" for a future
      // viewer to trip over.
      const afterCompleteRes = await app.inject({ method: "GET", url: `/commitments/${contractId}/tx/cancel/propose` });
      expect(afterCompleteRes.json().proposal).toBeNull();
    },
    180_000,
  );

  it(
    "reassign_buyer: outgoing buyer proposes, cooperative and incoming buyer each sign their own entry, buyer finalizes -- actually changes the buyer",
    async () => {
      // Three parties, not two -- reassign_buyer needs the outgoing
      // buyer's, the cooperative's, AND the incoming buyer's auth (see
      // lib.rs's doc comment for why one more than the PRD line alone
      // implies). The outgoing buyer is the proposer/source here, per
      // server.ts's rule that only the current buyer may propose a
      // reassignment -- so this proposal has TWO pending entries
      // (cooperative, incoming buyer), not cancel's one.
      const outgoingBuyer = Keypair.random();
      const cooperative = Keypair.random();
      const incomingBuyer = Keypair.random();
      await Promise.all([
        fundTestnetAccount(outgoingBuyer.publicKey()),
        fundTestnetAccount(cooperative.publicKey()),
        fundTestnetAccount(incomingBuyer.publicKey()),
      ]);

      const contractId = await deployContractInstance();
      const initXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: outgoingBuyer.publicKey(),
        args: initializeArgs({
          buyer: outgoingBuyer.publicKey(),
          cooperative: cooperative.publicKey(),
          warehouseOperator: outgoingBuyer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 3600n,
          deliveryWindowSecs: 86_400n,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
        }),
      });
      const initTx = TransactionBuilder.fromXDR(initXdr, networkPassphrase);
      initTx.sign(outgoingBuyer);
      await submitSignedTransaction(initTx.toXDR());

      // An unrelated third party -- not the current buyer -- can't
      // propose a reassignment on someone else's commitment.
      const unrelatedThirdParty = Keypair.random();
      const rejectedProposeRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/reassign-buyer/propose`,
        payload: { proposerPublicKey: unrelatedThirdParty.publicKey(), newBuyer: incomingBuyer.publicKey() },
      });
      expect(rejectedProposeRes.statusCode).toBe(403);
      // The cooperative can't propose it either -- reassignment is
      // specifically the outgoing buyer's own decision to initiate (see
      // server.ts's route comment), unlike cancel which either party can.
      const rejectedCoopProposeRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/reassign-buyer/propose`,
        payload: { proposerPublicKey: cooperative.publicKey(), newBuyer: incomingBuyer.publicKey() },
      });
      expect(rejectedCoopProposeRes.statusCode).toBe(403);

      const proposeRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/reassign-buyer/propose`,
        payload: { proposerPublicKey: outgoingBuyer.publicKey(), newBuyer: incomingBuyer.publicKey() },
      });
      expect(proposeRes.statusCode).toBe(201);
      const proposal = proposeRes.json();
      expect(proposal.status).toBe("pending");
      expect(proposal.method).toBe("reassign_buyer");
      const pendingAddresses = proposal.pending_entries.map((e: { address: string }) => e.address).sort();
      expect(pendingAddresses).toEqual([cooperative.publicKey(), incomingBuyer.publicKey()].sort());

      // Cooperative signs their entry first.
      const coopEntry = proposal.pending_entries.find((e: { address: string }) => e.address === cooperative.publicKey());
      const coopSignedEntryXdr = await simulateFreighterSignAuthEntry(coopEntry.entry_xdr, cooperative);
      const afterCoopSignRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/propose/${proposal.id}/sign`,
        payload: { signerPublicKey: cooperative.publicKey(), signedEntryXdr: coopSignedEntryXdr },
      });
      expect(afterCoopSignRes.statusCode).toBe(200);
      expect(afterCoopSignRes.json().status).toBe("pending"); // one entry still outstanding

      // Incoming buyer signs the remaining entry -- now every non-source
      // party has acted, so this call is what flips it to ready.
      const newBuyerEntry = afterCoopSignRes.json().pending_entries[0];
      const newBuyerSignedEntryXdr = await simulateFreighterSignAuthEntry(newBuyerEntry.entry_xdr, incomingBuyer);
      const afterBothSignRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/propose/${proposal.id}/sign`,
        payload: { signerPublicKey: incomingBuyer.publicKey(), signedEntryXdr: newBuyerSignedEntryXdr },
      });
      expect(afterBothSignRes.statusCode).toBe(200);
      const ready = afterBothSignRes.json();
      expect(ready.status).toBe("ready");
      expect(ready.pending_entries).toHaveLength(0);

      // Outgoing buyer finalizes.
      const finalTx = TransactionBuilder.fromXDR(ready.ready_xdr, networkPassphrase);
      finalTx.sign(outgoingBuyer);
      const submitRes = await app.inject({
        method: "POST",
        url: "/transactions/submit",
        payload: { xdr: finalTx.toXDR(), refreshContractId: contractId, completeProposalId: proposal.id },
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("SUCCESS");

      // The functional proof, not just "submission succeeded": the buyer
      // field genuinely changed, read back fresh from chain.
      const commitment = await getCommitment(contractId);
      expect(commitment.buyer).toBe(incomingBuyer.publicKey());
      expect(commitment.buyer).not.toBe(outgoingBuyer.publicKey());

      const afterCompleteRes = await app.inject({ method: "GET", url: `/commitments/${contractId}/tx/reassign-buyer/propose` });
      expect(afterCompleteRes.json().proposal).toBeNull();
    },
    180_000,
  );
});

describe("allocation ledger (live testnet + real HTTP layer)", () => {
  // Uses the file-scoped `app` declared near the top of this file.

  it(
    "records members through the real HTTP layer, reads them back on-chain, and erasure nulls the off-chain phone number",
    async () => {
      const buyer = Keypair.random();
      const cooperative = Keypair.random();
      await Promise.all([fundTestnetAccount(buyer.publicKey()), fundTestnetAccount(cooperative.publicKey())]);

      const contractId = await deployContractInstance();
      const initXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: buyer.publicKey(),
        args: initializeArgs({
          buyer: buyer.publicKey(),
          cooperative: cooperative.publicKey(),
          warehouseOperator: buyer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 3600n,
          deliveryWindowSecs: 86_400n,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
        }),
      });
      const initTx = TransactionBuilder.fromXDR(initXdr, networkPassphrase);
      initTx.sign(buyer);
      await submitSignedTransaction(initTx.toXDR());

      // Build via the real /tx/set-allocation route, not buildInvokeTransaction
      // directly -- this is what actually exercises the manual struct
      // encoding (allocationMemberToScVal) and the staged-salt response
      // shape a real caller would round-trip through /transactions/submit.
      const buildRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/set-allocation`,
        payload: {
          members: [
            { phoneNumber: "+2348012345678", shareBps: 6_000 },
            { phoneNumber: "+2348098765432", shareBps: 4_000 },
          ],
          sourcePublicKey: cooperative.publicKey(),
        },
      });
      expect(buildRes.statusCode).toBe(200);
      const { xdr: unsignedXdr, members: staged } = buildRes.json();
      expect(staged).toHaveLength(2);

      const tx = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase);
      tx.sign(cooperative);
      const submitRes = await app.inject({
        method: "POST",
        url: "/transactions/submit",
        payload: { xdr: tx.toXDR(), allocationContractId: contractId, allocationMembers: staged },
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("SUCCESS");

      // On-chain read, source of truth: the hashes/shares genuinely landed.
      const readRes = await app.inject({ method: "GET", url: `/commitments/${contractId}/allocation` });
      expect(readRes.statusCode).toBe(200);
      const onChainMembers = readRes.json().members as { memberHash: string; shareBps: number }[];
      expect(onChainMembers).toHaveLength(2);
      expect(onChainMembers.map((m) => m.shareBps).sort()).toEqual([4_000, 6_000]);
      expect(onChainMembers.map((m) => m.memberHash).sort()).toEqual(
        staged.map((m: { memberHash: string }) => m.memberHash).sort(),
      );

      // Off-chain side: the phone-number mapping was actually persisted
      // (not just staged) once the on-chain call confirmed.
      const dbRows = await getAllocationMembers(contractId);
      expect(dbRows).toHaveLength(2);
      expect(dbRows.every((r) => r.erased_at === null)).toBe(true);

      // NDPA s.34 erasure, through the real HTTP layer: the on-chain hash
      // is untouched (it's on-chain, nothing erases that), but the
      // off-chain phone number behind it is gone.
      const memberHashToErase = staged[0].memberHash as string;
      const eraseRes = await app.inject({ method: "DELETE", url: `/allocation-members/${memberHashToErase}` });
      expect(eraseRes.statusCode).toBe(200);
      expect(eraseRes.json().erased).toBe(true);

      const dbRowsAfterErase = await getAllocationMembers(contractId);
      const erasedRow = dbRowsAfterErase.find((r) => r.member_hash === memberHashToErase)!;
      expect(erasedRow.erased_at).not.toBeNull();
      // The on-chain read is completely unaffected by off-chain erasure --
      // the hash and share are still there, exactly as recorded.
      const readAfterEraseRes = await app.inject({ method: "GET", url: `/commitments/${contractId}/allocation` });
      expect(readAfterEraseRes.json().members).toHaveLength(2);
    },
    180_000,
  );
});

describe("oracle staleness bound (live testnet + real HTTP layer)", () => {
  // Uses the file-scoped `app` declared near the top of this file. The
  // oracle address here is Reflector's real, live "Fiat exchange rates"
  // testnet contract -- not a mock -- so these assertions genuinely
  // exercise a cross-contract call to infrastructure this project
  // doesn't own. GBP, not NGN: confirmed via a real `assets()` call
  // (HarvestLock-Contracts/HANDOFF.md's Deployment 8) that Reflector's
  // testnet fiat oracle doesn't quote NGN at all yet -- GBP is a stand-in
  // that proves the mechanism, not the production symbol.
  const REFLECTOR_FIAT_ORACLE = "CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W";

  it(
    "initializes with an oracleConfig through the real HTTP layer, then reads config and a live rate back",
    async () => {
      const buyer = Keypair.random();
      const cooperative = Keypair.random();
      await Promise.all([fundTestnetAccount(buyer.publicKey()), fundTestnetAccount(cooperative.publicKey())]);

      const contractId = await deployContractInstance();

      // Build via the real /tx/initialize route, not buildInvokeTransaction
      // directly -- this is what actually exercises oracleConfigToScVal's
      // manual struct encoding (and its alphabetical-key-order requirement)
      // the way a real caller would.
      const buildRes = await app.inject({
        method: "POST",
        url: `/commitments/${contractId}/tx/initialize`,
        payload: {
          buyer: buyer.publicKey(),
          cooperative: cooperative.publicKey(),
          warehouseOperator: buyer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: "1000000000",
          advance1Bps: 1500,
          advance2Bps: 1500,
          claimWindowSecs: "3600",
          remainderWindowSecs: "3600",
          deliveryWindowSecs: "86400",
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 9_000, 7_500],
          oracleConfig: { oracleContract: REFLECTOR_FIAT_ORACLE, priceAsset: "GBP", maxAgeSecs: "3600" },
          sourcePublicKey: buyer.publicKey(),
        },
      });
      expect(buildRes.statusCode).toBe(200);

      const tx = TransactionBuilder.fromXDR(buildRes.json().xdr, networkPassphrase);
      tx.sign(buyer);
      await submitSignedTransaction(tx.toXDR());

      const configRes = await app.inject({ method: "GET", url: `/commitments/${contractId}/oracle-config` });
      expect(configRes.statusCode).toBe(200);
      expect(configRes.json().config).toEqual({
        oracleContract: REFLECTOR_FIAT_ORACLE,
        priceAsset: "GBP",
        maxAgeSecs: "3600",
      });

      // A genuine cross-contract call to the real Reflector oracle, not a
      // fixture -- price and timestamp will differ run to run, so this
      // asserts shape and freshness, not an exact value.
      const rateRes = await app.inject({ method: "GET", url: `/commitments/${contractId}/oracle-rate` });
      expect(rateRes.statusCode).toBe(200);
      const rate = rateRes.json();
      expect(BigInt(rate.price)).toBeGreaterThan(0n);
      const ageSecs = Math.floor(Date.now() / 1000) - Number(rate.timestamp);
      expect(ageSecs).toBeLessThan(3600);
      expect(ageSecs).toBeGreaterThanOrEqual(0);
    },
    60_000,
  );

  it(
    "reads back null oracle-config for a commitment initialized without one",
    async () => {
      const buyer = Keypair.random();
      const cooperative = Keypair.random();
      await Promise.all([fundTestnetAccount(buyer.publicKey()), fundTestnetAccount(cooperative.publicKey())]);

      const contractId = await deployContractInstance();
      const initXdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: buyer.publicKey(),
        args: initializeArgs({
          buyer: buyer.publicKey(),
          cooperative: cooperative.publicKey(),
          warehouseOperator: buyer.publicKey(),
          token: PLACEHOLDER_TOKEN,
          totalAmount: 1_000_000_000n,
          advance1Bps: 1500,
          advance2Bps: 1500,
          claimWindowSecs: 3600n,
          remainderWindowSecs: 3600n,
          deliveryWindowSecs: 86_400n,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000],
          // oracleConfig omitted entirely -- proves the field is genuinely
          // optional at the TS layer, not just documented as such.
        }),
      });
      const initTx = TransactionBuilder.fromXDR(initXdr, networkPassphrase);
      initTx.sign(buyer);
      await submitSignedTransaction(initTx.toXDR());

      const configRes = await app.inject({ method: "GET", url: `/commitments/${contractId}/oracle-config` });
      expect(configRes.statusCode).toBe(200);
      expect(configRes.json()).toEqual({ config: null });

      // oracle_rate itself is a real contract error on this path
      // (OracleNotConfigured, lib.rs), not just an API-level 404 --
      // surfaces as a 500 with the contract's error propagated through,
      // same "let the contract error propagate" convention as
      // get_allocation's AllocationNotSet.
      const rateRes = await app.inject({ method: "GET", url: `/commitments/${contractId}/oracle-rate` });
      expect(rateRes.statusCode).toBe(500);
    },
    60_000,
  );
});
