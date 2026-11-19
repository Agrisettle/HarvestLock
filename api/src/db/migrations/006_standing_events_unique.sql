-- Key reputation idempotency on the event itself, not on observing a
-- status transition. Two concurrent first reads of an already-terminal
-- commitment (no cached row yet, so no row for upsertCommitment's
-- `SELECT ... FOR UPDATE` to lock) could both record a consequence for
-- the same forfeiture, double-striking the cooperative. Conversely, a
-- consequence write that failed after the commitments upsert committed
-- was never retried: every later read saw previousStatus === status and
-- skipped. standing_events is now the uniqueness source, so each
-- (contract, event type) can be recorded at most once no matter how many
-- readers race or how often a failed write is retried.
--
-- Deduplicate existing rows first: the old code could have inserted the
-- same contract's event more than once. Keep the earliest row per
-- (contract_id, event_type), using id as the tie-break for identical
-- timestamps. Party standing counters are intentionally not recomputed
-- here -- this migration only makes the audit log safe to constrain;
-- correcting an already-inflated counter is a separate,
-- human-reviewed action (the same reasoning as an appeal).

DELETE FROM standing_events AS duplicate
USING standing_events AS keeper
WHERE duplicate.contract_id = keeper.contract_id
  AND duplicate.event_type = keeper.event_type
  AND (duplicate.created_at, duplicate.id) > (keeper.created_at, keeper.id);

ALTER TABLE standing_events
  ADD CONSTRAINT standing_events_contract_event_unique UNIQUE (contract_id, event_type);
