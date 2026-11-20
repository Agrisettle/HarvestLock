-- SMS notifications for allocated member farmers (PRD §6/§13 "SMS-only,
-- no app"; issue #7). Two tables, mirroring the reputation design's
-- "UNIQUE constraint is the idempotency guard" rule (see
-- src/reputation.ts for why a previous-status comparison is not):
--
--   sms_events   -- one row per farmer-relevant commitment event, ever.
--                   UNIQUE (contract_id, event_key, occurrence) is what
--                   makes "send one message per transition" hold even
--                   when the same status is observed many times.
--   sms_messages -- one row per (event, recipient): the delivery outbox.
--
-- Deliberately NO phone number column anywhere here. A message points at
-- its recipient's allocation_members row and the number is read from
-- there only at send time, so NDPA s.34 erasure (DELETE
-- /allocation-members/:memberHash, which nulls phone_number) also stops
-- any not-yet-sent message to that person -- this table can never become
-- a second copy of the identity map.

CREATE TABLE sms_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   TEXT NOT NULL,
  -- One of the event keys in docs/sms-templates.md.
  event_key     TEXT NOT NULL CHECK (event_key IN (
                  'advance_released', 'checkpoint_marked', 'delivery_confirmed',
                  'dispute_flagged', 'dispute_resolved', 'settlement_complete')),
  -- Distinguishes repeatable events: '1'/'2' for advance_released's two
  -- tranches, a running dispute number for dispute_flagged/_resolved,
  -- '1' for everything that can only happen once.
  occurrence    INTEGER NOT NULL CHECK (occurrence >= 1),
  -- True when the event was recorded but intentionally not sent: the
  -- first time this API ever saw the contract, it was already past this
  -- point (a backfill, not a fresh transition). See src/notifications.ts.
  suppressed    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, event_key, occurrence)
);

CREATE INDEX sms_events_contract_idx ON sms_events (contract_id);

CREATE TABLE sms_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES sms_events(id),
  allocation_member_id UUID NOT NULL REFERENCES allocation_members(id),
  locale              TEXT NOT NULL,
  -- The exact text queued for this message, rendered once at enqueue
  -- time. Contains no personal data (the reviewed copy plus at most a
  -- delivered quantity) and doubles as the audit record of what was sent.
  body                TEXT NOT NULL,
  -- pending  -> not yet attempted (or released for retry)
  -- sending  -> claimed by a delivery run; reclaimable if stale
  -- sent     -> the gateway accepted it; terminal, never re-sent
  -- failed   -> gave up after the maximum number of attempts
  -- skipped  -> deliberately not sent (erased member, unusable number)
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  provider            TEXT,
  provider_message_id TEXT,
  last_error          TEXT,
  claimed_at          TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, allocation_member_id)
);

CREATE INDEX sms_messages_deliverable_idx ON sms_messages (status) WHERE status IN ('pending', 'sending');
