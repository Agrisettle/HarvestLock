import { useCallback, useEffect, useState } from "react";
import { getCommitment, listCommitments, type CommitmentDetail as CommitmentDetailType, type CommitmentSummary } from "./api";
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
    getCommitment(contractId)
      .then(setDetail)
      .catch((err: unknown) => {
        setDetail(null);
        setDetailError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setDetailLoading(false));
  }, []);

  return (
    <>
      <header className="app-header">
        <h1>HarvestLock — Cooperative Dashboard</h1>
        <span className="tag">read-only · testnet</span>
      </header>

      <main>
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
            {detail && !detailLoading && <CommitmentDetail commitment={detail} contractId={selectedId} />}
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
