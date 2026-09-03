-- Generalizes pending_cancellations into pending_multisig_proposals, so
-- the same staged propose/sign/finalize mechanism (api/HANDOFF.md) can
-- back reassign_buyer's three-party case too, not just cancel's two.
-- Nothing else about the schema changes: func_xdr already fully encodes
-- the method name AND its arguments (Contract.call(method, ...args)
-- bakes both into the HostFunction XDR), so no separate args column is
-- needed -- method is added purely for cheap filtering/display, so a
-- caller doesn't have to decode func_xdr just to know which kind of
-- proposal a row is.
--
-- Clean rename+alter, not a data-preserving migration: this is a
-- testnet-only table with no real production rows to protect (every row
-- in it so far is test/demo data from this session's own live-testnet
-- verification runs).

ALTER TABLE pending_cancellations RENAME TO pending_multisig_proposals;

ALTER TABLE pending_multisig_proposals ADD COLUMN method TEXT NOT NULL DEFAULT 'cancel';
ALTER TABLE pending_multisig_proposals ALTER COLUMN method DROP DEFAULT;

ALTER INDEX pending_cancellations_contract_idx RENAME TO pending_multisig_proposals_contract_idx;
CREATE INDEX pending_multisig_proposals_method_idx ON pending_multisig_proposals (contract_id, method);

ALTER TRIGGER pending_cancellations_updated_at ON pending_multisig_proposals RENAME TO pending_multisig_proposals_updated_at;
