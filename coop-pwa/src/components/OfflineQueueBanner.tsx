import type { QueuedClaim } from "../offlineQueue";

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
  onRetry,
}: {
  queuedClaims: QueuedClaim[];
  retryingId: number | null;
  onRetry: (claim: QueuedClaim) => void;
}) {
  if (queuedClaims.length === 0) return null;

  return (
    <div className="offline-queue-banner">
      <p className="offline-queue-summary">
        {queuedClaims.length} claim{queuedClaims.length === 1 ? "" : "s"} couldn't reach the network and{" "}
        {queuedClaims.length === 1 ? "is" : "are"} waiting to retry.
      </p>
      <ul className="offline-queue-list">
        {queuedClaims.map((claim) => (
          <li key={claim.id}>
            <span className="offline-queue-item-label">
              Advance {claim.tranche} — <span className="contract-id">{claim.contractId}</span>
            </span>
            <button
              className="action-button secondary"
              onClick={() => onRetry(claim)}
              disabled={retryingId !== null}
            >
              {retryingId === claim.id ? "Retrying…" : "Retry"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
