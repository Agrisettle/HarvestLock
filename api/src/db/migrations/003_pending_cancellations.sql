-- Staged multi-party signing for cancel() -- see api/HANDOFF.md's "A real
-- multi-party signing UX for cancel" (previously deliberately deferred:
-- the SDK-level mechanism was proven in test/helpers.ts's
-- submitMultiPartyCall, but nothing coordinated two SEPARATE wallets/
-- devices producing one signed envelope).
--
-- One row per proposed cancellation. auth_entries is the ordered array of
-- Soroban auth entries the simulated cancel() call required, exactly as
-- returned by simulation -- some already satisfied by the proposer's own
-- future classic signature (credential_type = 'source_account', address
-- null, needs no separate signing), others needing a specific other
-- party's explicit signature (credential_type = 'address'). Each element:
-- { "address": string | null, "entryXdr": string, "signedEntryXdr": string | null }.
--
-- func_xdr and soroban_data_xdr are the pieces needed to rebuild the final
-- transaction once every pending entry is signed, without re-simulating
-- (re-simulating would mint fresh, unsigned nonces and undo any signing
-- already done -- same reasoning test/helpers.ts's submitMultiPartyCall
-- documents for why it reuses the original simulation's footprint).

CREATE TABLE pending_cancellations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      TEXT NOT NULL,
  proposer_address TEXT NOT NULL,
  func_xdr         TEXT NOT NULL,
  soroban_data_xdr TEXT NOT NULL,
  auth_entries     JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'completed')),
  final_xdr        TEXT,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Not a uniqueness constraint -- an expired or completed proposal
-- shouldn't block a fresh one for the same contract, and "currently
-- active" depends on expires_at, not just status. Application code
-- enforces "at most one active proposal per contract" by checking before
-- inserting; indexed for that lookup.
CREATE INDEX pending_cancellations_contract_idx ON pending_cancellations (contract_id);

CREATE TRIGGER pending_cancellations_updated_at
  BEFORE UPDATE ON pending_cancellations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
