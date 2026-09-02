const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** Mirrors api/src/server.ts's serializeCommitment — every bigint on the
 * chain type comes back as a string over HTTP, since JSON can't carry bigint. */
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
  created_at: string;
  advance1_deadline: string;
  advance1_claimed: boolean;
  advance1_expired: boolean;
  advance2_deadline: string;
  advance2_claimed: boolean;
  advance2_expired: boolean;
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

/** Builds unsigned XDR for a no-argument lifecycle method (`lock`, `settle`). The caller's wallet signs it next. */
export function buildTx(contractId: string, method: string, sourcePublicKey: string): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/${method}`, { sourcePublicKey });
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
  sourcePublicKey: string;
}

/** Builds unsigned `initialize` XDR for a freshly-deployed contract. Must be signed by `fields.buyer`. */
export function buildInitializeTx(contractId: string, fields: InitializeFields): Promise<{ xdr: string }> {
  return post<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}/tx/initialize`, fields);
}

export interface SubmitResult {
  status: "SUCCESS" | "FAILED";
  hash: string;
}

/** Submits a signed envelope. `refreshContractId` also refreshes the API's Postgres cache as a side effect. */
export function submitTx(signedXdr: string, refreshContractId?: string): Promise<SubmitResult> {
  return post<SubmitResult>("/transactions/submit", { xdr: signedXdr, refreshContractId });
}
