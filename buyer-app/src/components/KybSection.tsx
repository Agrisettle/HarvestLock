import { useCallback, useEffect, useState } from "react";
import type { BuyerVerificationStatus, KybConfig } from "../api";
import { createKybChallenge, getBuyerVerification, getKybConfig, verifyKyb } from "../api";
import { signTransactionXdr } from "../wallet";

const STATUS_HELP: Record<string, string> = {
  NEEDS_INFO: "has no completed KYB on file for this account yet. Complete it with the anchor, then check again.",
  PROCESSING: "is still reviewing this account's KYB. Check again once they've finished.",
  REJECTED: "rejected this account's KYB. Resolve it with the anchor directly.",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Buyer onboarding step (issue #11, PRD §4.5): prove that a trusted,
 * licensed Stellar anchor has already KYB'd this wallet's account.
 * HarvestLock runs no KYB of its own. The buyer completes KYB with the
 * anchor as usual, and this step only links that result to their
 * address:
 *
 *   API fetches + validates the anchor's SEP-10 challenge → the buyer
 *   signs it in Freighter (it is an auth challenge with sequence 0, which
 *   the network can never execute) → the API exchanges it with the anchor
 *   and reads the anchor's own SEP-12 status.
 *
 * `onStatusChange` lets the page gate "Create commitment" when the API
 * enforces verification. The API enforces it either way; the gate just
 * stops a buyer from filling in a form that would be refused.
 */
export function KybSection({
  walletAddress,
  onStatusChange,
}: {
  walletAddress: string;
  onStatusChange: (state: { required: boolean; verified: boolean }) => void;
}) {
  const [config, setConfig] = useState<KybConfig | null>(null);
  const [status, setStatus] = useState<BuyerVerificationStatus | null>(null);
  const [anchor, setAnchor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([getKybConfig(), getBuyerVerification(walletAddress)])
      .then(([cfg, st]) => {
        if (cancelled) return;
        setConfig(cfg);
        setStatus(st);
        setAnchor((prev) => prev || st.latest?.anchor_domain || cfg.trustedAnchors[0] || "");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    if (config && status) onStatusChange({ required: config.enforcement === "enforce", verified: status.verified });
  }, [config, status, onStatusChange]);

  const handleVerify = useCallback(() => {
    if (!anchor) return;
    setBusy(true);
    setError(null);
    createKybChallenge(walletAddress, anchor)
      .then(({ transaction }) => signTransactionXdr(transaction, walletAddress))
      .then((signed) => verifyKyb(walletAddress, anchor, signed))
      .then(() => getBuyerVerification(walletAddress))
      .then(setStatus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [anchor, walletAddress]);

  if (!config || !status) {
    return error ? <div className="error-banner">{error}</div> : null;
  }
  // No anchor configured: there's nothing a buyer can do here yet, and
  // the API can't be enforcing (it refuses to boot that way).
  if (config.trustedAnchors.length === 0) return null;

  const latestUnverified = !status.verified && status.latest && status.latest.sep12_status !== "ACCEPTED" ? status.latest : null;

  return (
    <section className="kyb-section card" aria-labelledby="kyb-title">
      <h2 id="kyb-title" className="section-title">
        Business verification
      </h2>
      {status.verified && status.current ? (
        <p className="kyb-status" role="status" aria-live="polite">
          ✓ Verified by <strong>{status.current.anchor_domain}</strong> until {formatDate(status.current.expires_at!)}.
        </p>
      ) : (
        <>
          <p className="kyb-status" role="status" aria-live="polite">
            {config.enforcement === "enforce"
              ? "Required before you can create a commitment. "
              : "Optional on this deployment. "}
            HarvestLock doesn't collect your business documents. A licensed Stellar anchor that has already verified
            your business confirms it, after you sign a one-time login challenge with your wallet.
          </p>
          {latestUnverified && (
            <p className="kyb-status">
              {latestUnverified.anchor_domain} {STATUS_HELP[latestUnverified.sep12_status]}
            </p>
          )}
          <div className="kyb-form">
            <label htmlFor="kyb-anchor">Anchor</label>
            <select id="kyb-anchor" value={anchor} onChange={(e) => setAnchor(e.target.value)} disabled={busy}>
              {config.trustedAnchors.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <button className="action-button" onClick={handleVerify} disabled={busy || !anchor}>
              {busy ? "Verifying…" : latestUnverified ? "Check again" : "Verify with anchor"}
            </button>
          </div>
        </>
      )}
      {error && <div className="error-banner">{error}</div>}
    </section>
  );
}
