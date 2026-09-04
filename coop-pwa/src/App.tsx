import { useCallback, useEffect, useState } from "react";
import {
  getCommitment,
  listCommitments,
  buildTx,
  submitTx,
  type CommitmentDetail as CommitmentDetailType,
  type CommitmentSummary,
} from "./api";
import { connectWallet, signTransactionXdr } from "./wallet";
import { CommitmentDetail } from "./components/CommitmentDetail";
import { CommitmentList } from "./components/CommitmentList";
import { OfflineQueueBanner } from "./components/OfflineQueueBanner";
import { enqueueClaim, listQueuedClaims, removeQueuedClaim, isOfflineError, type QueuedClaim } from "./offlineQueue";

export default function App() {
  const [commitments, setCommitments] = useState<CommitmentSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const [lookupInput, setLookupInput] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitmentDetailType | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [claimingTranche, setClaimingTranche] = useState<1 | 2 | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const [queuedClaims, setQueuedClaims] = useState<QueuedClaim[]>([]);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  // Best-effort: IndexedDB can be unavailable (private-browsing mode in
  // some browsers) without that being this app's problem to surface as
  // a hard error -- the offline queue degrades to "just doesn't queue,"
  // not "crashes the dashboard."
  const refreshQueue = useCallback(() => {
    listQueuedClaims()
      .then(setQueuedClaims)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

  const refreshList = useCallback(() => {
    setListLoading(true);
    setListError(null);
    listCommitments()
      .then(setCommitments)
      .catch((err: unknown) => setListError(err instanceof Error ? err.message : String(err)))
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const loadDetail = useCallback((contractId: string) => {
    setSelectedId(contractId);
    setDetailLoading(true);
    setDetailError(null);
    setClaimError(null);
    getCommitment(contractId)
      .then(setDetail)
      .catch((err: unknown) => {
        setDetail(null);
        setDetailError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setDetailLoading(false));
  }, []);

  const handleConnectWallet = useCallback(() => {
    setWalletError(null);
    connectWallet()
      .then(setWalletAddress)
      .catch((err: unknown) => setWalletError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Build -> sign (Freighter) -> submit -> refresh, the same shape every
  // write in this project follows (api/README.md's architecture section).
  // This is the first place that shape actually runs client-side, not
  // just in a Node test script.
  //
  // isOfflineError specifically means "the request never reached the
  // network at all" (a fetch TypeError, not a rejection the server
  // actually returned) -- see offlineQueue.ts for why that's the one
  // case this queues the *intent* instead of just failing.
  const handleClaim = useCallback(
    (tranche: 1 | 2) => {
      if (!selectedId || !walletAddress) return;
      setClaimError(null);
      setClaimingTranche(tranche);
      const method = tranche === 1 ? "claim_advance_1" : "claim_advance_2";
      buildTx(selectedId, method, walletAddress)
        .then(({ xdr }) => signTransactionXdr(xdr, walletAddress))
        .then((signedXdr) => submitTx(signedXdr, selectedId))
        .then(() => getCommitment(selectedId))
        .then(setDetail)
        .catch((err: unknown) => {
          if (isOfflineError(err)) {
            return enqueueClaim(selectedId, tranche).then(refreshQueue);
          }
          setClaimError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setClaimingTranche(null));
    },
    [selectedId, walletAddress, refreshQueue],
  );

  // Same build -> sign -> submit shape as handleClaim, run against a
  // queued entry's own contractId/tranche rather than whatever's
  // currently selected -- a queued claim can belong to a different
  // commitment than the one open on screen. Always rebuilds fresh
  // (never reuses anything from the original failed attempt): the
  // original request never got far enough to produce a signature to
  // reuse, and even if it had, api/'s build sets a 60-second transaction
  // timeout, so anything old enough to have been sitting in the queue
  // needs a new one regardless.
  const retryQueuedClaim = useCallback(
    (claim: QueuedClaim) => {
      if (!walletAddress) return;
      setRetryingId(claim.id);
      const method = claim.tranche === 1 ? "claim_advance_1" : "claim_advance_2";
      buildTx(claim.contractId, method, walletAddress)
        .then(({ xdr }) => signTransactionXdr(xdr, walletAddress))
        .then((signedXdr) => submitTx(signedXdr, claim.contractId))
        .then(() => removeQueuedClaim(claim.id))
        .then(() => {
          refreshQueue();
          if (claim.contractId === selectedId) {
            getCommitment(claim.contractId).then(setDetail).catch(() => {});
          }
        })
        .catch((err: unknown) => {
          if (isOfflineError(err)) return; // still offline -- leave it queued, say nothing new
          // A real rejection, not just "still offline" -- don't retry
          // this forever, surface why and let the cooperative decide
          // what to do next.
          removeQueuedClaim(claim.id).then(refreshQueue);
          setClaimError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setRetryingId(null));
    },
    [walletAddress, selectedId, refreshQueue],
  );

  return (
    <>
      <header className="app-header">
        <h1>HarvestLock — Cooperative Dashboard</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span className="tag">read-only reads · testnet</span>
          {walletAddress ? (
            <span className="wallet-address">{walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}</span>
          ) : (
            <button className="wallet-button" onClick={handleConnectWallet}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      <main>
        {walletError && <div className="error-banner">{walletError}</div>}

        <OfflineQueueBanner queuedClaims={queuedClaims} retryingId={retryingId} onRetry={retryQueuedClaim} />

        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookupInput.trim()) loadDetail(lookupInput.trim());
          }}
        >
          <label htmlFor="contract-lookup" className="sr-only">
            Contract ID
          </label>
          <input
            id="contract-lookup"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder="Contract ID (C...)"
            spellCheck={false}
          />
          <button type="submit" disabled={!lookupInput.trim()}>
            Look up
          </button>
        </form>

        {selectedId && (
          <section>
            {detailLoading && <div className="loading-state">Reading {selectedId} from chain…</div>}
            {detailError && <div className="error-banner">{detailError}</div>}
            {detail && !detailLoading && (
              <CommitmentDetail
                commitment={detail}
                contractId={selectedId}
                walletAddress={walletAddress}
                onClaim={handleClaim}
                claimingTranche={claimingTranche}
                claimError={claimError}
                onCancelled={() => loadDetail(selectedId)}
                onReassigned={() => loadDetail(selectedId)}
              />
            )}
          </section>
        )}

        <section>
          <div className="detail-header">
            <h2 style={{ margin: 0, fontFamily: "var(--display)", fontWeight: 600, fontSize: "1.1rem" }}>
              Known commitments
            </h2>
            <button className="refresh-button" onClick={refreshList} disabled={listLoading}>
              {listLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {listError && <div className="error-banner">{listError}</div>}
          {!listError && !listLoading && <CommitmentList commitments={commitments} onSelect={loadDetail} />}
        </section>
      </main>
    </>
  );
}
