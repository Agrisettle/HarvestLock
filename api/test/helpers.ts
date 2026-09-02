import {
  Keypair,
  Contract,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  rpc,
  authorizeEntry,
  xdr,
} from "@stellar/stellar-sdk";
import { server, networkPassphrase } from "../src/stellar/rpc.js";
import { submitSignedTransaction, type SubmitResult } from "../src/stellar/tx.js";

/**
 * Test-only helper for contract methods that need more than one party's
 * Soroban auth in a single call (`cancel` — two parties, `reassign_buyer`
 * — three; see lib.rs). Takes optional `args` since `reassign_buyer`
 * needs one (the new buyer) and `cancel` doesn't. This does NOT belong
 * in src/: the production API never holds a buyer/
 * cooperative/warehouse private key (api/README.md's architecture
 * section), so it can't orchestrate multi-party signing itself — a real
 * frontend flow has each party's own wallet do this piece, one entry at a
 * time. This exists purely so a test can exercise the multi-party
 * contract path end to end without standing up two real frontend clients.
 *
 * Found the hard way, in this order, so the next person doesn't have to
 * re-derive it:
 *
 * 1. Calling `Transaction.sign()` once per party does NOT work for a
 *    party who isn't the transaction's source account — it appends an
 *    extra classic envelope signature, and the network rejects the whole
 *    transaction with `tx_bad_auth_extra`.
 * 2. Mutating the built `Transaction`'s `.operations[0].auth` in place
 *    doesn't work either — `.operations` is a derived read view, not a
 *    live binding back to what actually gets signed and sent.
 * 3. The correct mechanism is per-entry: for every `SorobanAuthorizationEntry`
 *    whose credentials name a specific address (not `source_account`,
 *    which the source's own classic signature already satisfies), sign
 *    that entry individually via `authorizeEntry()`, then build a *new*
 *    operation and transaction carrying the signed entries, reusing the
 *    original simulation's resource footprint via `setSorobanData` so it
 *    doesn't need re-simulating (which would mint fresh, unsigned nonces
 *    and undo the signing).
 * 4. A participating address's auth only verifies if that address is a
 *    real, *created* account on the ledger — an address-credentials check
 *    reads the account's ledger entry, so a bare, never-funded `Keypair`
 *    fails with `missing_value` for `"account"` storage, not a signature
 *    error. Callers of this helper must fund every `otherSigners` entry
 *    first (friendbot, on testnet).
 */
export async function submitMultiPartyCall(opts: {
  contractId: string;
  method: string;
  args?: xdr.ScVal[];
  sourceSigner: Keypair;
  otherSigners: Keypair[];
}): Promise<SubmitResult> {
  const account = await server.getAccount(opts.sourceSigner.publicKey());
  const contract = new Contract(opts.contractId);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(opts.method, ...(opts.args ?? [])))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed for ${opts.method}: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();
  const op = assembled.operations[0];
  if (!op || op.type !== "invokeHostFunction") {
    throw new Error(`expected an invokeHostFunction operation, got ${op?.type}`);
  }

  const latestLedger = await server.getLatestLedger();
  const validUntilLedgerSeq = latestLedger.sequence + 100;

  const signedAuth = [];
  for (const entry of op.auth ?? []) {
    // See point 2/3 above for why this reads via a JSON round-trip rather
    // than the class's own accessors: it's read-only here, just to tell
    // entries apart, and `entry` itself (untouched) is what gets signed.
    const plain = JSON.parse(JSON.stringify(entry)) as { credentials: unknown };
    if (plain.credentials === "source_account") {
      signedAuth.push(entry);
      continue;
    }
    const addr = (plain.credentials as { address_v2: { address: string } }).address_v2.address;
    const signer = opts.otherSigners.find((s) => s.publicKey() === addr);
    if (!signer) {
      throw new Error(`no signer provided for required auth entry address ${addr}`);
    }
    signedAuth.push(await authorizeEntry(entry, signer, validUntilLedgerSeq, networkPassphrase));
  }

  // A fresh account fetch, not a reuse of `account` above: building `tx`
  // already advanced that Account object's internal sequence number by
  // one (TransactionBuilder does this so callers can chain builds without
  // re-fetching) -- but `tx` itself was never submitted, so re-using the
  // same mutated object here would produce a sequence number one ahead of
  // what's actually on ledger.
  const freshAccount = await server.getAccount(opts.sourceSigner.publicKey());
  const newOp = Operation.invokeHostFunction({ func: op.func, auth: signedAuth });
  const freshTx = new TransactionBuilder(freshAccount, { fee: BASE_FEE, networkPassphrase })
    .addOperation(newOp)
    .setSorobanData(sim.transactionData.build())
    .setTimeout(60)
    .build();
  freshTx.sign(opts.sourceSigner);

  return submitSignedTransaction(freshTx.toXDR());
}

/** Funds a fresh testnet keypair via friendbot. Needed for any `otherSigners` entry — see point 4 above. */
export async function fundTestnetAccount(publicKey: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    throw new Error(`friendbot funding failed for ${publicKey}: ${await res.text()}`);
  }
}
