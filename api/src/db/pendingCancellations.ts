import { pool } from "./pool.js";

/**
 * Staged multi-party signing for `cancel()` — see migration
 * 003_pending_cancellations.sql for the schema and the product context.
 * This module only ever reads/writes Postgres; it doesn't know anything
 * about Stellar XDR internals or how to rebuild a transaction — that's
 * `src/stellar/multiParty.ts`'s job, kept separate the same way
 * `db/commitments.ts` and `src/stellar/client.ts` are.
 */

export interface PendingAuthEntryRow {
  address: string | null;
  entryXdr: string;
  signedEntryXdr: string | null;
}

export interface PendingCancellationRow {
  id: string;
  contract_id: string;
  proposer_address: string;
  func_xdr: string;
  soroban_data_xdr: string;
  auth_entries: PendingAuthEntryRow[];
  status: "pending" | "ready" | "completed";
  final_xdr: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export async function createProposal(opts: {
  contractId: string;
  proposerAddress: string;
  funcXdr: string;
  sorobanDataXdr: string;
  entries: PendingAuthEntryRow[];
  expiresAt: Date;
}): Promise<PendingCancellationRow> {
  const { rows } = await pool.query<PendingCancellationRow>(
    `INSERT INTO pending_cancellations (contract_id, proposer_address, func_xdr, soroban_data_xdr, auth_entries, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [opts.contractId, opts.proposerAddress, opts.funcXdr, opts.sorobanDataXdr, JSON.stringify(opts.entries), opts.expiresAt],
  );
  const row = rows[0];
  if (!row) throw new Error("insert of pending cancellation returned no row");
  return row;
}

/**
 * Not a uniqueness constraint at the DB level (see the migration's
 * comment on the index) — "active" depends on `expires_at`, which a
 * constraint can't express, so this is the single place that decides
 * what counts as active. Everything that needs that answer calls this,
 * rather than each caller re-deriving the same WHERE clause.
 */
export async function findActiveProposal(contractId: string): Promise<PendingCancellationRow | null> {
  const { rows } = await pool.query<PendingCancellationRow>(
    `SELECT * FROM pending_cancellations
     WHERE contract_id = $1 AND status != 'completed' AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [contractId],
  );
  return rows[0] ?? null;
}

export async function getProposalById(id: string): Promise<PendingCancellationRow | null> {
  const { rows } = await pool.query<PendingCancellationRow>("SELECT * FROM pending_cancellations WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export type SignEntryResult =
  | { outcome: "not_found" }
  | { outcome: "no_matching_pending_entry" }
  | { outcome: "signed"; row: PendingCancellationRow; allSigned: boolean };

/**
 * Records one party's signed auth entry. Read-modify-write inside a
 * transaction with `SELECT ... FOR UPDATE`, not a bare UPDATE, because
 * the thing being modified (which element of a JSON array to touch) can't
 * be expressed as a single atomic SQL assignment the way a plain column
 * increment can — see `db/reputation.ts`'s `recordCooperativeForfeiture`
 * for the same reasoning applied to a JSON-free case. Without the lock,
 * two parties signing at nearly the same moment could each read the same
 * pre-update array and one write clobber the other's.
 */
export async function signProposalEntry(id: string, signerAddress: string, signedEntryXdr: string): Promise<SignEntryResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<PendingCancellationRow>("SELECT * FROM pending_cancellations WHERE id = $1 FOR UPDATE", [
      id,
    ]);
    const existing = rows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      return { outcome: "not_found" };
    }

    const entries = existing.auth_entries;
    const target = entries.find((e) => e.address === signerAddress && e.signedEntryXdr === null);
    if (!target) {
      await client.query("ROLLBACK");
      return { outcome: "no_matching_pending_entry" };
    }
    target.signedEntryXdr = signedEntryXdr;

    const allSigned = entries.every((e) => e.address === null || e.signedEntryXdr !== null);
    const { rows: updatedRows } = await client.query<PendingCancellationRow>(
      `UPDATE pending_cancellations SET auth_entries = $2 WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(entries)],
    );
    await client.query("COMMIT");
    return { outcome: "signed", row: updatedRows[0]!, allSigned };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function markReady(id: string, finalXdr: string): Promise<void> {
  await pool.query("UPDATE pending_cancellations SET status = 'ready', final_xdr = $2 WHERE id = $1", [id, finalXdr]);
}

export async function markCompleted(id: string): Promise<void> {
  await pool.query("UPDATE pending_cancellations SET status = 'completed' WHERE id = $1", [id]);
}
