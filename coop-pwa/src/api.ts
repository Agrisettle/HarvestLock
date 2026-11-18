import { withRetry } from "./retry";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** Mirrors api/src/server.ts's serializeCommitment — every bigint on the
 * chain type comes back as a string over HTTP, since JSON can't carry
 * bigint. Includes every field the contract's Commitment struct carries,
 * not just the ones this app's UI has needed so far — warehouse-app's
 * README flagged this copy (and buyer-app's) as having drifted behind
 * the contract's actual shape; kept in sync here rather than adding to
 * that gap now that DisputeSection needs status/dispute fields this
 * interface never had. */
export interface CommitmentDetail {
  status: string;
  buyer: string;
  cooperative: string;
  warehouse_operator: string;
  token: string;
  total_amount: string;
  advance1_bps: number;
  advance2_bps: number;
  claim_window_secs: string;
  remainder_window_secs: string;
  created_at: string;
  delivery_deadline: string;
  advance1_deadline: string;
  advance1_claimed: boolean;
  advance1_expired: boolean;
  advance2_deadline: string;
  advance2_claimed: boolean;
  advance2_expired: boolean;
  remainder_deadline: string;
  remainder_funded: boolean;
  contracted_quantity: number;
  grade_price_bps: number[];
  delivered_quantity: number;
  grade_index: number;
  settlement_bps: number;
  fx_resolved: boolean;
  fx_adjusted_total: string;
  fx_shortfall_amount: string;
  fx_shortfall_funded: boolean;
  fx_shortfall_deadline: string;
  dispute_pre_status: string;
  dispute_deadline: string;
}

/** Mirrors api/src/db/commitments.ts's CommitmentRow — the Postgres cache. */
export interface CommitmentSummary {
  id: string;
  contract_id: string;
  buyer_address: string;
  cooperative_address: string;
  warehouse_address: string;
  token_address: string;
  total_amount: string;
  advance1_bps: number;
  advance2_bps: number;
  claim_window_secs: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * A non-ok API response. `message` is the human-readable reason only (what
 * components show); the request path and raw response body stay on the
 * object for debugging but are never part of the message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;
  /** The contract error code (e.g. "Error(Contract, #23)") when the API message carries one. */
  readonly contractError?: string;
  /** Seconds from a 429's Retry-After header, when present. */
  readonly retryAfterSecs?: number;

  constructor(path: string, status: number, body: string, message: string, extra: { contractError?: string; retryAfterSecs?: number } = {}) {
    super(message);
    this.name = "ApiError";
    this.path = path;
    this.status = status;
    this.body = body;
    this.contractError = extra.contractError;
    this.retryAfterSecs = extra.retryAfterSecs;
  }
}

/** Builds an ApiError from a non-ok response: prefers the API's `message`, falls back to `error` (older handlers), then to the status text. */
async function toApiError(path: string, res: Response): Promise<ApiError> {
  const body = await res.text();
  let message = "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const { message: m, error: e } = parsed as { message?: unknown; error?: unknown };
      if (typeof m === "string" && m) message = m;
      else if (typeof e === "string" && e) message = e;
    }
  } catch {
    // Non-JSON body: fall through to the status text.
  }
  let retryAfterSecs: number | undefined;
  if (res.status === 429) {
    const n = Number(res.headers?.get("Retry-After"));
    if (Number.isFinite(n) && n > 0) retryAfterSecs = Math.ceil(n);
    message = retryAfterSecs !== undefined ? `Too many requests, try again in ${retryAfterSecs} s` : "Too many requests, try again shortly";
  }
  if (!message) message = res.statusText || `Request failed (${res.status})`;
  const contractError = /Error\(Contract, #\d+\)/.exec(message)?.[0];
  return new ApiError(path, res.status, body, message, { contractError, retryAfterSecs });
}

// Retry policy: only a transport failure (fetch rejecting) is ever retried,
// never a server rejection, and only for calls that are safe to replay.
// GETs always are. A POST is retried only when the call opts in with
// `{ retry: true }`, which is reserved for building unsigned XDR (no side
// effects). A transport failure can land *after* the request reached the
// API (e.g. a mobile connection dropping during the 30 s submit poll), so
// `/commitments/deploy` (would deploy a second, orphaned contract),
// `/transactions/submit` (re-sends a possibly in-flight transaction) and the
// propose/sign calls (can race themselves) are never retried.
async function get<T>(path: string): Promise<T> {
  const res = await withRetry(() => fetch(`${API_URL}${path}`));
  if (!res.ok) {
    throw await toApiError(path, res);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown, opts: { retry?: boolean } = {}): Promise<T> {
  const send = () =>
    fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const res = opts.retry ? await withRetry(send) : await send();
  if (!res.ok) {
    throw await toApiError(path, res);
  }
  return res.json() as Promise<T>;
}

/** Live chain read — the source of truth. Also refreshes the API's cache as a side effect. */
export function getCommitment(contractId: string): Promise<CommitmentDetail> {
  return get<CommitmentDetail>(`/commitments/${encodeURIComponent(contractId)}`);
}

/** Postgres-cached list — the only way to enumerate commitments, since the chain has no such query. */
export function listCommitments(
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<CommitmentSummary[]> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return get<CommitmentSummary[]>(`/commitments?${query}`);
}

/** Builds unsigned XDR for a no-argument lifecycle method (e.g. `claim_advance_1`). The caller's wallet signs it next. */
export function buildTx(contractId: string, method: string, sourcePublicKey: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/${method}`, { sourcePublicKey }, { retry: true });
}

/** Builds unsigned `flag_dispute` XDR. `flagger` must be the commitment's buyer, cooperative, or warehouse operator (enforced on-chain) — single-signer, so unlike resolve_dispute this needs no multi-party staging. */
export function buildFlagDisputeTx(contractId: string, flagger: string, sourcePublicKey: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/flag-dispute`, { flagger, sourcePublicKey }, { retry: true });
}

export interface SubmitResult {
  status: "SUCCESS" | "FAILED";
  hash: string;
}

/** Submits a signed envelope. `refreshContractId` also refreshes the API's Postgres cache; `completeProposalId` marks a staged cancellation proposal finished; `allocationContractId`/`allocationMembers` persists a staged allocation ledger's phone numbers now that `set_allocation` is confirmed on-chain. */
export function submitTx(
  signedXdr: string,
  refreshContractId?: string,
  completeProposalId?: string,
  allocationContractId?: string,
  allocationMembers?: StagedAllocationMember[],
): Promise<SubmitResult> {
  return post<SubmitResult>("/transactions/submit", {
    xdr: signedXdr,
    refreshContractId,
    completeProposalId,
    allocationContractId,
    allocationMembers,
  });
}

/** Mirrors api/src/db/allocationMembers.ts's StagedAllocationMember — returned unpersisted from `buildSetAllocationTx`; pass the same array back to `submitTx` to actually persist the phone-number mapping once `set_allocation` is confirmed on-chain. */
export interface StagedAllocationMember {
  phoneNumber: string;
  shareBps: number;
  salt: string;
  memberHash: string;
}

/** Mirrors api/src/server.ts's GET .../allocation response — on-chain only, never a phone number (this contract never stores one). */
export interface AllocationMember {
  memberHash: string;
  shareBps: number;
}

/** Builds unsigned `set_allocation` XDR and stages (but doesn't yet persist) the phone-number mapping. Cooperative-gated on-chain; callable only pre-`lock`. */
export function buildSetAllocationTx(
  contractId: string,
  members: { phoneNumber: string; shareBps: number }[],
  sourcePublicKey: string,
): Promise<{ xdr: string; members: StagedAllocationMember[] }> {
  return post<{ xdr: string; members: StagedAllocationMember[] }>(
    `/commitments/${encodeURIComponent(contractId)}/tx/set-allocation`,
    { members, sourcePublicKey },
    { retry: true },
  );
}

/** Live on-chain read of the recorded allocation ledger. Throws (the contract's AllocationNotSet) if `set_allocation` has never run for this commitment — see `getAllocationLedger` for the "not set yet" case turned into a normal UI state instead of an error. */
function getAllocation(contractId: string): Promise<{ members: AllocationMember[] }> {
  return get<{ members: AllocationMember[] }>(`/commitments/${encodeURIComponent(contractId)}/allocation`);
}

/** `getAllocation`, with the contract's AllocationNotSet error turned into `null` — a real, expected state (no ledger recorded yet), not a failure. Any other error (bad contract ID, network failure) still propagates, since those genuinely aren't "not set yet." */
export async function getAllocationLedger(contractId: string): Promise<AllocationMember[] | null> {
  try {
    const { members } = await getAllocation(contractId);
    if (!Array.isArray(members)) {
      throw new Error(`Invalid allocation ledger response for ${contractId}: expected a members array`);
    }
    return members;
  } catch (err) {
    if (err instanceof Error && /AllocationNotSet|Error\(Contract, #23\)/.test(err.message)) {
      return null;
    }
    throw err;
  }
}

/** Mirrors api/src/server.ts's serializeProposal — the staged multi-party propose/sign/finalize flow's public shape, shared by `cancel` and `reassign_buyer`. */
export interface MultisigProposal {
  id: string;
  contract_id: string;
  method: "cancel" | "reassign_buyer" | "resolve_dispute";
  proposer_address: string;
  status: "pending" | "ready" | "completed";
  pending_entries: { address: string; entry_xdr: string }[];
  ready_xdr: string | null;
}

/** The active proposed cancellation for a commitment, if any — poll this to render "X wants to cancel, approve?" / "waiting" / "ready to finalize." */
export function getCancelProposal(contractId: string): Promise<{ proposal: MultisigProposal | null }> {
  return get<{ proposal: MultisigProposal | null }>(`/commitments/${encodeURIComponent(contractId)}/tx/cancel/propose`);
}

/** Proposes a cancellation, or idempotently returns the already-active one for this commitment. */
export function proposeCancel(contractId: string, proposerPublicKey: string): Promise<MultisigProposal> {
  return post<MultisigProposal>(`/commitments/${encodeURIComponent(contractId)}/tx/cancel/propose`, { proposerPublicKey });
}

/** The active proposed buyer reassignment for a commitment, if any. */
export function getReassignBuyerProposal(contractId: string): Promise<{ proposal: MultisigProposal | null }> {
  return get<{ proposal: MultisigProposal | null }>(`/commitments/${encodeURIComponent(contractId)}/tx/reassign-buyer/propose`);
}

/** Proposes reassigning the buyer position to `newBuyer`, or idempotently returns the already-active proposal. Only the commitment's *current* buyer may call this — the API rejects (403) anyone else. */
export function proposeReassignBuyer(contractId: string, proposerPublicKey: string, newBuyer: string): Promise<MultisigProposal> {
  return post<MultisigProposal>(`/commitments/${encodeURIComponent(contractId)}/tx/reassign-buyer/propose`, {
    proposerPublicKey,
    newBuyer,
  });
}

/** The active proposed dispute resolution for a commitment, if any. */
export function getResolveDisputeProposal(contractId: string): Promise<{ proposal: MultisigProposal | null }> {
  return get<{ proposal: MultisigProposal | null }>(
    `/commitments/${encodeURIComponent(contractId)}/tx/resolve-dispute/propose`,
  );
}

/** Proposes resolving a dispute, or idempotently returns the already-active proposal. Any of buyer/cooperative/warehouse operator may propose — resolve_dispute itself needs all three parties' auth regardless of who initiates. */
export function proposeResolveDispute(contractId: string, proposerPublicKey: string): Promise<MultisigProposal> {
  return post<MultisigProposal>(`/commitments/${encodeURIComponent(contractId)}/tx/resolve-dispute/propose`, {
    proposerPublicKey,
  });
}

/** Records one party's signed auth entry against a proposal — method-agnostic, works for both `cancel` and `reassign_buyer` proposals, since a proposal ID is already unique. Once every pending entry is signed, the response's status flips to "ready". */
export function signMultisigProposal(
  contractId: string,
  proposalId: string,
  signerPublicKey: string,
  signedEntryXdr: string,
): Promise<MultisigProposal> {
  return post<MultisigProposal>(`/commitments/${encodeURIComponent(contractId)}/tx/propose/${proposalId}/sign`, {
    signerPublicKey,
    signedEntryXdr,
  });
}
