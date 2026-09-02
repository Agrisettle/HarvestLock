import "dotenv/config";
import { describe, it, expect } from "vitest";
import { Keypair, TransactionBuilder, Address } from "@stellar/stellar-sdk";
import { getStatus, getCommitment } from "../src/stellar/client.js";
import { deployContractInstance, initializeArgs } from "../src/stellar/deploy.js";
import { buildInvokeTransaction, submitSignedTransaction } from "../src/stellar/tx.js";
import { networkPassphrase } from "../src/stellar/rpc.js";
import { submitMultiPartyCall, fundTestnetAccount } from "./helpers.js";

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
});
