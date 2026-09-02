import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  scValToNative,
  rpc,
} from "@stellar/stellar-sdk";
import { server, networkPassphrase } from "./rpc.js";
import { withRetry } from "./retry.js";

/**
 * Every read in this module works by *simulating* a contract invocation —
 * never submitting a transaction — which is how Soroban read-only calls
 * work: simulation still needs a source account for fee/sequence-number
 * context, but nothing is signed or sent to the network, so any funded
 * account works as the "reader," including one with no relationship to
 * the commitment being read.
 */

function readerKeypair(): Keypair {
  const secret = process.env.DEPLOYER_SECRET_KEY;
  if (!secret) {
    throw new Error("DEPLOYER_SECRET_KEY is not set — needed as the simulation source account");
  }
  return Keypair.fromSecret(secret);
}

async function simulateRead(contractId: string, method: string) {
  const reader = readerKeypair();
  // Retried, not the checks below: both of these are real network calls
  // that have been observed to throw transiently on this RPC (a stale
  // "Account not found" read right after a successful transaction, and a
  // bare fetch failure) — see api/HANDOFF.md's "Known testnet flakiness"
  // and src/stellar/retry.ts. A *legitimate* simulation error (e.g. the
  // contract genuinely isn't initialized) comes back as a normal return
  // value, not a throw, so it's never accidentally retried here.
  const account = await withRetry(() => server.getAccount(reader.publicKey()));
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method))
    .setTimeout(30)
    .build();

  const sim = await withRetry(() => server.simulateTransaction(tx));

  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`contract simulation failed for ${method}: ${sim.error}`);
  }
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`contract simulation did not succeed for ${method}`);
  }
  if (!sim.result) {
    throw new Error(`contract simulation for ${method} returned no result`);
  }

  return scValToNative(sim.result.retval);
}

export interface Commitment {
  buyer: string;
  cooperative: string;
  warehouse_operator: string;
  token: string;
  total_amount: bigint;
  advance1_bps: number;
  advance2_bps: number;
  claim_window_secs: bigint;
  remainder_window_secs: bigint;
  status: string;
  created_at: bigint;
  delivery_deadline: bigint;
  advance1_deadline: bigint;
  advance1_claimed: boolean;
  advance1_expired: boolean;
  advance2_deadline: bigint;
  advance2_claimed: boolean;
  advance2_expired: boolean;
  remainder_deadline: bigint;
  remainder_funded: boolean;
}

/**
 * `Status` has no payload on any variant, so scValToNative resolves it to a
 * one-element array (e.g. `['Draft']`), not a bare string — verified
 * empirically against the live deployed contract, not assumed. Every read
 * that surfaces a Status goes through this to hand callers the plain name.
 */
function unwrapStatus(value: unknown): string {
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
    return value[0];
  }
  throw new Error(`expected a Status enum value, got: ${JSON.stringify(value)}`);
}

/** Mirrors the contract's `get_status` — returns the bare Status variant name. */
export async function getStatus(contractId: string): Promise<string> {
  const result = await simulateRead(contractId, "get_status");
  return unwrapStatus(result);
}

/** Mirrors the contract's `get_commitment` — the full struct. */
export async function getCommitment(contractId: string): Promise<Commitment> {
  const result = (await simulateRead(contractId, "get_commitment")) as Commitment;
  return { ...result, status: unwrapStatus(result.status) };
}
