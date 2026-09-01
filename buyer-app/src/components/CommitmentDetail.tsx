import type { CommitmentDetail as CommitmentDetailType } from "../api";
import { StatusBadge } from "./StatusBadge";

function formatDeadline(unixSecs: string): string {
  const n = Number(unixSecs);
  // The contract stores 0 as "unset" — release_advance_N hasn't run yet,
  // so no claim window exists to show. Not an error, not epoch-1970.
  if (n === 0) return "not yet opened";
  return new Date(n * 1000).toLocaleString();
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function claimState(claimed: boolean, expired: boolean): string {
  if (claimed) return "released";
  if (expired) return "window expired, reclaimable";
  return "pending";
}

/** Buyer-facing framing: what's still outstanding, in plain language. */
function pendingSummary(c: CommitmentDetailType): string {
  if (c.status === "Settled") return "Settled — the full remaining balance has been paid to the cooperative.";
  if (c.status === "Cancelled") return "Cancelled — this commitment was unwound.";
  if (c.status === "Defaulted" || c.status === "Disputed") return `${c.status} — needs attention.`;

  const outstanding: string[] = [];
  if (!c.advance1_claimed && !c.advance1_expired) outstanding.push("advance 1 not yet released or claimed");
  if (!c.advance2_claimed && !c.advance2_expired) outstanding.push("advance 2 not yet released or claimed");
  if (outstanding.length === 0) {
    return "Both advances are resolved — this commitment is ready to settle.";
  }
  return `Pending: ${outstanding.join("; ")}.`;
}

export function CommitmentDetail({ commitment, contractId }: { commitment: CommitmentDetailType; contractId: string }) {
  return (
    <div className="card">
      <div className="detail-header">
        <StatusBadge status={commitment.status} />
        <span className="contract-id">{contractId}</span>
      </div>

      <p className="pending-summary">{pendingSummary(commitment)}</p>

      <dl className="party-grid">
        <div>
          <dt>Total locked</dt>
          <dd>{commitment.total_amount}</dd>
        </div>
        <div>
          <dt>Cooperative</dt>
          <dd>{commitment.cooperative}</dd>
        </div>
        <div>
          <dt>Warehouse operator</dt>
          <dd>{commitment.warehouse_operator}</dd>
        </div>
        <div>
          <dt>Token</dt>
          <dd>{commitment.token}</dd>
        </div>
        <div>
          <dt>Buyer (you)</dt>
          <dd>{commitment.buyer}</dd>
        </div>
        <div>
          <dt>Claim window</dt>
          <dd>{commitment.claim_window_secs}s</dd>
        </div>
      </dl>

      <table className="tranches">
        <thead>
          <tr>
            <th>Tranche</th>
            <th>Share</th>
            <th>Claim deadline</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Advance 1</td>
            <td>{formatBps(commitment.advance1_bps)}</td>
            <td>{formatDeadline(commitment.advance1_deadline)}</td>
            <td>{claimState(commitment.advance1_claimed, commitment.advance1_expired)}</td>
          </tr>
          <tr>
            <td>Advance 2</td>
            <td>{formatBps(commitment.advance2_bps)}</td>
            <td>{formatDeadline(commitment.advance2_deadline)}</td>
            <td>{claimState(commitment.advance2_claimed, commitment.advance2_expired)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
