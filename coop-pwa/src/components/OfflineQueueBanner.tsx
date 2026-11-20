import type { QueuedClaim } from "../offlineQueue";
import { useI18n } from "../i18n";
import { AddressChip } from "./AddressChip";

/**
 * Surfaces claims that got queued because the device had no network at
 * all when "Claim" was tapped — see offlineQueue.ts for why this stores
 * intent (contract + tranche), not a pre-signed transaction. Deliberately
 * no automatic retry on a `window.addEventListener("online", ...)`
 * listener: `navigator.onLine`/the `online` event are both known-
 * unreliable signals (a device can report "online" while still unable to
 * reach this specific API), and retrying still needs the cooperative's
 * own wallet to sign via Freighter, which needs the user present anyway
 * — a visible "Retry" button they tap when they believe they're back is
 * simpler and just as correct as trying to auto-detect reconnection.
 */
export function OfflineQueueBanner({
  queuedClaims,
  retryingId,
  retryErrors = {},
  onRetry,
  onDismiss,
}: {
  queuedClaims: QueuedClaim[];
  retryingId: number | null;
  /** Why a claim's last retry failed, keyed by queue id. */
  retryErrors?: Record<number, string>;
  onRetry: (claim: QueuedClaim) => void;
  onDismiss?: (claim: QueuedClaim) => void;
}) {
  const { t, tPlural } = useI18n();

  if (queuedClaims.length === 0) return null;

  return (
    <div className="offline-queue-banner" role="status">
      <p className="offline-queue-summary">
        {tPlural("offline.claimsSummary", queuedClaims.length)}
      </p>
      <ul className="offline-queue-list">
        {queuedClaims.map((claim) => (
          <li key={claim.id}>
            {/* AddressChip, not the raw ID: a contract ID is 56
                characters with no break opportunity in it, and
                `.contract-id` only has a rule under `.commitment-row`
                and `.detail-header`, so here it was simply full-width
                text. On a 360px screen that pushed Retry 264px off the
                right edge -- the control was unreachable, not just
                ugly. The chip truncates and keeps the full value in a
                title tooltip. */}
            <span className="offline-queue-item-label">
              {t("offline.advanceLabel", { tranche: claim.tranche })}<AddressChip address={claim.contractId} />
            </span>
            <button
              type="button"
              className="action-button secondary"
              onClick={() => onRetry(claim)}
              disabled={retryingId !== null}
              aria-busy={retryingId === claim.id}
            >
              {retryingId === claim.id ? t("offline.retrying") : t("offline.retry")}
            </button>
            {retryErrors[claim.id] && onDismiss && (
              <button
                type="button"
                className="action-button secondary"
                onClick={() => onDismiss(claim)}
                disabled={retryingId !== null}
              >
                {t("offline.dismiss")}
              </button>
            )}
            {retryErrors[claim.id] && (
              <div className="error-banner" role="alert">
                {retryErrors[claim.id]}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
