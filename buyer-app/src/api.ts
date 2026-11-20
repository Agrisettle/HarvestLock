import { withRetry } from "./retry";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** Mirrors api/src/server.ts's serializeCommitment — every bigint on the
 * chain type comes back as a string over HTTP, since JSON can't carry
 * bigint. Includes every field the contract's Commitment struct carries,
 * not just the ones this app's UI has needed so far — warehouse-app's
 * README flagged this copy (and coop-pwa's) as having drifted behind the
 * contract's actual shape; kept in sync here rather than adding to that
 * gap now that DisputeSection needs status/dispute fields this interface
 * never had. */
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
    const body = await res.text();
    throw new Error(`${path} -> ${res.status}: ${body}`);
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
    const responseBody = await res.text();
    throw new Error(`${path} -> ${res.status}: ${responseBody}`);
  }
  return res.json() as Promise<T>;
}

/** Live chain read — the source of truth. Also refreshes the API's cache as a side effect. */
export function getCommitment(contractId: string): Promise<CommitmentDetail> {
  return get<CommitmentDetail>(`/commitments/${encodeURIComponent(contractId)}`);
}

/**
 * Postgres-cached list — the only way to enumerate commitments, since the
 * chain has no such query. Pass `{ limit, offset }` to fetch one page of
 * the list instead of the first page: the API (api/src/db/commitments.ts)
 * defaults to 20 per page and clamps anything above its hard maximum, so
 * callers should treat a page of exactly `limit` rows as "maybe more",
 * not "done" — there is no total in the response shape.
 */
export function listCommitments(page?: { limit: number; offset: number }): Promise<CommitmentSummary[]> {
  if (!page) return get<CommitmentSummary[]>("/commitments");
  const query = new URLSearchParams({ limit: String(page.limit), offset: String(page.offset) });
  return get<CommitmentSummary[]>(`/commitments?${query.toString()}`);
}

/** Builds unsigned XDR for a no-argument lifecycle method (`lock`, `settle`). The caller's wallet signs it next. */
export function buildTx(contractId: string, method: string, sourcePublicKey: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/${method}`, { sourcePublicKey }, { retry: true });
}

/** Builds unsigned `flag_dispute` XDR. `flagger` must be the commitment's buyer, cooperative, or warehouse operator (enforced on-chain) — single-signer, so unlike resolve_dispute this needs no multi-party staging. */
export function buildFlagDisputeTx(contractId: string, flagger: string, sourcePublicKey: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/flag-dispute`, { flagger, sourcePublicKey }, { retry: true });
}

/** Deploys a fresh, uninitialized escrow contract instance. Deployer-paid — no party signature needed for this step. */
export function deployCommitment(): Promise<{ contractId: string }> {
  return post<{ contractId: string }>("/commitments/deploy", {});
}

export interface InitializeFields {
  buyer: string;
  cooperative: string;
  warehouseOperator: string;
  token: string;
  totalAmount: string;
  advance1Bps: number;
  advance2Bps: number;
  claimWindowSecs: string;
  remainderWindowSecs: string;
  deliveryWindowSecs: string;
  // Mirrors api/src/server.ts's InitializeBody — PRD §7's shortfall/grade
  // adjustment schedule and §16.3/§4.2's oracle FX conversion, both real
  // and live-verified at the API/contract layer well before any frontend
  // collected them (see CreateCommitmentForm.tsx's comment on this).
  contractedQuantity: number;
  gradePriceBps: number[];
  oracleConfig?: { oracleContract: string; priceAsset: string; maxAgeSecs: string; denominatedAmount: string } | null;
  sourcePublicKey: string;
}

/** Builds unsigned `initialize` XDR for a freshly-deployed contract. Must be signed by `fields.buyer`. */
export function buildInitializeTx(contractId: string, fields: InitializeFields): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/initialize`, fields, { retry: true });
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

/**
 * Rebuilds a ready proposal's final XDR at finalize time. The stored `ready_xdr`
 * was built when the last signer posted, with a 300 s time bound and a snapshot
 * of the proposer's sequence number, so by the time the proposer actually
 * clicks Finalize it can already be expired or have a stale sequence. The
 * freshly built envelope reuses the signed auth entries and simulation
 * footprint, so no signature is invalidated. Not retried: unlike a build, the
 * refresh has no side effects but also no need to race a retry.
 */
export function refreshReadyProposalXdr(contractId: string, proposalId: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(
    `/commitments/${encodeURIComponent(contractId)}/tx/propose/${encodeURIComponent(proposalId)}/refresh-ready`,
    {},
  );
}

// ---- Buyer KYB via anchor verification (issue #11, api/src/kyb.ts) ----

export interface KybConfig {
  /** "enforce" means the API refuses to put an unverified buyer on a new commitment. */
  enforcement: "off" | "enforce";
  trustedAnchors: string[];
  validityDays: number;
}

export interface BuyerVerification {
  account: string;
  anchor_domain: string;
  sep12_status: "ACCEPTED" | "PROCESSING" | "NEEDS_INFO" | "REJECTED";
  sep12_customer_id: string | null;
  checked_at: string;
  expires_at: string | null;
}

export interface BuyerVerificationStatus {
  account: string;
  verified: boolean;
  current: BuyerVerification | null;
  latest: BuyerVerification | null;
}

export function getKybConfig(): Promise<KybConfig> {
  return get<KybConfig>("/kyb/config");
}

export function getBuyerVerification(address: string): Promise<BuyerVerificationStatus> {
  return get<BuyerVerificationStatus>(`/kyb/buyers/${encodeURIComponent(address)}`);
}

/**
 * The anchor's SEP-10 challenge for `account`, already validated by the
 * API (genuine anchor signature, can never be submitted to the network).
 * The buyer's wallet signs it next. Retry-safe: fetching a challenge has
 * no side effects.
 */
export function createKybChallenge(account: string, anchorDomain: string): Promise<{ transaction: string; networkPassphrase: string }> {
  return post("/kyb/challenge", { account, anchorDomain }, { retry: true });
}

/** Exchanges the signed challenge with the anchor and records its SEP-12 verdict. Not retried. */
export function verifyKyb(
  account: string,
  anchorDomain: string,
  transaction: string,
): Promise<BuyerVerification & { verified: boolean }> {
  return post("/kyb/verify", { account, anchorDomain, transaction });
}

/** Mirrors GET /commitments/:contractId/oracle-config. `config` is null for a plain deal with no FX conversion. */
export interface OracleConfig {
  oracleContract: string;
  priceAsset: string;
  maxAgeSecs: string;
  denominatedAmount: string;
}

/** Live on-chain read of the commitment's oracle config (PRD §16.3 / §4.2 option (b)). */
export function getOracleConfig(contractId: string): Promise<{ config: OracleConfig | null }> {
  return get<{ config: OracleConfig | null }>(`/commitments/${encodeURIComponent(contractId)}/oracle-config`);
}

/**
 * A genuinely live Reflector quote, read through the contract on every
 * call (never cached by the API). Rejects when the quote is stale, missing,
 * or no oracle is configured; the API answers those as a 409 with the
 * contract's own error name.
 */
export function getOracleRate(contractId: string): Promise<{ price: string; timestamp: string }> {
  return get<{ price: string; timestamp: string }>(`/commitments/${encodeURIComponent(contractId)}/oracle-rate`);
}
