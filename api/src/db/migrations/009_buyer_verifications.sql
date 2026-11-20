-- Buyer KYB via anchor verification (PRD §4.5/Users table: "full KYB ...
-- plus existing anchor SEP-12 verification"; issue #11). HarvestLock
-- does not run its own KYB. A row here records that a trusted, licensed
-- Stellar anchor reported this account's SEP-12 customer status at a
-- point in time, as read by this API itself with a SEP-10 token obtained
-- from a challenge the buyer signed. See src/kyb.ts.
--
-- Append-only history: every check is a new row, never an update, so a
-- buyer's verification trail (including rejections and lapses) stays
-- auditable. "Currently verified" = the latest ACCEPTED row whose
-- expires_at is still in the future. The expiry window implements the
-- PRD's "Buyers [re-verified] every six months".
--
-- Stores no documents, no personal data, and never the SEP-10 token.
-- The anchor remains the system of record for the KYB itself.

CREATE TABLE buyer_verifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account            TEXT NOT NULL,
  anchor_domain      TEXT NOT NULL,
  -- SEP-12's own status vocabulary, as the anchor reported it.
  sep12_status       TEXT NOT NULL CHECK (sep12_status IN ('ACCEPTED', 'PROCESSING', 'NEEDS_INFO', 'REJECTED')),
  -- The anchor's customer id, if it returned one. An opaque reference
  -- for reconciling with the anchor, not personal data.
  sep12_customer_id  TEXT,
  checked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set only for ACCEPTED: when this verification stops counting.
  expires_at         TIMESTAMPTZ,
  CHECK ((sep12_status = 'ACCEPTED') = (expires_at IS NOT NULL))
);

CREATE INDEX buyer_verifications_account_idx ON buyer_verifications (account, checked_at DESC);
