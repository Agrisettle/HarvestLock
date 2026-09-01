-- Cached, fast-read mirror of on-chain commitment state. The Soroban
-- contract is the source of truth (PRD §4.8 — one instance per
-- commitment); this table exists because the chain has no "list
-- commitments for buyer X" query, and re-simulating a contract call for
-- every list view would be slow and pointless when the API already has
-- to read the state to service writes anyway.
--
-- total_amount is NUMERIC(39,0), not BIGINT — i128 (the contract's amount
-- type) can exceed BIGINT's ~9.2e18 ceiling; 39 digits covers the full
-- i128 range with room to spare.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE commitments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         TEXT NOT NULL UNIQUE,
  buyer_address       TEXT NOT NULL,
  cooperative_address TEXT NOT NULL,
  warehouse_address   TEXT NOT NULL,
  token_address       TEXT NOT NULL,
  total_amount        NUMERIC(39, 0) NOT NULL CHECK (total_amount > 0),
  advance1_bps        INTEGER NOT NULL CHECK (advance1_bps BETWEEN 0 AND 10000),
  advance2_bps        INTEGER NOT NULL CHECK (advance2_bps BETWEEN 0 AND 10000),
  claim_window_secs   BIGINT NOT NULL CHECK (claim_window_secs > 0),
  status              TEXT NOT NULL DEFAULT 'Draft',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX commitments_buyer_idx ON commitments (buyer_address);
CREATE INDEX commitments_cooperative_idx ON commitments (cooperative_address);
CREATE INDEX commitments_status_idx ON commitments (status);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER commitments_updated_at
  BEFORE UPDATE ON commitments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
