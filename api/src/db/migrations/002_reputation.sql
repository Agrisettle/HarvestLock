-- Off-chain reputation/strikes tracking, per this session's default/
-- forfeiture product decisions (see TASKS.md, HarvestLock-Contracts'
-- HANDOFF.md, and site/roles.html): a buyer default is an immediate,
-- permanent bar on first occurrence; a cooperative forfeiture is a
-- graduated bar after three. The contract only ever emits a clean
-- terminal status (Status::Defaulted / Status::Forfeited) -- it has no
-- visibility into a party's history across other commitments, so this
-- has to live here, not on-chain (same reasoning as the allocation
-- ledger's off-chain identity map, PRD §16.1).
--
-- party_standing is small and denormalized on purpose: one row per
-- address, updated in place, not derived by replaying standing_events on
-- every read. standing_events exists purely as the audit trail a human
-- reviewing an appeal needs -- which commitment, which kind of event,
-- when -- not as the source of truth for the current state.

CREATE TABLE party_standing (
  address       TEXT PRIMARY KEY,
  strike_count  INTEGER NOT NULL DEFAULT 0,
  barred        BOOLEAN NOT NULL DEFAULT FALSE,
  barred_reason TEXT,
  barred_at     TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE standing_events (
  id          BIGSERIAL PRIMARY KEY,
  address     TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN ('buyer_default', 'cooperative_forfeiture')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX standing_events_address_idx ON standing_events (address);

CREATE TRIGGER party_standing_updated_at
  BEFORE UPDATE ON party_standing
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
