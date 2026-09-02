import { Address, Contract, Operation, TransactionBuilder, BASE_FEE, rpc, xdr } from "@stellar/stellar-sdk";
import { server, networkPassphrase } from "./rpc.js";
import { withRetry } from "./retry.js";

/**
 * Builds the pieces needed to stage a multi-party contract call (currently
 * only `cancel`, see server.ts) across separate HTTP requests from
 * separate parties' wallets, instead of one script holding every key the
 * way `test/helpers.ts`'s `submitMultiPartyCall` does for tests.
 *
 * The mechanism is the same one `submitMultiPartyCall` already proved:
 * simulate once, sign each non-source `SorobanAuthorizationEntry`
 * individually, rebuild the operation with the signed entries, reusing
 * the original simulation's resource footprint (`sorobanData`) rather
 * than re-simulating (which would mint fresh, unsigned nonces). What's
 * new here is that the individual signing step doesn't have to happen in
 * one process anymore — each entry's XDR can be handed to a *different*
 * party's wallet (via Freighter's `signAuthEntry`, which signs a single
 * auth entry without needing the whole transaction or the other parties'
 * signatures) in a separate request, at a separate time.
 *
 * One thing simulation does NOT set sensibly on its own:
 * `signatureExpirationLedger` on each address-credential entry. Freighter's
 * `signAuthEntry(entryXdr)` takes no separate expiration parameter — it
 * signs whatever's already embedded in the entry XDR handed to it, the
 * same way `authorizeEntry()`'s local-signer path reads `validUntilLedgerSeq`
 * as an explicit argument rather than trusting a default. So this module
 * sets it explicitly, server-side, before any entry XDR ever reaches a
 * wallet — otherwise every entry's expiration would sign as `0`, which
 * the network treats as already-expired.
 */

export interface PendingAuthEntry {
  /** null for a source_account entry — auto-satisfied by the proposer's own classic signature, never needs explicit signing. */
  address: string | null;
  entryXdr: string;
}

export interface ProposalPieces {
  funcXdr: string;
  sorobanDataXdr: string;
  /** Same order as the simulated operation's auth array — required for rebuilding correctly later. */
  entries: PendingAuthEntry[];
}

/**
 * `SorobanCredentials` has four variants; only two matter for this
 * contract's plain `require_auth()` calls (`sourceAccount`, handled by
 * callers before reaching this function, and the two address forms).
 * `AddressWithDelegates` (CAP-71 signer delegation) isn't something this
 * contract's simple auth calls ever produce — thrown on explicitly rather
 * than silently mis-handled, since the SDK's own `getAddressCredentials`
 * helper that would normally cover this isn't part of its public exports
 * (only available inside `base/auth.js`, not re-exported from the package
 * root) to reuse directly.
 */
function addressCredentials(credentials: xdr.SorobanCredentials): { isV2: boolean; addr: xdr.SorobanAddressCredentials } {
  switch (credentials.type) {
    case "sorobanCredentialsAddress":
      return { isV2: false, addr: credentials.address };
    case "sorobanCredentialsAddressV2":
      return { isV2: true, addr: credentials.addressV2 };
    default:
      throw new Error(`unsupported Soroban credential type: ${credentials.type}`);
  }
}

function setAuthEntryExpiration(entry: xdr.SorobanAuthorizationEntry, validUntilLedgerSeq: number): xdr.SorobanAuthorizationEntry {
  const credentials = entry.credentials;
  if (credentials.type === "sorobanCredentialsSourceAccount") {
    return entry;
  }
  const { isV2, addr } = addressCredentials(credentials);
  const newAddrCreds = new xdr.SorobanAddressCredentials({
    address: addr.address,
    nonce: addr.nonce,
    signatureExpirationLedger: validUntilLedgerSeq,
    signature: addr.signature,
  });
  const newCredentials = isV2
    ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(newAddrCreds)
    : xdr.SorobanCredentials.sorobanCredentialsAddress(newAddrCreds);
  return new xdr.SorobanAuthorizationEntry({ credentials: newCredentials, rootInvocation: entry.rootInvocation });
}

/** How far out to set each entry's signature expiration — generous, since two separate humans coordinating a cancellation could realistically take hours, not seconds. ~5s/ledger close time, so this is roughly a day. */
const VALID_LEDGERS_AHEAD = 17_280;

export async function buildMultiPartyProposal(opts: {
  contractId: string;
  method: string;
  sourcePublicKey: string;
}): Promise<ProposalPieces> {
  const account = await withRetry(() => server.getAccount(opts.sourcePublicKey));
  const contract = new Contract(opts.contractId);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(opts.method))
    .setTimeout(60)
    .build();

  const sim = await withRetry(() => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed for ${opts.method}: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();
  const op = assembled.operations[0];
  if (!op || op.type !== "invokeHostFunction") {
    throw new Error(`expected an invokeHostFunction operation, got ${op?.type}`);
  }

  const latestLedger = await withRetry(() => server.getLatestLedger());
  const validUntilLedgerSeq = latestLedger.sequence + VALID_LEDGERS_AHEAD;

  const entries: PendingAuthEntry[] = (op.auth ?? []).map((rawEntry) => {
    const entry = setAuthEntryExpiration(rawEntry, validUntilLedgerSeq);
    const credentials = entry.credentials;
    const address =
      credentials.type === "sorobanCredentialsSourceAccount"
        ? null
        : Address.fromScAddress(addressCredentials(credentials).addr.address).toString();
    return { address, entryXdr: entry.toXDR("base64") };
  });

  return {
    funcXdr: op.func.toXDR("base64"),
    sorobanDataXdr: sim.transactionData.build().toXDR("base64"),
    entries,
  };
}

/**
 * Rebuilds the final transaction once every non-source auth entry has been
 * signed. Returns unsigned XDR: only the proposer's own classic signature
 * is still needed, via the normal sign → `/transactions/submit` path
 * every other write in this API already uses — deliberately not a new
 * submit endpoint, to keep this feature's surface area small.
 */
export async function finalizeMultiPartyProposal(opts: {
  sourcePublicKey: string;
  funcXdr: string;
  sorobanDataXdr: string;
  entries: { address: string | null; entryXdr: string; signedEntryXdr: string | null }[];
}): Promise<string> {
  const auth = opts.entries.map((e) => {
    if (e.address === null) {
      return xdr.SorobanAuthorizationEntry.fromXDR(e.entryXdr, "base64");
    }
    if (!e.signedEntryXdr) {
      throw new Error(`entry for ${e.address} is not signed yet`);
    }
    return xdr.SorobanAuthorizationEntry.fromXDR(e.signedEntryXdr, "base64");
  });
  const func = xdr.HostFunction.fromXDR(opts.funcXdr, "base64");

  // A fresh account fetch, not a cached one from propose time -- propose
  // and finalize can be arbitrarily far apart (the whole point of this
  // feature), so the proposer's sequence number may have moved.
  const account = await withRetry(() => server.getAccount(opts.sourcePublicKey));
  const op = Operation.invokeHostFunction({ func, auth });
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(op)
    .setSorobanData(opts.sorobanDataXdr)
    .setTimeout(300)
    .build();

  return tx.toXDR();
}
