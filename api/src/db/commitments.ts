import { pool } from "./pool.js";
import type { Commitment } from "../stellar/client.js";

/**
 * Postgres mirrors on-chain state for fast/listable reads — it is not the
 * source of truth (PRD §17, HANDOFF.md). Every write here is a cache
 * refresh derived from a live chain read, never an independent write.
 */
export interface CommitmentRow {
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

export async function upsertCommitment(contractId: string, c: Commitment): Promise<CommitmentRow> {
  const { rows } = await pool.query<CommitmentRow>(
    `INSERT INTO commitments
       (contract_id, buyer_address, cooperative_address, warehouse_address, token_address,
        total_amount, advance1_bps, advance2_bps, claim_window_secs, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (contract_id) DO UPDATE SET
       status = EXCLUDED.status,
       updated_at = now()
     RETURNING *`,
    [
      contractId,
      c.buyer,
      c.cooperative,
      c.warehouse_operator,
      c.token,
      c.total_amount.toString(),
      c.advance1_bps,
      c.advance2_bps,
      c.claim_window_secs.toString(),
      c.status,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error(`upsert of commitment ${contractId} returned no row`);
  return row;
}

export async function listCommitments(): Promise<CommitmentRow[]> {
  const { rows } = await pool.query<CommitmentRow>("SELECT * FROM commitments ORDER BY created_at DESC");
  return rows;
}
