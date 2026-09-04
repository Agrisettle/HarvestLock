import { createHmac, randomBytes } from "node:crypto";
import { pool } from "./pool.js";

/**
 * Off-chain half of the PRD §4.8/§16.1 allocation ledger — see migration
 * 005_allocation_members.sql for the schema and the NDPA-erasability
 * reasoning. The contract (HarvestLock-Contracts) only ever sees
 * `member_hash`/`share_bps`; this module is the only place a phone
 * number and the salt that hashed it ever meet.
 */

export interface StagedAllocationMember {
  phoneNumber: string;
  shareBps: number;
  /** Hex-encoded, fresh per member — never reused. */
  salt: string;
  /** Hex-encoded HMAC-SHA256(salt, phoneNumber) — what actually goes on-chain. */
  memberHash: string;
}

export interface AllocationMemberRow {
  id: string;
  contract_id: string;
  share_bps: number;
  member_hash: string;
  created_at: string;
  erased_at: string | null;
}

/**
 * Computes the salt+hash for each member without writing anything yet —
 * the caller builds the on-chain `set_allocation` transaction from these
 * hashes first; only once that transaction actually lands should
 * `recordAllocationMembers` persist the phone-number mapping (see
 * `/transactions/submit`'s `allocationMembers` handling in server.ts).
 * Staging and persisting are deliberately separate calls so a proposal
 * that's built but never submitted doesn't leave an orphaned off-chain
 * row referencing a hash nobody ever put on-chain.
 */
export function stageAllocationMembers(
  members: { phoneNumber: string; shareBps: number }[],
): StagedAllocationMember[] {
  return members.map((m) => {
    const salt = randomBytes(32).toString("hex");
    const memberHash = createHmac("sha256", Buffer.from(salt, "hex")).update(m.phoneNumber).digest("hex");
    return { phoneNumber: m.phoneNumber, shareBps: m.shareBps, salt, memberHash };
  });
}

/** Persists the phone-number mapping once the on-chain `set_allocation` call has actually succeeded. */
export async function recordAllocationMembers(contractId: string, members: StagedAllocationMember[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const m of members) {
      await client.query(
        `INSERT INTO allocation_members (contract_id, phone_number, share_bps, salt, member_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [contractId, m.phoneNumber, m.shareBps, m.salt, m.memberHash],
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
 * Never returns `phone_number` — no auth/session model exists yet (PRD
 * §17/MVP framing), so there's no way to gate who's allowed to see PII
 * through this API. Callers get the anonymized economic record
 * (`share_bps`, `member_hash`, whether it's been erased); the phone
 * number itself is write-only through this API.
 */
export async function getAllocationMembers(contractId: string): Promise<AllocationMemberRow[]> {
  const { rows } = await pool.query<AllocationMemberRow>(
    `SELECT id, contract_id, share_bps, member_hash, created_at, erased_at
     FROM allocation_members WHERE contract_id = $1 ORDER BY created_at`,
    [contractId],
  );
  return rows;
}

/**
 * NDPA s.34 erasure: nulls out `phone_number`, leaving `share_bps`/
 * `member_hash` intact. Idempotent — erasing an already-erased row is a
 * no-op, not an error. Returns false if no row with this hash exists at
 * all (a genuinely unknown hash, not just an already-erased one).
 */
export async function eraseAllocationMember(memberHash: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE allocation_members
     SET phone_number = NULL, erased_at = COALESCE(erased_at, now())
     WHERE member_hash = $1`,
    [memberHash],
  );
  return (rowCount ?? 0) > 0;
}
