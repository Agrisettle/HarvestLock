import { useCallback, useEffect, useState } from "react";
import {
  getCommitment,
  listCommitments,
  buildTx,
  buildConfirmDeliveryTx,
  submitTx,
  type CommitmentDetail as CommitmentDetailType,
  type CommitmentSummary,
} from "./api";
import { connectWallet, signTransactionXdr } from "./wallet";
import { CommitmentDetail } from "./components/CommitmentDetail";
import { CommitmentList } from "./components/CommitmentList";

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
  const [actionInFlight, setActionInFlight] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
    setActionError(null);
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

  // Build -> sign (Freighter) -> submit -> refresh, same shape as every
  // write in this project (api/README.md's architecture section). Both
  // warehouse-operator actions land here even though one uses the generic
  // no-arg builder and the other its own confirm-delivery route -- the
  // signing/submission dance is identical either way.
  const handleMarkCheckpoint = useCallback(() => {
    if (!selectedId || !walletAddress) return;
    setActionError(null);
    setActionInFlight(true);
    buildTx(selectedId, "mark_checkpoint", walletAddress)
      .then(({ xdr }) => signTransactionXdr(xdr, walletAddress))
      .then((signedXdr) => submitTx(signedXdr, selectedId))
      .then(() => getCommitment(selectedId))
      .then(setDetail)
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
      .finally(() => setActionInFlight(false));
  }, [selectedId, walletAddress]);

  const handleConfirmDelivery = useCallback(
    (deliveredQuantity: number, gradeIndex: number) => {
      if (!selectedId || !walletAddress) return;
      setActionError(null);
      setActionInFlight(true);
      buildConfirmDeliveryTx(selectedId, deliveredQuantity, gradeIndex, walletAddress)
        .then(({ xdr }) => signTransactionXdr(xdr, walletAddress))
        .then((signedXdr) => submitTx(signedXdr, selectedId))
        .then(() => getCommitment(selectedId))
        .then(setDetail)
        .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
        .finally(() => setActionInFlight(false));
    },
    [selectedId, walletAddress],
  );

  return (
    <>
      <header className="app-header">
        <h1>HarvestLock — Warehouse Operator</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span className="tag">attestations · testnet</span>
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
                onMarkCheckpoint={handleMarkCheckpoint}
                onConfirmDelivery={handleConfirmDelivery}
                actionInFlight={actionInFlight}
                actionError={actionError}
              />
            )}
          </section>
        )}

        <section>
          <div className="detail-header">
            <h2 style={{ margin: 0, fontFamily: "var(--display)", fontWeight: 600, fontSize: "1.1rem" }}>
              Commitments to attest
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
