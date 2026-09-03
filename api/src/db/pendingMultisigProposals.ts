import { pool } from "./pool.js";

/**
 * Staged multi-party signing — see migration 004_generalize_multisig_proposals.sql
 * for the schema and how this generalized from cancel-only
 * (pending_cancellations) to also cover reassign_buyer. This module only
 * ever reads/writes Postgres; it doesn't know anything about Stellar XDR
 * internals or how to rebuild a transaction — that's
 * `src/stellar/multiParty.ts`'s job, kept separate the same way
 * `db/commitments.ts` and `src/stellar/client.ts` are.
 */

export interface PendingAuthEntryRow {
  address: string | null;
  entryXdr: string;
  signedEntryXdr: string | null;
}

export interface PendingMultisigProposal {
  id: string;
  contract_id: string;
  method: string;
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
  method: string;
  proposerAddress: string;
  funcXdr: string;
  sorobanDataXdr: string;
  entries: PendingAuthEntryRow[];
  expiresAt: Date;
}): Promise<PendingMultisigProposal> {
  const { rows } = await pool.query<PendingMultisigProposal>(
    `INSERT INTO pending_multisig_proposals (contract_id, method, proposer_address, func_xdr, soroban_data_xdr, auth_entries, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      opts.contractId,
      opts.method,
      opts.proposerAddress,
      opts.funcXdr,
      opts.sorobanDataXdr,
      JSON.stringify(opts.entries),
      opts.expiresAt,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("insert of multisig proposal returned no row");
  return row;
}

/**
 * Scoped per-`method`, not just `contractId` — a contract can have at
 * most one active `cancel` proposal and, independently, at most one
 * active `reassign_buyer` proposal at the same time; the two don't block
 * each other. Not a uniqueness constraint at the DB level (see the
 * migration's comment on the index) — "active" depends on `expires_at`,
 * which a constraint can't express, so this is the single place that
 * decides what counts as active.
 */
export async function findActiveProposal(contractId: string, method: string): Promise<PendingMultisigProposal | null> {
  const { rows } = await pool.query<PendingMultisigProposal>(
    `SELECT * FROM pending_multisig_proposals
     WHERE contract_id = $1 AND method = $2 AND status != 'completed' AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [contractId, method],
  );
  return rows[0] ?? null;
}

export async function getProposalById(id: string): Promise<PendingMultisigProposal | null> {
  const { rows } = await pool.query<PendingMultisigProposal>("SELECT * FROM pending_multisig_proposals WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export type SignEntryResult =
  | { outcome: "not_found" }
  | { outcome: "no_matching_pending_entry" }
  | { outcome: "signed"; row: PendingMultisigProposal; allSigned: boolean };

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
    const { rows } = await client.query<PendingMultisigProposal>(
      "SELECT * FROM pending_multisig_proposals WHERE id = $1 FOR UPDATE",
      [id],
    );
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
    const { rows: updatedRows } = await client.query<PendingMultisigProposal>(
      `UPDATE pending_multisig_proposals SET auth_entries = $2 WHERE id = $1 RETURNING *`,
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
  await pool.query("UPDATE pending_multisig_proposals SET status = 'ready', final_xdr = $2 WHERE id = $1", [id, finalXdr]);
}

export async function markCompleted(id: string): Promise<void> {
  await pool.query("UPDATE pending_multisig_proposals SET status = 'completed' WHERE id = $1", [id]);
}
