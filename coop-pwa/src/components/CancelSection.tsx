import { useCallback, useEffect, useState } from "react";
import type { CancelProposal, CommitmentDetail as CommitmentDetailType } from "../api";
import { getCancelProposal, proposeCancel, signCancelProposal, submitTx } from "../api";
import { signAuthEntry, signTransactionXdr } from "../wallet";

/** Mirrors lib.rs's cancel() reachable-state range — Draft through ReadyForDelivery, never after Delivered. */
const CANCELLABLE_STATUSES = new Set([
  "Draft",
  "Locked",
  "Advance1Released",
  "CheckpointPassed",
  "Advance2Released",
  "ReadyForDelivery",
]);

/**
 * The staged multi-party `cancel` UX (api/HANDOFF.md): either party
 * proposes, the other approves by signing their own Soroban auth entry
 * (not a transaction — `signAuthEntry`, not `signTransactionXdr`), and
 * the proposer finalizes. Deliberately its own component, not folded into
 * `CommitmentDetail.tsx`'s claim flow — cancellation is available across
 * many states at once, not tied to a single next-required step the way
 * claiming an advance is, and it has its own multi-step state machine
 * (propose → approve → finalize) that doesn't fit that flow's shape.
 *
 * Identical to buyer-app's copy of this file — same small-duplication call
 * as `wallet.ts`/`api.ts` across the two apps, not a shared package.
 */
export function CancelSection({
  commitment,
  contractId,
  walletAddress,
  onCancelled,
}: {
  commitment: CommitmentDetailType;
  contractId: string;
  walletAddress: string | null;
  onCancelled: () => void;
}) {
  const [proposal, setProposal] = useState<CancelProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancellable = CANCELLABLE_STATUSES.has(commitment.status);

  const refresh = useCallback(() => {
    if (!cancellable) {
      setProposal(null);
      return;
    }
    getCancelProposal(contractId)
      .then((res) => setProposal(res.proposal))
      .catch(() => {
        // Best-effort — a failed poll shouldn't break the rest of the page.
      });
  }, [contractId, cancellable]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while waiting on the *other* party — not once it's "ready," since
  // at that point it's this viewer's own turn to act (finalize), not
  // something that changes on its own in the background.
  useEffect(() => {
    if (proposal?.status !== "pending") return;
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [proposal?.status, refresh]);

  if (!walletAddress || !cancellable) return null;
  if (walletAddress !== commitment.buyer && walletAddress !== commitment.cooperative) return null;

  function handlePropose() {
    setBusy(true);
    setError(null);
    proposeCancel(contractId, walletAddress!)
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
      .then((signedEntryXdr) => signCancelProposal(contractId, proposal!.id, walletAddress!, signedEntryXdr))
      .then(setProposal)
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
        onCancelled();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }

  const iAmProposer = proposal?.proposer_address === walletAddress;
  const iMustApprove = proposal?.pending_entries.some((e) => e.address === walletAddress) ?? false;

  return (
    <div className="cancel-section">
      {error && <div className="error-banner">{error}</div>}

      {!proposal && (
        <button className="action-button secondary" onClick={handlePropose} disabled={busy}>
          {busy ? "Proposing…" : "Cancel this commitment"}
        </button>
      )}

      {proposal?.status === "pending" && iAmProposer && (
        <p className="cancel-status">Cancellation proposed — waiting for the other party to approve.</p>
      )}

      {proposal?.status === "pending" && iMustApprove && (
        <>
          <p className="cancel-status">The other party wants to cancel this commitment.</p>
          <button className="action-button secondary" onClick={handleApprove} disabled={busy}>
            {busy ? "Approving…" : "Approve cancellation"}
          </button>
        </>
      )}

      {proposal?.status === "ready" && iAmProposer && (
        <button className="action-button secondary" onClick={handleFinalize} disabled={busy}>
          {busy ? "Finalizing…" : "Finalize cancellation"}
        </button>
      )}

      {proposal?.status === "ready" && !iAmProposer && (
        <p className="cancel-status">Approved — waiting for the proposer to finalize.</p>
      )}
    </div>
  );
}
