import type { CommitmentSummary } from "../api";
import { useI18n } from "../i18n";
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

export function CommitmentList({
  commitments,
  onSelect,
  hasMore = false,
  loadingMore = false,
  loadMoreError = null,
  onLoadMore,
}: {
  commitments: CommitmentSummary[];
  onSelect: (contractId: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: string | null;
  onLoadMore?: () => void;
}) {
  const { t } = useI18n();

  if (commitments.length === 0) {
    return (
      <div className="empty-state">
        {t("commitmentList.empty")}
      </div>
    );
  }

  return (
    <div className="commitment-list">
      <button className="refresh-button" onClick={() => downloadCsv(commitments)}>
        {t("commitmentList.downloadCsv")}
      </button>
      {commitments.map((c) => (
        <button key={c.id} className="commitment-row" onClick={() => onSelect(c.contract_id)}>
          {/* copyable=false: this row is itself a <button> -- a nested
              <button> for the copy control would be invalid HTML. */}
          <AddressChip address={c.contract_id} copyable={false} className="contract-id" />
          <StatusBadge status={c.status} />
        </button>
      ))}
      {loadMoreError && <div className="error-banner" role="alert">{loadMoreError}</div>}
      {hasMore && onLoadMore && (
        <button className="refresh-button" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? t("commitmentList.loadingMore") : t("commitmentList.loadMore")}
        </button>
      )}
    </div>
  );
}
