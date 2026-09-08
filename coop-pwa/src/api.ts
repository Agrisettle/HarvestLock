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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path} -> ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const responseBody = await res.text();
    throw new Error(`${path} -> ${res.status}: ${responseBody}`);
  }
  return res.json() as Promise<T>;
}

/** Live chain read — the source of truth. Also refreshes the API's cache as a side effect. */
export function getCommitment(contractId: string): Promise<CommitmentDetail> {
  return get<CommitmentDetail>(`/commitments/${encodeURIComponent(contractId)}`);
}

/** Postgres-cached list — the only way to enumerate commitments, since the chain has no such query. */
export function listCommitments(): Promise<CommitmentSummary[]> {
  return get<CommitmentSummary[]>("/commitments");
}

/** Builds unsigned XDR for a no-argument lifecycle method (e.g. `claim_advance_1`). The caller's wallet signs it next. */
export function buildTx(contractId: string, method: string, sourcePublicKey: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/${method}`, { sourcePublicKey });
}

/** Builds unsigned `flag_dispute` XDR. `flagger` must be the commitment's buyer, cooperative, or warehouse operator (enforced on-chain) — single-signer, so unlike resolve_dispute this needs no multi-party staging. */
export function buildFlagDisputeTx(contractId: string, flagger: string, sourcePublicKey: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/flag-dispute`, { flagger, sourcePublicKey });
}

export interface SubmitResult {
  status: "SUCCESS" | "FAILED";
  hash: string;
}

/** Submits a signed envelope. `refreshContractId` also refreshes the API's Postgres cache; `completeProposalId` marks a staged cancellation proposal finished. */
export function submitTx(signedXdr: string, refreshContractId?: string, completeProposalId?: string): Promise<SubmitResult> {
  return post<SubmitResult>("/transactions/submit", { xdr: signedXdr, refreshContractId, completeProposalId });
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
