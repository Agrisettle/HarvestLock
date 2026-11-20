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

/*
 * Loading/error/empty states (UX audit, #181):
 *   • Empty     — renders the `empty-state` message when there are no
 *     commitments yet ("Nothing to attest yet…").
 *   • Loading/Error — not owned here; this component only receives the already
 *     fetched list. App.tsx renders `loading-state` ("Loading commitments…")
 *     while `listLoading` is true and the shared `error-banner` (with the
 *     specific upstream message from api.ts's `get`, never a generic
 *     "something went wrong") when `listError` is set.
 */

export function CommitmentList({
  commitments,
  onSelect,
}: {
  commitments: CommitmentSummary[];
  onSelect: (contractId: string) => void;
}) {
  if (commitments.length === 0) {
    return (
      <div className="empty-state">
        Nothing to attest yet. Look up a commitment by contract ID above, or check back once one's been created.
      </div>
    );
  }

  return (
    <div className="commitment-list">
      <button className="refresh-button" onClick={() => downloadCsv(commitments)}>
        Download CSV
      </button>
      {commitments.map((c) => (
        <button key={c.id} className="commitment-row" onClick={() => onSelect(c.contract_id)}>
          {/* copyable=false: this row is itself a <button> -- a nested
              <button> for the copy control would be invalid HTML. */}
          <AddressChip address={c.contract_id} copyable={false} className="contract-id" />
          <StatusBadge status={c.status} />
        </button>
      ))}
    </div>
  );
}
