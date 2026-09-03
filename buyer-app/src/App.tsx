import { useCallback, useEffect, useState } from "react";
import {
  getCommitment,
  listCommitments,
  buildTx,
  submitTx,
  deployCommitment,
  buildInitializeTx,
  type CommitmentDetail as CommitmentDetailType,
  type CommitmentSummary,
} from "./api";
import { connectWallet, signTransactionXdr } from "./wallet";
import { CommitmentDetail } from "./components/CommitmentDetail";
import { CommitmentList } from "./components/CommitmentList";
import { CreateCommitmentForm, type CreateCommitmentFields } from "./components/CreateCommitmentForm";

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

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
  // write in this project (api/README.md's architecture section) and
  // identical to coop-pwa's claim-advance flow, just for lock/settle
  // instead. `lock` needs sourcePublicKey === buyer (require_auth in
  // lib.rs); `settle` has no auth requirement at all, so any connected
  // wallet's key works as the transaction source.
  const handleAction = useCallback(
    (action: "lock" | "settle") => {
      if (!selectedId || !walletAddress) return;
      setActionError(null);
      setActionInFlight(true);
      buildTx(selectedId, action, walletAddress)
        .then(({ xdr }) => signTransactionXdr(xdr, walletAddress))
        .then((signedXdr) => submitTx(signedXdr, selectedId))
        .then(() => getCommitment(selectedId))
        .then(setDetail)
        .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
        .finally(() => setActionInFlight(false));
    },
    [selectedId, walletAddress],
  );

  // Deploy -> build initialize -> sign -> submit -> look it up. The
  // "create commitment" flow TASKS.md flagged as unexercised by any
  // frontend: three API calls with a client-side signature in the
  // middle, not one endpoint, because the buyer has to sign initialize
  // themselves (api/README.md's architecture section explains why this
  // isn't collapsed into a single call).
  const handleCreateCommitment = useCallback(
    (fields: CreateCommitmentFields) => {
      if (!walletAddress) return;
      setCreateError(null);
      setCreating(true);
      let newContractId = "";
      deployCommitment()
        .then(({ contractId }) => {
          newContractId = contractId;
          return buildInitializeTx(contractId, {
            buyer: walletAddress,
            cooperative: fields.cooperative,
            warehouseOperator: fields.warehouseOperator,
            token: fields.token,
            totalAmount: fields.totalAmount,
            advance1Bps: fields.advance1Bps,
            advance2Bps: fields.advance2Bps,
            claimWindowSecs: fields.claimWindowSecs,
            remainderWindowSecs: fields.remainderWindowSecs,
            deliveryWindowSecs: fields.deliveryWindowSecs,
            sourcePublicKey: walletAddress,
          });
        })
        .then(({ xdr }) => signTransactionXdr(xdr, walletAddress))
        .then((signedXdr) => submitTx(signedXdr, newContractId))
        .then(() => {
          setShowCreateForm(false);
          refreshList();
          loadDetail(newContractId);
        })
        .catch((err: unknown) => setCreateError(err instanceof Error ? err.message : String(err)))
        .finally(() => setCreating(false));
    },
    [walletAddress, refreshList, loadDetail],
  );

  return (
    <>
      <header className="app-header">
        <h1>HarvestLock — Buyer Dashboard</h1>
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

        {walletAddress && (
          <section>
            {!showCreateForm ? (
              <button className="wallet-button" onClick={() => setShowCreateForm(true)}>
                Create commitment
              </button>
            ) : (
              <CreateCommitmentForm onSubmit={handleCreateCommitment} submitting={creating} submitError={createError} />
            )}
          </section>
        )}

        {selectedId && (
          <section>
            {detailLoading && <div className="loading-state">Reading {selectedId} from chain…</div>}
            {detailError && <div className="error-banner">{detailError}</div>}
            {detail && !detailLoading && (
              <CommitmentDetail
                commitment={detail}
                contractId={selectedId}
                walletAddress={walletAddress}
                onAction={handleAction}
                actionInFlight={actionInFlight}
                actionError={actionError}
                onCancelled={() => loadDetail(selectedId)}
                onReassigned={() => loadDetail(selectedId)}
              />
            )}
          </section>
        )}

        <section>
          <div className="detail-header">
            <h2 style={{ margin: 0, fontFamily: "var(--display)", fontWeight: 600, fontSize: "1.1rem" }}>
              What you've locked
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
