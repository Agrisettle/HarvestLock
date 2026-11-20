import { useMemo } from "react";
import type { CommitmentDetail as CommitmentDetailType } from "../api";
import { StatusBadge } from "./StatusBadge";
import { CancelSection } from "./CancelSection";
import { ReassignBuyerSection } from "./ReassignBuyerSection";
import { DisputeSection } from "./DisputeSection";
import { AllocationLedgerSection } from "./AllocationLedgerSection";
import { AddressChip } from "./AddressChip";
import { formatTokenAmount } from "../amount";
import { useI18n, type Translate, type TranslatePlural } from "../i18n";

function formatDeadline(unixSecs: string, formatter: Intl.DateTimeFormat, t: Translate): string {
  const n = Number(unixSecs);
  // The contract stores 0 as "unset" — release_advance_N hasn't run yet,
  // so no claim window exists to show. Not an error, not epoch-1970.
  if (n === 0) return t("detail.notYetOpened");
  return t("detail.deadlineUtc", { date: formatter.format(new Date(n * 1000)) });
}

function formatBps(bps: number, formatter: Intl.NumberFormat, t: Translate): string {
  return t("common.percent", { value: formatter.format(bps / 100) });
}

function claimState(claimed: boolean, expired: boolean, t: Translate): string {
  if (claimed) return t("detail.claimed");
  if (expired) return t("detail.expired");
  return t("detail.pending");
}

/** Seconds → localized "7 days" / "36 hours" / raw seconds when not a whole unit. */
function formatDuration(secs: string, t: Translate, tPlural: TranslatePlural): string {
  let n: bigint;
  try {
    n = BigInt(secs);
  } catch {
    return t("duration.raw", { seconds: secs });
  }
  if (n > 0n && n % 86_400n === 0n) return tPlural("duration.days", Number(n / 86_400n));
  if (n > 0n && n % 3_600n === 0n) return tPlural("duration.hours", Number(n / 3_600n));
  return t("duration.raw", { seconds: secs });
}

/**
 * Whether `claim_advance_N` is actually worth offering right now — checked
 * client-side so the UI doesn't invite a transaction the contract will
 * just reject. Mirrors lib.rs's claim_tranche guards: window opened
 * (deadline != 0), not already claimed or expired, and not past the
 * deadline (the contract's real clock is on-chain at submit time, so this
 * is a UX nicety, not the actual enforcement — a claim submitted right at
 * the boundary can still legitimately fail server-side; that's fine, the
 * contract is the source of truth, this just avoids the *obviously*
 * doomed case).
 */
function canClaim(deadline: string, claimed: boolean, expired: boolean): boolean {
  if (claimed || expired) return false;
  const deadlineMs = Number(deadline) * 1000;
  if (deadline === "0" || Number.isNaN(deadlineMs)) return false;
  return deadlineMs > Date.now();
}

export function CommitmentDetail({
  commitment,
  contractId,
  walletAddress,
  onClaim,
  claimingTranche,
  claimError,
  onCancelled,
  onReassigned,
  onDisputeChanged,
}: {
  commitment: CommitmentDetailType;
  contractId: string;
  walletAddress: string | null;
  onClaim: (tranche: 1 | 2) => void;
  claimingTranche: 1 | 2 | null;
  claimError: string | null;
  onCancelled: () => void;
  onReassigned: () => void;
  onDisputeChanged: () => void;
}) {
  const { t, tPlural, intlLocale } = useI18n();
  const deadlineFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }),
    [intlLocale],
  );
  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [intlLocale],
  );

  // claim_advance_* is cooperative-auth-gated (lib.rs) — offering the
  // button to a connected wallet that isn't the cooperative would just
  // produce an on-chain auth rejection, so it's hidden instead.
  const isCooperative = walletAddress !== null && walletAddress === commitment.cooperative;

  return (
    <div className="card">
      <div className="detail-header">
        <StatusBadge status={commitment.status} />
        <AddressChip address={contractId} className="contract-id" />
      </div>

      <CancelSection commitment={commitment} contractId={contractId} walletAddress={walletAddress} onCancelled={onCancelled} />
      <ReassignBuyerSection
        commitment={commitment}
        contractId={contractId}
        walletAddress={walletAddress}
        onReassigned={onReassigned}
      />
      <DisputeSection
        commitment={commitment}
        contractId={contractId}
        walletAddress={walletAddress}
        onDisputeChanged={onDisputeChanged}
      />
      <AllocationLedgerSection commitment={commitment} contractId={contractId} walletAddress={walletAddress} />

      <dl className="party-grid">
        <div>
          <dt>{t("detail.buyer")}</dt>
          <dd>
            <AddressChip address={commitment.buyer} />
          </dd>
        </div>
        <div>
          <dt>{t("detail.cooperative")}</dt>
          <dd>
            <AddressChip address={commitment.cooperative} />
          </dd>
        </div>
        <div>
          <dt>{t("detail.warehouseOperator")}</dt>
          <dd>
            <AddressChip address={commitment.warehouse_operator} />
          </dd>
        </div>
        <div>
          <dt>{t("detail.token")}</dt>
          <dd>
            <AddressChip address={commitment.token} />
          </dd>
        </div>
        <div>
          <dt>{t("detail.totalAmount")}</dt>
          <dd>{formatTokenAmount(commitment.total_amount, undefined, intlLocale)}</dd>
        </div>
        <div>
          <dt>{t("detail.claimWindow")}</dt>
          <dd>{formatDuration(commitment.claim_window_secs, t, tPlural)}</dd>
        </div>
      </dl>

      {claimError && <div className="error-banner">{claimError}</div>}

      <div className="tranches-scroll" role="region" aria-label={t("detail.trancheSchedule")} tabIndex={0}>
        <table className="tranches">
          <thead>
            <tr>
              <th>{t("detail.tranche")}</th>
              <th>{t("detail.share")}</th>
              <th>{t("detail.claimDeadline")}</th>
              <th>{t("detail.state")}</th>
              {isCooperative && <th>{t("detail.action")}</th>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t("detail.advance1")}</td>
              <td>{formatBps(commitment.advance1_bps, percentFormatter, t)}</td>
              <td>{formatDeadline(commitment.advance1_deadline, deadlineFormatter, t)}</td>
              <td>{claimState(commitment.advance1_claimed, commitment.advance1_expired, t)}</td>
              {isCooperative && (
                <td>
                  {canClaim(commitment.advance1_deadline, commitment.advance1_claimed, commitment.advance1_expired) && (
                    <button
                      className="claim-button"
                      onClick={() => onClaim(1)}
                      disabled={claimingTranche !== null}
                    >
                      {claimingTranche === 1 ? t("detail.claiming") : t("detail.claim")}
                    </button>
                  )}
                </td>
              )}
            </tr>
            <tr>
              <td>{t("detail.advance2")}</td>
              <td>{formatBps(commitment.advance2_bps, percentFormatter, t)}</td>
              <td>{formatDeadline(commitment.advance2_deadline, deadlineFormatter, t)}</td>
              <td>{claimState(commitment.advance2_claimed, commitment.advance2_expired, t)}</td>
              {isCooperative && (
                <td>
                  {canClaim(commitment.advance2_deadline, commitment.advance2_claimed, commitment.advance2_expired) && (
                    <button
                      className="claim-button"
                      onClick={() => onClaim(2)}
                      disabled={claimingTranche !== null}
                    >
                      {claimingTranche === 2 ? t("detail.claiming") : t("detail.claim")}
                    </button>
                  )}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
