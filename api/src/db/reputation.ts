import { pool } from "./pool.js";

/**
 * Off-chain reputation/strikes tracking — see migration 002_reputation.sql
 * for the schema and the product reasoning. This module is the only thing
 * that writes to `party_standing`/`standing_events`; callers describe what
 * happened (`recordBuyerDefault`/`recordCooperativeForfeiture`), they don't
 * touch SQL themselves.
 */

export interface PartyStanding {
  address: string;
  strike_count: number;
  barred: boolean;
  barred_reason: string | null;
  barred_at: string | null;
}

const FORFEITURE_STRIKES_BEFORE_BAR = 3;

/** Null if the address has no standing row yet — i.e. never barred or struck. */
export async function getStanding(address: string): Promise<PartyStanding | null> {
  const { rows } = await pool.query<PartyStanding>("SELECT * FROM party_standing WHERE address = $1", [address]);
  return rows[0] ?? null;
}

/**
 * Buyer default: immediate, permanent bar on first occurrence — no strike
 * counter needed for this direction, per this session's product decision
 * (asymmetric with cooperative forfeiture, deliberately — see
 * site/roles.html). Idempotent: calling this again for an already-barred
 * address is a no-op on the bar itself (COALESCE keeps the original
 * `barred_reason`/`barred_at`), so re-observing the same commitment's
 * `Defaulted` status twice can't overwrite a genuine first record.
 */
export async function recordBuyerDefault(address: string, contractId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO party_standing (address, barred, barred_reason, barred_at)
       VALUES ($1, TRUE, 'buyer_default', now())
       ON CONFLICT (address) DO UPDATE SET
         barred = TRUE,
         barred_reason = COALESCE(party_standing.barred_reason, 'buyer_default'),
         barred_at = COALESCE(party_standing.barred_at, now())`,
      [address],
    );
    await client.query(
      `INSERT INTO standing_events (address, contract_id, event_type) VALUES ($1, $2, 'buyer_default')`,
      [address, contractId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cooperative forfeiture: graduated — increments the strike count, only
 * bars once it reaches `FORFEITURE_STRIKES_BEFORE_BAR`. Returns the
 * standing row after the update so callers can tell whether this specific
 * call was the one that crossed the threshold.
 */
export async function recordCooperativeForfeiture(address: string, contractId: string): Promise<PartyStanding> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<PartyStanding>(
      `INSERT INTO party_standing (address, strike_count)
       VALUES ($1, 1)
       ON CONFLICT (address) DO UPDATE SET
         strike_count = party_standing.strike_count + 1
       RETURNING *`,
      [address],
    );
    let standing = rows[0]!;

    if (!standing.barred && standing.strike_count >= FORFEITURE_STRIKES_BEFORE_BAR) {
      const { rows: barredRows } = await client.query<PartyStanding>(
        `UPDATE party_standing SET barred = TRUE, barred_reason = 'cooperative_forfeiture_3x', barred_at = now()
         WHERE address = $1
         RETURNING *`,
        [address],
      );
      standing = barredRows[0]!;
    }

    await client.query(
      `INSERT INTO standing_events (address, contract_id, event_type) VALUES ($1, $2, 'cooperative_forfeiture')`,
      [address, contractId],
    );
    await client.query("COMMIT");
    return standing;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
