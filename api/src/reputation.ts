import type { Commitment } from "./stellar/client.js";
import { recordBuyerDefault, recordCooperativeForfeiture, getStanding, type PartyStanding } from "./db/reputation.js";

const TERMINAL_STATUSES_WITH_CONSEQUENCES = new Set(["Defaulted", "Forfeited"]);

/**
 * Applies the buyer-default/cooperative-forfeiture reputation consequence
 * for a commitment, exactly once — the first time this API observes the
 * transition into a terminal status, never on a later re-read of an
 * already-terminal one. Call this after `upsertCommitment`, passing the
 * `previousStatus` it returned.
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
  previousStatus: string | null,
  commitment: Commitment,
): Promise<void> {
  if (previousStatus === commitment.status) return;
  if (!TERMINAL_STATUSES_WITH_CONSEQUENCES.has(commitment.status)) return;

  if (commitment.status === "Defaulted") {
    await recordBuyerDefault(commitment.buyer, contractId);
  } else if (commitment.status === "Forfeited") {
    await recordCooperativeForfeiture(commitment.cooperative, contractId);
  }
}

export { getStanding, type PartyStanding };
