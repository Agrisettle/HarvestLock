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
 * site/roles.html).
 *
 * Exactly-once is keyed on `standing_events`' UNIQUE (contract_id,
 * event_type), not on the caller having observed a status transition:
 * the event insert (and only it) decides whether the bar is applied. Two
 * concurrent first reads of the same already-Defaulted contract therefore
 * can't double-apply, and a retry after a failed attempt still lands
 * because the failed transaction rolled the event insert back too.
 * Calling this again for a different contract defaulting the same buyer
 * inserts a new event but COALESCE still keeps the original
 * `barred_reason`/`barred_at`.
 */
export async function recordBuyerDefault(address: string, contractId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO standing_events (address, contract_id, event_type)
       VALUES ($1, $2, 'buyer_default')
       ON CONFLICT (contract_id, event_type) DO NOTHING
       RETURNING id`,
      [address, contractId],
    );
    if (inserted.length === 1) {
      await client.query(
        `INSERT INTO party_standing (address, barred, barred_reason, barred_at)
         VALUES ($1, TRUE, 'buyer_default', now())
         ON CONFLICT (address) DO UPDATE SET
           barred = TRUE,
           barred_reason = COALESCE(party_standing.barred_reason, 'buyer_default'),
           barred_at = COALESCE(party_standing.barred_at, now())`,
        [address],
      );
    }
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
 *
 * Like recordBuyerDefault, the `standing_events` insert is the
 * exactly-once gate: a duplicate (contract_id, event_type) does no
 * counter work and returns the current standing unchanged. The event and
 * the standing update share one transaction, so a failure can never leave
 * the event recorded without its strike (which would lose the strike
 * forever) or the strike without its event.
 */
export async function recordCooperativeForfeiture(address: string, contractId: string): Promise<PartyStanding> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO standing_events (address, contract_id, event_type)
       VALUES ($1, $2, 'cooperative_forfeiture')
       ON CONFLICT (contract_id, event_type) DO NOTHING
       RETURNING id`,
      [address, contractId],
    );

    if (inserted.length === 0) {
      const { rows } = await client.query<PartyStanding>("SELECT * FROM party_standing WHERE address = $1", [
        address,
      ]);
      const existing = rows[0];
      if (!existing) {
        throw new Error(`standing event exists for ${contractId} but no standing row exists for ${address}`);
      }
      await client.query("COMMIT");
      return existing;
    }

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

    await client.query("COMMIT");
    return standing;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
