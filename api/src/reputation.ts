import type { Commitment } from "./stellar/client.js";
import { recordBuyerDefault, recordCooperativeForfeiture, getStanding, type PartyStanding } from "./db/reputation.js";

const TERMINAL_STATUSES_WITH_CONSEQUENCES = new Set(["Defaulted", "Forfeited"]);

/**
 * Applies the buyer-default/cooperative-forfeiture reputation consequence
 * for a commitment, exactly once per (contract, event type). Call this
 * after `upsertCommitment` whenever the observed status is terminal.
 *
 * `previousStatus` is intentionally not consulted: idempotency lives in
 * `standing_events`' UNIQUE constraint, checked by each record* function.
 * Comparing against the previous cached status was wrong in both
 * directions — two concurrent first reads of an already-terminal contract
 * could both see `null` and double-strike, and a write that failed after
 * the cache said Defaulted/Forfeited was never retried because every
 * later read saw the status "unchanged". The parameter is kept so callers
 * that already have it don't need a second read; it has no effect on
 * whether a consequence is recorded.
 *
 * Deliberately observation-triggered, not backed by a chain indexer or
 * background watcher — same caveat `api/README.md` already documents for
 * the commitments cache itself (can go stale for a contract nobody has
 * read recently). A default/forfeiture nobody ever calls `GET` or
 * `/transactions/submit?refreshContractId` on won't be recorded here
 * until someone does. Acceptable for now, same reasoning as the cache
 * staleness: no real usage yet to justify building a poller ahead of it.
 */
export async function applyReputationConsequences(
  contractId: string,
  _previousStatus: string | null,
  commitment: Commitment,
): Promise<void> {
  if (!TERMINAL_STATUSES_WITH_CONSEQUENCES.has(commitment.status)) return;

  if (commitment.status === "Defaulted") {
    await recordBuyerDefault(commitment.buyer, contractId);
  } else if (commitment.status === "Forfeited") {
    await recordCooperativeForfeiture(commitment.cooperative, contractId);
  }
}

export { getStanding, type PartyStanding };
