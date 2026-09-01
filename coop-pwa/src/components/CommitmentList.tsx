import type { CommitmentSummary } from "../api";
import { StatusBadge } from "./StatusBadge";

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
        No commitments cached yet. Look one up by contract ID above, or check back once one's been created.
      </div>
    );
  }

  return (
    <div className="commitment-list">
      {commitments.map((c) => (
        <button key={c.id} className="commitment-row" onClick={() => onSelect(c.contract_id)}>
          <span className="contract-id">{c.contract_id}</span>
          <StatusBadge status={c.status} />
        </button>
      ))}
    </div>
  );
}
