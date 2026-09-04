-- The off-chain half of the PRD §4.8/§16.1 allocation ledger. The
-- contract (HarvestLock-Contracts, set_allocation/get_allocation) only
-- ever sees member_hash + share_bps -- a per-member salted hash, never a
-- bare phone number. This table is the only place the salt and the real
-- phone number ever meet, which is what makes the on-chain entry
-- genuinely erasable per NDPA s.34: null out phone_number here (see
-- erased_at) and the on-chain hash becomes permanently unlinkable to a
-- real person, since the salt is gone and brute-forcing a random salt is
-- infeasible regardless of how small the phone-number keyspace is.
--
-- member_hash must match exactly what was (or will be) submitted
-- on-chain via set_allocation -- computed the same way API-side
-- (HMAC-SHA256(salt, phone_number), see src/db/allocationMembers.ts) so
-- a row here can always be matched back to its on-chain entry.

CREATE TABLE allocation_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   TEXT NOT NULL,
  -- Nullable, not required NOT NULL -- erasure sets this to NULL rather
  -- than deleting the row outright, so share_bps/member_hash (the
  -- anonymized economic record) stay intact after a phone number is
  -- erased.
  phone_number  TEXT,
  share_bps     INTEGER NOT NULL CHECK (share_bps BETWEEN 0 AND 10000),
  -- Hex-encoded random salt, generated fresh per member -- never reused
  -- across members or contracts. Only meaningful while phone_number is
  -- still present; kept (not nulled) after erasure purely as a record
  -- that a salt existed, not because it's still useful for anything.
  salt          TEXT NOT NULL,
  -- Hex-encoded HMAC-SHA256(salt, phone_number) -- must match the
  -- member_hash actually submitted on-chain.
  member_hash   TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  erased_at     TIMESTAMPTZ
);

CREATE INDEX allocation_members_contract_idx ON allocation_members (contract_id);
