import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { server, networkPassphrase } from "./rpc.js";
import { withRetry } from "./retry.js";
import { contractErrorFromSimulation } from "../errors.js";

/**
 * Every write in this API follows the same shape: build an unsigned
 * transaction server-side, hand it to the frontend for the *party's own*
 * wallet to sign (buyer/cooperative/warehouse — see lib.rs's require_auth
 * calls, one per party per method), then submit the signed envelope back
 * here. The API never holds a buyer/cooperative/warehouse private key —
 * only the deployer key in deploy.ts, which pays contract-creation fees
 * and is not a party to any commitment. This is deliberate, not an
 * oversight: PRD §4.6 rules out surfacing seed phrases to cooperative
 * users, and the same principle applies to every party, not just farmers.
 */

export async function buildInvokeTransaction(opts: {
  contractId: string;
  method: string;
  args?: xdr.ScVal[];
  sourcePublicKey: string;
}): Promise<string> {
  // Retried — see client.ts's simulateRead for why (real, observed
  // transient RPC failures, not speculative hardening).
  const account = await withRetry(() => server.getAccount(opts.sourcePublicKey));
  const contract = new Contract(opts.contractId);

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(opts.method, ...(opts.args ?? [])))
    .setTimeout(60)
    .build();

  const sim = await withRetry(() => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) {
    // An ordinary state-machine rejection is a 409 with the contract's own
    // code/name; only diagnostics with no contract code stay a 5xx.
    throw (
      contractErrorFromSimulation(opts.method, sim.error) ??
      new Error(`simulation failed for ${opts.method}: ${sim.error}`)
    );
  }

  const assembled = rpc.assembleTransaction(tx, sim).build();
  return assembled.toXDR();
}

export interface SubmitResult {
  /**
   * PENDING is not an error: the network accepted the transaction but it
   * hadn't been included within this call's poll window. The caller gets
   * the hash back so it can ask GET /transactions/:hash later instead of
   * being told (wrongly) that a real, funds-moving action failed.
   */
  status: "SUCCESS" | "FAILED" | "PENDING";
  hash: string;
  returnValue?: unknown;
}

export async function submitSignedTransaction(signedXdr: string): Promise<SubmitResult> {
  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(tx);

  if (sendResult.status === "ERROR") {
    throw new Error(`transaction rejected at submission: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const hash = sendResult.hash;

  // Soroban RPC's getTransaction is eventually-consistent after send —
  // poll until it leaves NOT_FOUND, same pattern stellar-cli itself uses.
  // A transient throw mid-poll (a bare `fetch failed` hit this exact call
  // while building cancel()'s test coverage) is treated the same as
  // NOT_FOUND — keep polling within the same timeout — rather than
  // aborting the whole wait over one blip.
  const started = Date.now();
  const timeoutMs = 30_000;
  let result: rpc.Api.GetTransactionResponse | undefined;
  for (;;) {
    try {
      result = await server.getTransaction(hash);
      if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) break;
    } catch {
      // fall through to the timeout check / sleep below and retry
    }
    if (Date.now() - started > timeoutMs) {
      // The transaction was already accepted; only its confirmation is
      // slow. Returning PENDING (rather than throwing) is what lets the
      // route answer 202 and persist the hash for later polling — see
      // db/pendingSubmissions.ts and GET /transactions/:hash.
      return { status: "PENDING", hash };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return { status: "SUCCESS", hash, returnValue: result.returnValue };
  }
  throw new Error(`transaction ${hash} failed: ${JSON.stringify(result)}`);
}

/**
 * The status-only read behind GET /transactions/:hash. Kept here beside
 * the submission poll rather than in server.ts so the RPC vocabulary
 * (NOT_FOUND/SUCCESS/FAILED) stays in one module. A transient RPC error
 * is reported as PENDING, not a 5xx: the caller's next poll can retry,
 * and a hash that was accepted on-chain shouldn't look like an API
 * outage just because one getTransaction call blipped.
 */
export async function getTransactionStatus(hash: string): Promise<"PENDING" | "SUCCESS" | "FAILED"> {
  let result: rpc.Api.GetTransactionResponse;
  try {
    result = await server.getTransaction(hash);
  } catch {
    return "PENDING";
  }
  if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return "SUCCESS";
  if (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) return "PENDING";
  return "FAILED";
}
