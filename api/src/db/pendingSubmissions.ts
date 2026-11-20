import { pool } from "./pool.js";
import type { StagedAllocationMember } from "./allocationMembers.js";

/**
 * Persistence for transactions whose confirmation outlived the submit
 * route's poll window (issue #405). See migration
 * 007_pending_submissions.sql for the state machine and why every
 * side-effect field is stored here.
 *
 * The API only ever calls `createPendingSubmission` after the network
 * accepted the transaction, and only ever claims side effects via the
 * atomic `claimPendingSubmissionSuccess` UPDATE — never by reading the
 * row first and writing after, which would let two concurrent polls both
 * apply a non-idempotent side effect.
 */

export type PendingSubmissionStatus = "pending" | "success" | "failed";

export interface PendingSubmissionRow {
  hash: string;
  status: PendingSubmissionStatus;
  refresh_contract_id: string | null;
  complete_proposal_id: string | null;
  allocation_contract_id: string | null;
  allocation_members: StagedAllocationMember[] | null;
  side_effects_applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createPendingSubmission(opts: {
  hash: string;
  refreshContractId?: string;
  completeProposalId?: string;
  allocationContractId?: string;
  allocationMembers?: StagedAllocationMember[];
}): Promise<PendingSubmissionRow> {
  const hash = opts.hash.toLowerCase();
  const { rows } = await pool.query<PendingSubmissionRow>(
    `INSERT INTO pending_submissions
       (hash, refresh_contract_id, complete_proposal_id, allocation_contract_id, allocation_members)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (hash) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      hash,
      opts.refreshContractId ?? null,
      opts.completeProposalId ?? null,
      opts.allocationContractId ?? null,
      opts.allocationMembers ? JSON.stringify(opts.allocationMembers) : null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("insert of pending submission returned no row");
  return row;
}

export async function getPendingSubmission(hash: string): Promise<PendingSubmissionRow | null> {
  const { rows } = await pool.query<PendingSubmissionRow>(
    "SELECT * FROM pending_submissions WHERE hash = $1",
    [hash.toLowerCase()],
  );
  return rows[0] ?? null;
}

/**
 * Atomically flips `pending` -> `success` and returns the row only to the
 * caller that won the race. Exactly one poll therefore applies the stored
 * side effects; every later poll sees a terminal status and returns the
 * cached answer without touching the chain or the side-effect fields.
 */
export async function claimPendingSubmissionSuccess(hash: string): Promise<PendingSubmissionRow | null> {
  const { rows } = await pool.query<PendingSubmissionRow>(
    `UPDATE pending_submissions
     SET status = 'success', side_effects_applied_at = now(), updated_at = now()
     WHERE hash = $1 AND status = 'pending'
     RETURNING *`,
    [hash.toLowerCase()],
  );
  return rows[0] ?? null;
}

/** Terminal failure from the chain. Nothing to apply, nothing to retry. */
export async function markPendingSubmissionFailed(hash: string): Promise<void> {
  await pool.query(
    `UPDATE pending_submissions
     SET status = 'failed', updated_at = now()
     WHERE hash = $1 AND status = 'pending'`,
    [hash.toLowerCase()],
  );
}
