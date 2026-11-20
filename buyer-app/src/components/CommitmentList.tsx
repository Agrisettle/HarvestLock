import type { CommitmentSummary } from "../api";
import { StatusBadge } from "./StatusBadge";
import { AddressChip } from "./AddressChip";

const CSV_COLUMNS: (keyof CommitmentSummary)[] = [
  "id",
  "contract_id",
  "buyer_address",
  "cooperative_address",
  "warehouse_address",
  "token_address",
  "total_amount",
  "advance1_bps",
  "advance2_bps",
  "claim_window_secs",
  "status",
  "created_at",
  "updated_at",
];

function csvCell(value: string | number): string {
  const text = String(value);
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function downloadCsv(commitments: CommitmentSummary[]) {
  const rows = [
    CSV_COLUMNS.map(csvCell).join(","),
    ...commitments.map((commitment) => CSV_COLUMNS.map((column) => csvCell(commitment[column])).join(",")),
  ];
  const blob = new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `commitments-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Renders all three list states itself — in flight, failed, and
 * genuinely empty — rather than leaving the caller to decide whether to
 * mount it at all. Before this, `App.tsx` only mounted the component once
 * `listLoading` was false and `listError` was null, so the whole "What
 * you've locked" section rendered as a blank gap on first load (nothing
 * at all, not even "loading") and an error only showed as a banner in the
 * section above it. Keeping the states here makes each one reviewable in
 * isolation (see CommitmentList.stories.tsx and
 * CommitmentList.test.tsx) and keeps `App.tsx` from having to know which
 * one wins.
 */
export function CommitmentList({
  commitments,
  onSelect,
  loading = false,
  error = null,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  commitments: CommitmentSummary[];
  onSelect: (contractId: string) => void;
  loading?: boolean;
  error?: string | null;
  /** Whether another page may exist. The API's list shape carries no
   * total, so the caller decides this (a full page means "maybe more"). */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  if (loading) {
    return <div className="loading-state" role="status" aria-live="polite">Loading commitments…</div>;
  }

  if (error) {
    // `api.ts` throws `${path} -> ${status}: ${body}` — specific, not a
    // generic "something went wrong" (see api.ts's get/post).
    return <div className="error-banner" role="alert">{error}</div>;
  }

  if (commitments.length === 0) {
    return (
      <div className="empty-state">
        Nothing locked yet. Look up a commitment by contract ID above, or check back once one's been created.
      </div>
    );
  }

  return (
    <div>
      <button type="button" className="refresh-button" onClick={() => downloadCsv(commitments)}>
        Download CSV
      </button>
      <div className="commitment-list" role="list" aria-label="Commitments">
        {/* role="listitem" wrappers: a role="list" may only own listitems,
            not the buttons directly (axe aria-required-children, found in a
            real-browser pass for issue #9). No aria-label: the accessible
            name comes from the row's own text, so it always contains what
            a sighted user sees and voice-control users can say it (WCAG
            2.5.3; an aria-label here tripped axe label-content-name-
            mismatch). The full contract ID rides along visually hidden. */}
        {commitments.map((c) => (
          <div role="listitem" key={c.id}>
            <button
              type="button"
              className="commitment-row"
              onClick={() => onSelect(c.contract_id)}
            >
              {/* copyable=false: this row is itself a <button> -- a nested
                  <button> for the copy control would be invalid HTML. */}
              <AddressChip address={c.contract_id} copyable={false} className="contract-id" />
              {/* The badge is visual; its status is spoken via the sr-only
                  text instead, so it can be separated cleanly from the ID. */}
              <span aria-hidden="true">
                <StatusBadge status={c.status} />
              </span>
              <span className="sr-only">
                , status {c.status}, contract ID {c.contract_id}
              </span>
            </button>
          </div>
        ))}
      </div>
      {hasMore && onLoadMore && (
        <button
          type="button"
          className="load-more-button"
          onClick={onLoadMore}
          disabled={loadingMore}
          aria-busy={loadingMore}
        >
          {loadingMore ? "Loading more…" : "Load more"}
        </button>
      )}
    </div>
  );
}
