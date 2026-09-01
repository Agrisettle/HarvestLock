import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { server, networkPassphrase } from "./rpc.js";

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
  const account = await server.getAccount(opts.sourcePublicKey);
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
  return assembled.toXDR();
}

export interface SubmitResult {
  status: "SUCCESS" | "FAILED";
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
  const started = Date.now();
  const timeoutMs = 30_000;
  let result: rpc.Api.GetTransactionResponse;
  for (;;) {
    result = await server.getTransaction(hash);
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) break;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for transaction ${hash} to be included`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return { status: "SUCCESS", hash, returnValue: result.returnValue };
  }
  throw new Error(`transaction ${hash} failed: ${JSON.stringify(result)}`);
}
