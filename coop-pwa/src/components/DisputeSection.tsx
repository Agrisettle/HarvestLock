import { useCallback, useEffect, useState } from "react";
import type { MultisigProposal, CommitmentDetail as CommitmentDetailType } from "../api";
import {
  buildFlagDisputeTx,
  getResolveDisputeProposal,
  proposeResolveDispute,
  signMultisigProposal,
  submitTx,
} from "../api";
import { useI18n } from "../i18n";
import { signAuthEntry, signTransactionXdr } from "../wallet";

/** Mirrors lib.rs's flag_dispute() reachable-state range — Locked through Delivered, never Draft (nothing escrowed yet to freeze) and never a terminal status. */
const DISPUTABLE_STATUSES = new Set([
  "Locked",
  "Advance1Released",
  "CheckpointPassed",
  "Advance2Released",
  "ReadyForDelivery",
  "Delivered",
]);

function isParty(commitment: CommitmentDetailType, address: string): boolean {
  return address === commitment.buyer || address === commitment.cooperative || address === commitment.warehouse_operator;
}

/**
 * PRD's must-have "dispute flagging with defined escalation"
 * (api/HANDOFF.md, HarvestLock-Contracts' Deployment 10). Two distinct
 * shapes, not one, since flagging and resolving are genuinely different
 * mechanisms:
 *
 * - **Flagging** (`Status` not yet `Disputed`) is single-signer — any one
 *   of buyer/cooperative/warehouse operator, own build → sign → submit,
 *   same shape as the claim-advance action in `CommitmentDetail.tsx`
 *   rather than `CancelSection`'s propose/approve/finalize (there's
 *   nothing to stage — one signature is the whole transaction).
 * - **Resolving** (`Status === "Disputed"`) needs all *three* parties'
 *   auth, so it reuses the exact staged propose/sign/finalize mechanism
 *   `ReassignBuyerSection` already proved for two pending signers,
 *   generalized to two pending signers here too (whichever two of the
 *   three didn't propose) — including its `justApproved` local-state
 *   gap: once a signer's entry is recorded, the API's `pending_entries`
 *   stops naming them, so this component can't tell purely from a page
 *   reload that "you already signed" — same documented, deliberate
 *   limitation as `ReassignBuyerSection`'s.
 *
 * Unlike `CancelSection` (buyer/cooperative only) this checks all
 * *three* named parties, since flag_dispute/resolve_dispute genuinely
 * involve the warehouse operator too — nothing stops that party's
 * wallet from connecting to this app if they have the link, and they
 * should be able to act here exactly as the contract's own auth model
 * allows, not a subset of it.
 *
 * Identical to buyer-app's copy of this file — same small-duplication
 * call as `wallet.ts`/`api.ts` across the two apps, not a shared package.
 */
export function DisputeSection({
  commitment,
  contractId,
  walletAddress,
  onDisputeChanged,
}: {
  commitment: CommitmentDetailType;
  contractId: string;
  walletAddress: string | null;
  onDisputeChanged: () => void;
}) {
  const { t } = useI18n();
  const [proposal, setProposal] = useState<MultisigProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justApproved, setJustApproved] = useState(false);

  const disputed = commitment.status === "Disputed";
  const disputable = DISPUTABLE_STATUSES.has(commitment.status);

  const refresh = useCallback(() => {
    if (!disputed) {
      setProposal(null);
      return;
    }
    getResolveDisputeProposal(contractId)
      .then((res) => setProposal(res.proposal))
      .catch(() => {
        // Best-effort — a failed poll shouldn't break the rest of the page.
      });
  }, [contractId, disputed]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (proposal?.status !== "pending") return;
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [proposal?.status, refresh]);

  if (!walletAddress || !isParty(commitment, walletAddress)) return null;
  if (!disputed && !disputable) return null;

  function handleFlag() {
    setBusy(true);
    setError(null);
    buildFlagDisputeTx(contractId, walletAddress!, walletAddress!)
      .then(({ xdr }) => signTransactionXdr(xdr, walletAddress!))
      .then((signedXdr) => submitTx(signedXdr, contractId))
      .then(() => onDisputeChanged())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }

  function handlePropose() {
    setBusy(true);
    setError(null);
    proposeResolveDispute(contractId, walletAddress!)
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
        onDisputeChanged();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }

  const isPendingSigner = proposal?.pending_entries.some((e) => e.address === walletAddress) ?? false;
  const iAmProposer = proposal?.proposer_address === walletAddress;

  return (
    <div className="dispute-section">
      {/* `role="alert"` so the rejection message is announced rather than
          silently painted above the button the user just activated. */}
      {error && <div className="error-banner" role="alert">{error}</div>}

      {!disputed && (
        <button className="action-button secondary" onClick={handleFlag} disabled={busy}>
          {busy ? t("dispute.flagging") : t("dispute.flag")}
        </button>
      )}

      {disputed && !proposal && (
        <>
          <p className="cancel-status">
            {t("dispute.frozen")}
          </p>
          <button className="action-button secondary" onClick={handlePropose} disabled={busy}>
            {busy ? t("dispute.proposing") : t("dispute.propose")}
          </button>
        </>
      )}

      {proposal?.status === "pending" && iAmProposer && (
        <p className="cancel-status" role="status">{t("dispute.proposed")}</p>
      )}

      {proposal?.status === "pending" && isPendingSigner && (
        <>
          <p className="cancel-status" role="status">{t("dispute.otherWants")}</p>
          <button className="action-button secondary" onClick={handleApprove} disabled={busy}>
            {busy ? t("dispute.approving") : t("dispute.approve")}
          </button>
        </>
      )}

      {proposal?.status === "pending" && justApproved && !isPendingSigner && !iAmProposer && (
        <p className="cancel-status" role="status">{t("dispute.approvedWaiting")}</p>
      )}

      {proposal?.status === "ready" && iAmProposer && (
        <button className="action-button secondary" onClick={handleFinalize} disabled={busy}>
          {busy ? t("dispute.finalizing") : t("dispute.finalize")}
        </button>
      )}

      {proposal?.status === "ready" && !iAmProposer && (
        <p className="cancel-status" role="status">{t("dispute.approvedWaitingProposer")}</p>
      )}
    </div>
  );
}
