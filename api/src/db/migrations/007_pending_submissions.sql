-- A transaction that was accepted by the network but whose confirmation
-- outlived submitSignedTransaction's 30 s poll used to be reported as a
-- 500. The transaction is already on chain by then, so that told the
-- caller their real, funds-moving action had failed — and the submit
-- route's side effects (cache refresh, marking a staged multisig
-- proposal completed, persisting allocation phone numbers) never ran.
--
-- This table is what makes the honest answer possible: the hash plus
-- every side-effect field the submit request carried, so a later
-- GET /transactions/:hash can report the real outcome and apply those
-- side effects exactly once the first time it observes SUCCESS.
--
-- status is a small state machine:
--   pending -> success  (first SUCCESS observation; side effects claimed)
--   pending -> failed   (chain reported FAILED; no side effects)
-- Both terminal states are final. side_effects_applied_at is set in the
-- same atomic UPDATE that flips pending -> success, so two concurrent
-- polls cannot both run the side effects.

CREATE TABLE pending_submissions (
  -- The Stellar transaction hash: exactly 64 lowercase hex characters.
  -- Stored lowercase (the API normalizes before lookup) so a caller can
  -- use either case in GET /transactions/:hash without a second row.
  hash                    TEXT PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'success', 'failed')),
  -- Verbatim copies of the optional fields the submit request carried.
  -- Null means that side effect was not requested.
  refresh_contract_id     TEXT,
  complete_proposal_id    TEXT,
  allocation_contract_id  TEXT,
  -- JSONB, not a child table: these rows are written exactly once, as a
  -- group, and only ever read back as a group by the same request that
  -- created them. A child table would add a join for no benefit.
  allocation_members      JSONB,
  side_effects_applied_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the only query shape: "is there a pending row I still need to
-- poll?" Not needed for hash lookups (the primary key covers those).
CREATE INDEX pending_submissions_pending_idx
  ON pending_submissions (created_at)
  WHERE status = 'pending';
