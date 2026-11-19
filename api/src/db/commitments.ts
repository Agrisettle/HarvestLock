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

export interface UpsertResult {
  row: CommitmentRow;
  /** The cached status immediately before this upsert, or null if this contract had no cached row yet. */
  previousStatus: string | null;
}

/**
 * Reads the prior cached status and writes the new one inside a single
 * transaction (`SELECT ... FOR UPDATE` then the upsert), returning
 * `previousStatus` alongside the row. Reputation idempotency no longer
 * depends on this value — `standing_events`' UNIQUE (contract_id,
 * event_type) is the exactly-once gate now (see `src/reputation.ts` and
 * `src/db/reputation.ts`) — but the read/write pairing still gives any
 * caller a consistent "before and after" view of the cache, and existing
 * callers/tests use it.
 */
export async function upsertCommitment(contractId: string, c: Commitment): Promise<UpsertResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query<{ status: string }>(
      "SELECT status FROM commitments WHERE contract_id = $1 FOR UPDATE",
      [contractId],
    );
    const previousStatus = existing[0]?.status ?? null;

    const { rows } = await client.query<CommitmentRow>(
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

    await client.query("COMMIT");
    return { row, previousStatus };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Default page size for the commitments list when the caller passes no (or an unusable) limit. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Hard ceiling on the commitments list's page size. The route clamps any
 * larger requested limit down to this, so no request can ask the cache
 * for an unbounded slice no matter what query string it sends — the exact
 * failure mode issue #225 was filed against.
 */
export const MAX_PAGE_SIZE = 100;

export async function listCommitments({ limit, offset }: { limit?: number; offset?: number } = {}): Promise<CommitmentRow[]> {
  const limitNum = limit ?? DEFAULT_PAGE_SIZE;
  const offsetNum = offset ?? 0;
  // `id` tiebreak: created_at alone is not a stable sort key — every row
  // upserted in the same transaction shares a now() timestamp, and with
  // ties Postgres is free to return each page in a different order, which
  // makes consecutive pages skip or duplicate rows. A unique column last
  // makes the order total, so pages always partition the set exactly.
  const { rows } = await pool.query<CommitmentRow>(
    `SELECT * FROM commitments ORDER BY created_at DESC, id LIMIT $1 OFFSET $2`,
    [limitNum, offsetNum],
  );
  return rows;
}
