const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** Mirrors api/src/db/../stellar/client.ts's Commitment (via server.ts's
 * serializeCommitment) -- every bigint on the chain type comes back as a
 * string over HTTP, since JSON can't carry bigint. Includes the PRD §7
 * shortfall/grade fields buyer-app/coop-pwa's copy of this interface
 * doesn't need for their own UI, but this app does: confirming delivery
 * means reading contracted_quantity and grade_price_bps to build the form,
 * and displaying delivered_quantity/grade_index/settlement_bps once
 * confirm_delivery has already run. */
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

/** Builds unsigned XDR for a no-argument lifecycle method. This app only
 * ever calls it with "mark_checkpoint" — the other no-arg methods belong
 * to the buyer/cooperative, not the warehouse operator. */
export function buildTx(contractId: string, method: string, sourcePublicKey: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/${method}`, { sourcePublicKey });
}

/** Builds unsigned `confirm_delivery` XDR. Single-signer (warehouse_operator
 * only, per lib.rs's require_auth) — no multi-party staging needed, unlike
 * cancel/reassign_buyer. Has its own route rather than the generic no-arg
 * one because it takes arguments (PRD §7 shortfall/grade adjustment). */
export function buildConfirmDeliveryTx(
  contractId: string,
  deliveredQuantity: number,
  gradeIndex: number,
  sourcePublicKey: string,
): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/confirm-delivery`, {
    deliveredQuantity,
    gradeIndex,
    sourcePublicKey,
  });
}

/** Builds unsigned `flag_dispute` XDR. `flagger` must be the commitment's buyer, cooperative, or warehouse operator (enforced on-chain) — single-signer, so unlike resolve_dispute this needs no multi-party staging. */
export function buildFlagDisputeTx(contractId: string, flagger: string, sourcePublicKey: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/flag-dispute`, { flagger, sourcePublicKey });
}

export interface SubmitResult {
  status: "SUCCESS" | "FAILED";
  hash: string;
}

/** Submits a signed envelope. `refreshContractId` also refreshes the API's Postgres cache; `completeProposalId` marks a staged resolve-dispute proposal finished. */
export function submitTx(signedXdr: string, refreshContractId?: string, completeProposalId?: string): Promise<SubmitResult> {
  return post<SubmitResult>("/transactions/submit", { xdr: signedXdr, refreshContractId, completeProposalId });
}

/** Mirrors api/src/server.ts's serializeProposal — the staged multi-party propose/sign/finalize flow's public shape. This app only ever proposes/signs `resolve_dispute` (`cancel`/`reassign_buyer` belong to the buyer/cooperative), but the type covers all three since `signMultisigProposal`'s response is method-agnostic regardless of which one created the proposal. */
export interface MultisigProposal {
  id: string;
  contract_id: string;
  method: "cancel" | "reassign_buyer" | "resolve_dispute";
  proposer_address: string;
  status: "pending" | "ready" | "completed";
  pending_entries: { address: string; entry_xdr: string }[];
  ready_xdr: string | null;
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

/** Records one party's signed auth entry against a proposal — method-agnostic, since a proposal ID is already unique. Once every pending entry is signed, the response's status flips to "ready". */
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
