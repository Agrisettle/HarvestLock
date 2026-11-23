import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  API_URL,
  FRIENDBOT_URL,
  HORIZON_URL,
  NATIVE_TOKEN_CONTRACT,
  NETWORK_PASSPHRASE,
  WINDOW_SECS,
} from "./env";

/**
 * Node-side direct API client used only to set up a test's preconditions
 * — e.g. coop-pwa's claim needs a commitment that has already been
 * locked and had its advance released, which is a state no current
 * single-app UI can reach alone. These calls are the same real HTTP
 * routes and real testnet transactions the apps use (build unsigned XDR
 * → sign with the party's keypair → submit), just driven from the test
 * instead of through a browser; nothing is mocked. The action under test
 * itself always goes through the app's UI.
 */

export interface CommitmentDetail {
  status: string;
  buyer: string;
  cooperative: string;
  warehouse_operator: string;
  token: string;
  total_amount: string;
  advance1_bps: number;
  advance2_bps: number;
  advance1_deadline: string;
  advance1_claimed: boolean;
  advance1_expired: boolean;
  advance2_deadline: string;
  advance2_claimed: boolean;
  advance2_expired: boolean;
  remainder_funded: boolean;
  contracted_quantity: number;
  grade_price_bps: number[];
  delivered_quantity: number;
  grade_index: number;
  settlement_bps: number;
  dispute_pre_status: string;
  dispute_deadline: string;
}

export interface Parties {
  buyer: Keypair;
  cooperative: Keypair;
  warehouse: Keypair;
}

const JSON_HEADERS = { "content-type": "application/json" };

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status}: ${body}`);
  }
  return JSON.parse(body) as T;
}

/**
 * Makes sure a party's testnet account exists so contract auth (which
 * reads the account ledger entry) can verify its signatures — a bare,
 * never-funded keypair fails with a `missing_value` storage error, not a
 * signature error (api/test/helpers.ts documents this). Fresh random
 * keypairs are funded via friendbot; a pre-funded E2E_*_SECRET is left
 * alone. Friendbot gets a couple of retries because the API's own
 * HANDOFF.md records it rate-limiting under repeated use — a real,
 * observed failure mode, not a hypothetical.
 */
export async function ensureFunded(publicKey: string): Promise<void> {
  const account = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (account.ok) return;
  if (account.status !== 404) {
    throw new Error(`checking testnet account ${publicKey} failed: HTTP ${account.status}: ${await account.text()}`);
  }

  let lastFailure = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
    if (res.ok) return;
    lastFailure = `HTTP ${res.status}: ${await res.text()}`;
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  throw new Error(`friendbot could not fund ${publicKey} after 3 attempts (${lastFailure})`);
}

async function buildSignSubmit(
  contractId: string,
  txPath: string,
  body: Record<string, unknown>,
  signer: Keypair,
): Promise<void> {
  const { xdr } = await apiRequest<{ xdr: string }>(`/commitments/${encodeURIComponent(contractId)}${txPath}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
  tx.sign(signer);
  await apiRequest("/transactions/submit", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ xdr: tx.toXDR(), refreshContractId: contractId }),
  });
}

/**
 * Deploys + initializes a plain (no oracle) commitment with the shortest
 * windows the API's own validation allows — same values the API's live
 * test suite uses (api/test/stellar.test.ts), including the native-XLM
 * SAC as the token, so `lock` escrows and `claim_advance_*` pays out
 * real testnet XLM. Ends at status Draft.
 */
export async function deployAndInitialize(parties: Parties): Promise<string> {
  const { contractId } = await apiRequest<{ contractId: string }>("/commitments/deploy", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({}),
  });

  await buildSignSubmit(
    contractId,
    "/tx/initialize",
    {
      buyer: parties.buyer.publicKey(),
      cooperative: parties.cooperative.publicKey(),
      warehouseOperator: parties.warehouse.publicKey(),
      token: NATIVE_TOKEN_CONTRACT,
      totalAmount: "1000000000",
      advance1Bps: 1500,
      advance2Bps: 2000,
      claimWindowSecs: WINDOW_SECS.claim,
      remainderWindowSecs: WINDOW_SECS.remainder,
      deliveryWindowSecs: WINDOW_SECS.delivery,
      contractedQuantity: 1000,
      gradePriceBps: [10_000, 9_000, 7_500],
      oracleConfig: null,
      sourcePublicKey: parties.buyer.publicKey(),
    },
    parties.buyer,
  );

  return contractId;
}

/**
 * Runs an arbitrary no-arg lifecycle method as `signer` (source and
 * signer, the same single-signer shape every such call has — the caller
 * must be the party the contract's `require_auth` names, e.g. `lock` →
 * buyer, `release_advance_1`/`mark_checkpoint` → warehouse,
 * `ready_for_delivery` → cooperative, `fund_remainder` → buyer).
 */
export function submitMethod(contractId: string, method: string, signer: Keypair): Promise<void> {
  return buildSignSubmit(contractId, `/tx/${method}`, { sourcePublicKey: signer.publicKey() }, signer);
}

/** Confirms delivery as the warehouse operator with the requested delivered quantity and grade bucket. */
export function confirmDelivery(
  contractId: string,
  warehouse: Keypair,
  deliveredQuantity: number,
  gradeIndex = 0,
): Promise<void> {
  return buildSignSubmit(
    contractId,
    "/tx/confirm-delivery",
    {
      deliveredQuantity,
      gradeIndex,
      sourcePublicKey: warehouse.publicKey(),
    },
    warehouse,
  );
}

/** Live chain read through the real API — the same source of truth the apps render. */
export function getCommitment(contractId: string): Promise<CommitmentDetail> {
  return apiRequest<CommitmentDetail>(`/commitments/${encodeURIComponent(contractId)}`);
}

/**
 * Flags a dispute as `flagger` — build `/tx/flag-dispute`, sign, submit,
 * refresh. Single-signer (`flag_dispute` only requires the flagger's own
 * auth), so unlike the propose routes below this is the same
 * build → sign → submit shape as `submitMethod`, just with an argument.
 */
export function flagDispute(contractId: string, flagger: Keypair): Promise<void> {
  return buildSignSubmit(
    contractId,
    "/tx/flag-dispute",
    { flagger: flagger.publicKey(), sourcePublicKey: flagger.publicKey() },
    flagger,
  );
}

/** Mirrors api/src/server.ts's serializeProposal. */
export interface MultisigProposal {
  id: string;
  contract_id: string;
  method: "cancel" | "reassign_buyer" | "resolve_dispute";
  proposer_address: string;
  status: "pending" | "ready" | "completed";
  pending_entries: { address: string; entry_xdr: string }[];
  ready_xdr: string | null;
}

export function getCancelProposal(contractId: string): Promise<{ proposal: MultisigProposal | null }> {
  return apiRequest<{ proposal: MultisigProposal | null }>(
    `/commitments/${encodeURIComponent(contractId)}/tx/cancel/propose`,
  );
}

/**
 * Proposes resolving a dispute as `proposer`. No signature is involved:
 * the API simulates `resolve_dispute`, stages the OTHER two parties'
 * auth entries, and stores the proposal — the proposer's own classic
 * signature only happens later, at finalize.
 */
export function proposeResolveDispute(contractId: string, proposer: Keypair): Promise<MultisigProposal> {
  return apiRequest<MultisigProposal>(`/commitments/${encodeURIComponent(contractId)}/tx/resolve-dispute/propose`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ proposerPublicKey: proposer.publicKey() }),
  });
}

export function getResolveDisputeProposal(contractId: string): Promise<{ proposal: MultisigProposal | null }> {
  return apiRequest<{ proposal: MultisigProposal | null }>(
    `/commitments/${encodeURIComponent(contractId)}/tx/resolve-dispute/propose`,
  );
}

/** Proposes reassigning the buyer position. Like resolve-dispute's propose, this stages auth entries and signs nothing. */
export function proposeReassignBuyer(
  contractId: string,
  proposer: Keypair,
  newBuyerPublicKey: string,
): Promise<MultisigProposal> {
  return apiRequest<MultisigProposal>(`/commitments/${encodeURIComponent(contractId)}/tx/reassign-buyer/propose`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ proposerPublicKey: proposer.publicKey(), newBuyer: newBuyerPublicKey }),
  });
}

export function getReassignBuyerProposal(contractId: string): Promise<{ proposal: MultisigProposal | null }> {
  return apiRequest<{ proposal: MultisigProposal | null }>(
    `/commitments/${encodeURIComponent(contractId)}/tx/reassign-buyer/propose`,
  );
}

export interface AllocationMemberDetail {
  memberHash: string;
  shareBps: number;
}

/**
 * Live on-chain allocation ledger. `null` when nothing has been recorded
 * yet — the contract's `AllocationNotSet` error, the same expected state
 * coop-pwa's api.ts turns into `null` rather than a failure.
 */
export async function getAllocationLedger(contractId: string): Promise<AllocationMemberDetail[] | null> {
  try {
    const { members } = await apiRequest<{ members: AllocationMemberDetail[] }>(
      `/commitments/${encodeURIComponent(contractId)}/allocation`,
    );
    return members;
  } catch (err) {
    if (err instanceof Error && /AllocationNotSet|Error\(Contract, #23\)/.test(err.message)) {
      return null;
    }
    throw err;
  }
}
