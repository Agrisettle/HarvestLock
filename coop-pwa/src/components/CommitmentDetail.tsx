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
  if (claimed) return "claimed";
  if (expired) return "expired, reclaimable";
  return "pending";
}

export function CommitmentDetail({ commitment, contractId }: { commitment: CommitmentDetailType; contractId: string }) {
  return (
    <div className="card">
      <div className="detail-header">
        <StatusBadge status={commitment.status} />
        <span className="contract-id">{contractId}</span>
      </div>

      <dl className="party-grid">
        <div>
          <dt>Buyer</dt>
          <dd>{commitment.buyer}</dd>
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
          <dt>Total amount</dt>
          <dd>{commitment.total_amount}</dd>
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
