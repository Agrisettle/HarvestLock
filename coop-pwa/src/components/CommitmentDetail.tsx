import type { CommitmentDetail as CommitmentDetailType } from "../api";
import { StatusBadge } from "./StatusBadge";
import { CancelSection } from "./CancelSection";
import { ReassignBuyerSection } from "./ReassignBuyerSection";

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

/**
 * Whether `claim_advance_N` is actually worth offering right now — checked
 * client-side so the UI doesn't invite a transaction the contract will
 * just reject. Mirrors lib.rs's claim_tranche guards: window opened
 * (deadline != 0), not already claimed or expired, and not past the
 * deadline (the contract's real clock is on-chain at submit time, so this
 * is a UX nicety, not the actual enforcement — a claim submitted right at
 * the boundary can still legitimately fail server-side; that's fine, the
 * contract is the source of truth, this just avoids the *obviously*
 * doomed case).
 */
function canClaim(deadline: string, claimed: boolean, expired: boolean): boolean {
  if (claimed || expired) return false;
  const deadlineMs = Number(deadline) * 1000;
  if (deadline === "0" || Number.isNaN(deadlineMs)) return false;
  return deadlineMs > Date.now();
}

export function CommitmentDetail({
  commitment,
  contractId,
  walletAddress,
  onClaim,
  claimingTranche,
  claimError,
  onCancelled,
  onReassigned,
}: {
  commitment: CommitmentDetailType;
  contractId: string;
  walletAddress: string | null;
  onClaim: (tranche: 1 | 2) => void;
  claimingTranche: 1 | 2 | null;
  claimError: string | null;
  onCancelled: () => void;
  onReassigned: () => void;
}) {
  // claim_advance_* is cooperative-auth-gated (lib.rs) — offering the
  // button to a connected wallet that isn't the cooperative would just
  // produce an on-chain auth rejection, so it's hidden instead.
  const isCooperative = walletAddress !== null && walletAddress === commitment.cooperative;

  return (
    <div className="card">
      <div className="detail-header">
        <StatusBadge status={commitment.status} />
        <span className="contract-id">{contractId}</span>
      </div>

      <CancelSection commitment={commitment} contractId={contractId} walletAddress={walletAddress} onCancelled={onCancelled} />
      <ReassignBuyerSection
        commitment={commitment}
        contractId={contractId}
        walletAddress={walletAddress}
        onReassigned={onReassigned}
      />

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

      {claimError && <div className="error-banner">{claimError}</div>}

      <table className="tranches">
        <thead>
          <tr>
            <th>Tranche</th>
            <th>Share</th>
            <th>Claim deadline</th>
            <th>State</th>
            {isCooperative && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Advance 1</td>
            <td>{formatBps(commitment.advance1_bps)}</td>
            <td>{formatDeadline(commitment.advance1_deadline)}</td>
            <td>{claimState(commitment.advance1_claimed, commitment.advance1_expired)}</td>
            {isCooperative && (
              <td>
                {canClaim(commitment.advance1_deadline, commitment.advance1_claimed, commitment.advance1_expired) && (
                  <button
                    className="claim-button"
                    onClick={() => onClaim(1)}
                    disabled={claimingTranche !== null}
                  >
                    {claimingTranche === 1 ? "Claiming…" : "Claim"}
                  </button>
                )}
              </td>
            )}
          </tr>
          <tr>
            <td>Advance 2</td>
            <td>{formatBps(commitment.advance2_bps)}</td>
            <td>{formatDeadline(commitment.advance2_deadline)}</td>
            <td>{claimState(commitment.advance2_claimed, commitment.advance2_expired)}</td>
            {isCooperative && (
              <td>
                {canClaim(commitment.advance2_deadline, commitment.advance2_claimed, commitment.advance2_expired) && (
                  <button
                    className="claim-button"
                    onClick={() => onClaim(2)}
                    disabled={claimingTranche !== null}
                  >
                    {claimingTranche === 2 ? "Claiming…" : "Claim"}
                  </button>
                )}
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
