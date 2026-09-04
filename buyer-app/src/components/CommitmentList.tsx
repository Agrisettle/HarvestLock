import type { CommitmentSummary } from "../api";
import { StatusBadge } from "./StatusBadge";
import { AddressChip } from "./AddressChip";

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
        Nothing locked yet. Look up a commitment by contract ID above, or check back once one's been created.
      </div>
    );
  }

  return (
    <div className="commitment-list">
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
