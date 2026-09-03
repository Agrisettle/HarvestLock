import { useCallback, useEffect, useState } from "react";
import type { MultisigProposal, CommitmentDetail as CommitmentDetailType } from "../api";
import { getReassignBuyerProposal, proposeReassignBuyer, signMultisigProposal, submitTx } from "../api";
import { signAuthEntry, signTransactionXdr } from "../wallet";

/** Mirrors lib.rs's reassign_buyer() reachable-state range — same as cancel()'s, Draft through ReadyForDelivery. */
const REASSIGNABLE_STATUSES = new Set([
  "Draft",
  "Locked",
  "Advance1Released",
  "CheckpointPassed",
  "Advance2Released",
  "ReadyForDelivery",
]);

/**
 * The staged multi-party `reassign_buyer` UX (api/HANDOFF.md) — same
 * propose/sign/finalize mechanism as `CancelSection.tsx`'s, generalized
 * to three parties instead of two. Two real differences from cancel:
 *
 * 1. Only the commitment's *current* buyer may propose (the API rejects
 *    anyone else with 403) — reassignment is the outgoing buyer's own
 *    decision to initiate (PRD §4.8), not something the cooperative or
 *    the incoming buyer can kick off. So the propose step here is a form
 *    (collect the new buyer's address), not a bare button.
 * 2. There are *two* pending signers, not one (cooperative and the
 *    incoming buyer), and the incoming buyer isn't yet a party to the
 *    commitment at all when they view it — they're identified purely by
 *    appearing in the fetched proposal's `pending_entries`, not by any
 *    field on `commitment` itself. Once they've signed, the API's
 *    proposal response no longer names them (`pending_entries` only
 *    lists still-unsigned entries) — `justApproved` is local, per-session
 *    state that keeps showing them the "waiting" state after they act,
 *    without needing the server to remember who they were. A page reload
 *    after that point genuinely can't recover "you were involved" from
 *    the API alone; this component doesn't try to.
 */
export function ReassignBuyerSection({
  commitment,
  contractId,
  walletAddress,
  onReassigned,
}: {
  commitment: CommitmentDetailType;
  contractId: string;
  walletAddress: string | null;
  onReassigned: () => void;
}) {
  const [proposal, setProposal] = useState<MultisigProposal | null>(null);
  const [newBuyerInput, setNewBuyerInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justApproved, setJustApproved] = useState(false);

  const reassignable = REASSIGNABLE_STATUSES.has(commitment.status);

  const refresh = useCallback(() => {
    if (!reassignable) {
      setProposal(null);
      return;
    }
    getReassignBuyerProposal(contractId)
      .then((res) => setProposal(res.proposal))
      .catch(() => {
        // Best-effort — a failed poll shouldn't break the rest of the page.
      });
  }, [contractId, reassignable]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (proposal?.status !== "pending") return;
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [proposal?.status, refresh]);

  if (!walletAddress || !reassignable) return null;

  const isCurrentBuyer = walletAddress === commitment.buyer;
  const isPendingSigner = proposal?.pending_entries.some((e) => e.address === walletAddress) ?? false;
  const isKnownParty = isCurrentBuyer || isPendingSigner || justApproved;
  if (!isKnownParty) return null;

  function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    if (!newBuyerInput.trim()) return;
    setBusy(true);
    setError(null);
    proposeReassignBuyer(contractId, walletAddress!, newBuyerInput.trim())
      .then(setProposal)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }

  function handleApprove() {
    const myEntry = proposal?.pending_entries.find((e) => e.address === walletAddress);
    if (!myEntry) return;
    setBusy(true);
    setError(null);
    signAuthEntry(myEntry.entry_xdr, walletAddress!)
      .then((signedEntryXdr) => signMultisigProposal(contractId, proposal!.id, walletAddress!, signedEntryXdr))
      .then((updated) => {
        setProposal(updated);
        setJustApproved(true);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }

  function handleFinalize() {
    if (!proposal?.ready_xdr) return;
    setBusy(true);
    setError(null);
    signTransactionXdr(proposal.ready_xdr, walletAddress!)
      .then((signedXdr) => submitTx(signedXdr, contractId, proposal.id))
      .then(() => {
        setProposal(null);
        onReassigned();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="reassign-section">
      {error && <div className="error-banner">{error}</div>}

      {!proposal && isCurrentBuyer && (
        <form className="reassign-form" onSubmit={handlePropose}>
          <label htmlFor="new-buyer-address">Reassign to a new buyer</label>
          <input
            id="new-buyer-address"
            value={newBuyerInput}
            onChange={(e) => setNewBuyerInput(e.target.value)}
            placeholder="G..."
            spellCheck={false}
          />
          <button className="action-button secondary" type="submit" disabled={busy || !newBuyerInput.trim()}>
            {busy ? "Proposing…" : "Propose reassignment"}
          </button>
        </form>
      )}

      {proposal?.status === "pending" && proposal.proposer_address === walletAddress && (
        <p className="cancel-status">
          Reassignment proposed — waiting for the cooperative and the new buyer to approve.
        </p>
      )}

      {proposal?.status === "pending" && isPendingSigner && (
        <>
          <p className="cancel-status">The current buyer wants to reassign this commitment to a new buyer.</p>
          <button className="action-button secondary" onClick={handleApprove} disabled={busy}>
            {busy ? "Approving…" : "Approve reassignment"}
          </button>
        </>
      )}

      {proposal?.status === "pending" && justApproved && !isPendingSigner && (
        <p className="cancel-status">Approved — waiting for the other party to approve too.</p>
      )}

      {proposal?.status === "ready" && proposal.proposer_address === walletAddress && (
        <button className="action-button secondary" onClick={handleFinalize} disabled={busy}>
          {busy ? "Finalizing…" : "Finalize reassignment"}
        </button>
      )}

      {proposal?.status === "ready" && proposal.proposer_address !== walletAddress && (
        <p className="cancel-status">Approved — waiting for the current buyer to finalize.</p>
      )}
    </div>
  );
}
