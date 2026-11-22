import { useCallback, useEffect, useRef, useState } from "react";
import {
  assertSubmitted,
  getCommitment,
  listCommitments,
  buildTx,
  submitTx,
  waitForTransaction,
  type CommitmentDetail as CommitmentDetailType,
  type CommitmentSummary,
} from "./api";
import { connectWallet, signTransactionXdr } from "./wallet";
import { CommitmentDetail } from "./components/CommitmentDetail";
import { CommitmentList } from "./components/CommitmentList";
import { OfflineQueueBanner } from "./components/OfflineQueueBanner";
import { LanguagePicker } from "./components/LanguagePicker";
import { I18nProvider, useI18n } from "./i18n";
import { enqueueClaim, listQueuedClaims, removeQueuedClaim, isOfflineError, type QueuedClaim } from "./offlineQueue";

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

function AppContent() {
  const { t } = useI18n();
  const [commitments, setCommitments] = useState<CommitmentSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listMoreLoading, setListMoreLoading] = useState(false);
  const [listMoreError, setListMoreError] = useState<string | null>(null);
  const [hasMoreCommitments, setHasMoreCommitments] = useState(false);

  const [lookupInput, setLookupInput] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A Freighter popup can be open for a minute. Keep the contract the claim
  // started against so its late refresh can't overwrite another commitment's
  // detail just because the user selected a different row in the meantime.
  const selectedIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<CommitmentDetailType | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [claimingTranche, setClaimingTranche] = useState<1 | 2 | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const [queuedClaims, setQueuedClaims] = useState<QueuedClaim[]>([]);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  // Per-item retry failures, shown in the banner itself so they stay visible
  // whatever commitment (or none) is selected.
  const [retryErrors, setRetryErrors] = useState<Record<number, string>>({});

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
    setListMoreError(null);
    listCommitments()
      .then((page) => {
        setCommitments(page);
        setHasMoreCommitments(page.length === 20);
      })
      .catch((err: unknown) =>
        setListError(
          t("app.listError", { message: err instanceof Error ? err.message : String(err) }),
        ),
      )
      .finally(() => setListLoading(false));
  }, [t]);

  const loadMoreCommitments = useCallback(() => {
    if (listMoreLoading || !hasMoreCommitments) return;
    setListMoreLoading(true);
    setListMoreError(null);
    listCommitments({ offset: commitments.length })
      .then((page) => {
        setCommitments((current) => [...current, ...page]);
        setHasMoreCommitments(page.length === 20);
      })
      .catch((err: unknown) =>
        setListMoreError(
          t("app.listMoreError", { message: err instanceof Error ? err.message : String(err) }),
        ),
      )
      .finally(() => setListMoreLoading(false));
  }, [commitments.length, hasMoreCommitments, listMoreLoading, t]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const loadDetail = useCallback(
    (contractId: string) => {
      selectedIdRef.current = contractId;
      setSelectedId(contractId);
      setDetailLoading(true);
      setDetailError(null);
      setClaimError(null);
      getCommitment(contractId)
        .then(setDetail)
        .catch((err: unknown) => {
          setDetail(null);
          setDetailError(
            t("app.detailError", {
              contractId,
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        })
        .finally(() => setDetailLoading(false));
    },
    [t],
  );

  const handleConnectWallet = useCallback(() => {
    setWalletError(null);
    setClaimError(null);
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
  // case this queues the *intent* instead of just failing. The queue is
  // only valid before submit succeeds: after that the claim may already
  // be on-chain, and retrying it would just hit AlreadyClaimed.
  const handleClaim = useCallback(
    async (tranche: 1 | 2) => {
      if (!selectedId || !walletAddress) return;
      const contractId = selectedId;
      setClaimError(null);
      setClaimingTranche(tranche);
      const method = tranche === 1 ? "claim_advance_1" : "claim_advance_2";
      let submitted = false;
      try {
        const { xdr } = await buildTx(contractId, method, walletAddress);
        const signedXdr = await signTransactionXdr(xdr, walletAddress);
        const answer = await submitTx(signedXdr, contractId);
        submitted = true;
        // The API answers 202 while the Soroban RPC confirmation is still
        // outrunning its poll window. Refreshing on that answer would show
        // pre-claim state and skip the cache/proposal side effects the API
        // applies when GET /transactions/:hash first sees SUCCESS.
        const result = answer.status === "PENDING" ? await waitForTransaction(answer.hash) : answer;
        assertSubmitted(result);
      } catch (err) {
        if (!submitted && isOfflineError(err)) {
          await enqueueClaim(contractId, tranche);
          refreshQueue();
        } else {
          setClaimError(err instanceof Error ? err.message : String(err));
        }
        setClaimingTranche(null);
        return;
      }

      // A failed read after a confirmed write is a different problem, not
      // an offline claim to retry. Keep the success separate so the queue
      // never claims a transaction that already landed.
      try {
        const refreshed = await getCommitment(contractId);
        if (selectedIdRef.current === contractId) setDetail(refreshed);
        else refreshList();
      } catch (err) {
        setClaimError(
          t("app.detailError", {
            contractId,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        setClaimingTranche(null);
      }
    },
    [selectedId, walletAddress, refreshQueue, refreshList, t],
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
      setRetryErrors(({ [claim.id]: _cleared, ...rest }) => rest);
      const method = claim.tranche === 1 ? "claim_advance_1" : "claim_advance_2";
      buildTx(claim.contractId, method, walletAddress)
        .then(({ xdr }) => signTransactionXdr(xdr, walletAddress))
        .then((signedXdr) => submitTx(signedXdr, claim.contractId))
        .then((answer) => (answer.status === "PENDING" ? waitForTransaction(answer.hash) : answer))
        .then((result) => {
          assertSubmitted(result);
          return removeQueuedClaim(claim.id);
        })
        .then(() => {
          refreshQueue();
          getCommitment(claim.contractId)
            .then((refreshed) => {
              if (selectedIdRef.current === claim.contractId) setDetail(refreshed);
              else refreshList();
            })
            .catch(() => {});
        })
        .catch((err: unknown) => {
          if (isOfflineError(err)) return; // still offline -- leave it queued, say nothing new
          // A real rejection, not just "still offline". Keep the item and
          // show why on it in the banner: the cooperative decides whether
          // to retry again or dismiss it, and it never vanishes unseen.
          const message = err instanceof Error ? err.message : String(err);
          setRetryErrors((prev) => ({ ...prev, [claim.id]: message }));
        })
        .finally(() => setRetryingId(null));
    },
    [walletAddress, refreshQueue, refreshList],
  );

  const dismissQueuedClaim = useCallback(
    (claim: QueuedClaim) => {
      removeQueuedClaim(claim.id).then(refreshQueue);
      setRetryErrors(({ [claim.id]: _dismissed, ...rest }) => rest);
    },
    [refreshQueue],
  );

  return (
    <>
      {/* Skip link, matching site/'s (issue #9). tabIndex=-1 on <main> so the
          jump moves keyboard focus, not just the scroll position. */}
      <a href="#main-content" className="skip-link">
        {t("app.skipToContent")}
      </a>
      <header className="app-header">
        <h1>{t("app.title")}</h1>
        <div className="header-actions">
          <LanguagePicker />
          <span className="tag">{t("app.tag")}</span>
          {walletAddress ? (
            <span className="wallet-address">{`${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`}</span>
          ) : (
            <button className="wallet-button" onClick={handleConnectWallet}>
              {t("app.connectWallet")}
            </button>
          )}
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {walletError && <div className="error-banner" role="alert">{walletError}</div>}

        <OfflineQueueBanner
          queuedClaims={queuedClaims}
          retryingId={retryingId}
          retryErrors={retryErrors}
          onRetry={retryQueuedClaim}
          onDismiss={dismissQueuedClaim}
        />

        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookupInput.trim()) loadDetail(lookupInput.trim());
          }}
        >
          <label htmlFor="contract-lookup" className="sr-only">
            {t("app.contractIdLabel")}
          </label>
          <input
            id="contract-lookup"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder={t("app.contractIdPlaceholder")}
            spellCheck={false}
          />
          <button type="submit" disabled={!lookupInput.trim()}>
            {t("app.lookUp")}
          </button>
        </form>

        <section aria-label={t("app.detailsRegion")}>
          {!selectedId && (
            <div className="empty-state">{t("app.emptyDetail")}</div>
          )}
          {detailLoading && (
            <div className="loading-state" role="status" aria-live="polite">
              {t("app.readingCommitment", { contractId: selectedId ?? "" })}
            </div>
          )}
          {detailError && <div className="error-banner" role="alert">{detailError}</div>}
          {selectedId && detail && !detailLoading && (
            <CommitmentDetail
              commitment={detail}
              contractId={selectedId}
              walletAddress={walletAddress}
              onClaim={handleClaim}
              claimingTranche={claimingTranche}
              claimError={claimError}
              onCancelled={() => loadDetail(selectedId)}
              onReassigned={() => loadDetail(selectedId)}
              onDisputeChanged={() => loadDetail(selectedId)}
            />
          )}
        </section>

        <section>
          <div className="detail-header">
            <h2 className="section-title">
              {t("app.knownCommitments")}
            </h2>
            <button className="refresh-button" onClick={refreshList} disabled={listLoading}>
              {listLoading ? t("app.refreshing") : t("app.refresh")}
            </button>
          </div>
          {listLoading ? (
            <div className="loading-state" role="status" aria-live="polite">{t("app.loadingKnown")}</div>
          ) : listError ? (
            <div className="error-banner" role="alert">{listError}</div>
          ) : (
            <CommitmentList
              commitments={commitments}
              onSelect={loadDetail}
              hasMore={hasMoreCommitments}
              loadingMore={listMoreLoading}
              loadMoreError={listMoreError}
              onLoadMore={loadMoreCommitments}
            />
          )}
        </section>
      </main>
      {import.meta.env.VITE_BUILD_SHA && (
        <footer className="build-info">{t("app.build", { sha: import.meta.env.VITE_BUILD_SHA })}</footer>
      )}
    </>
  );
}
