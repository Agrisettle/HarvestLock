import type { CommitmentDetail as CommitmentDetailType } from "../api";
import { StatusBadge } from "./StatusBadge";
import { AddressChip } from "./AddressChip";
import { ConfirmDeliveryForm } from "./ConfirmDeliveryForm";
import { DisputeSection } from "./DisputeSection";

const deadlineFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatDeadline(unixSecs: string): string {
  return `${deadlineFormatter.format(new Date(Number(unixSecs) * 1000))} UTC`;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * What this warehouse operator can actually do right now, if anything.
 * Both actions are warehouse-operator-gated in lib.rs (`mark_checkpoint`,
 * `confirm_delivery`) — this only decides when it makes sense to *offer*
 * them; the contract itself is what actually enforces who's allowed to
 * call them.
 */
type Action = "checkpoint" | "deliver" | null;

/*
 * Loading/error/empty states (UX audit, #182):
 *   • Loading   — owned by App.tsx: while `detailLoading` is true it renders
 *     <div className="loading-state">Reading {contractId} from chain…</div>;
 *     in-flight actions show "Marking checkpoint…"/"Confirming…" on disabled
 *     buttons instead of going blank.
 *   • Error     — `detailError` (chain lookup failure) and `actionError`
 *     (signing/submission failure) both render the shared `error-banner` with
 *     the specific upstream message (api.ts's `get`/`post` surface
 *     `${path} -> ${status}: ${body}`), never a generic "something went wrong".
 *   • Empty     — there is no separate empty state: a loaded commitment always
 *     renders its detail card, and a commitment that doesn't exist surfaces as
 *     a 404 error banner rather than an empty page. Before a contract ID has
 *     been looked up, the lookup form stays on screen.
 */

function nextAction(c: CommitmentDetailType): Action {
  if (c.status === "Advance1Released") return "checkpoint";
  if (c.status === "ReadyForDelivery" && c.remainder_funded) return "deliver";
  return null;
}

export function CommitmentDetail({
  commitment,
  contractId,
  walletAddress,
  onMarkCheckpoint,
  onConfirmDelivery,
  actionInFlight,
  actionError,
  onDisputeChanged,
}: {
  commitment: CommitmentDetailType;
  contractId: string;
  walletAddress: string | null;
  onMarkCheckpoint: () => void;
  onConfirmDelivery: (deliveredQuantity: number, gradeIndex: number) => void;
  actionInFlight: boolean;
  actionError: string | null;
  onDisputeChanged: () => void;
}) {
  const action = nextAction(commitment);

  return (
    <div className="card">
      <div className="detail-header">
        <StatusBadge status={commitment.status} />
        <AddressChip address={contractId} className="contract-id" />
      </div>

      {actionError && <div className="error-banner">{actionError}</div>}

      <DisputeSection
        commitment={commitment}
        contractId={contractId}
        walletAddress={walletAddress}
        onDisputeChanged={onDisputeChanged}
      />

      {action === "checkpoint" && (
        <button className="action-button" onClick={onMarkCheckpoint} disabled={actionInFlight}>
          {actionInFlight ? "Marking checkpoint…" : "Mark mid-season checkpoint"}
        </button>
      )}

      {commitment.status === "ReadyForDelivery" && !commitment.remainder_funded && (
        <p className="pending-summary">
          The cooperative has signaled they're setting out for delivery, but the buyer hasn't funded the remainder
          yet. Delivery can't be confirmed until they do.
        </p>
      )}

      {action === "deliver" && (
        <ConfirmDeliveryForm
          contractedQuantity={commitment.contracted_quantity}
          gradePriceBps={commitment.grade_price_bps}
          onSubmit={onConfirmDelivery}
          submitting={actionInFlight}
          submitError={actionError}
        />
      )}

      {(commitment.status === "Delivered" || commitment.status === "Settled") && (
        <div className="delivery-record">
          <h3>Delivery attested</h3>
          <p className="delivery-reference">Contract {contractId}</p>
          <dl className="party-grid">
            <div>
              <dt>Delivered quantity</dt>
              <dd>
                {commitment.delivered_quantity} / {commitment.contracted_quantity} contracted
              </dd>
            </div>
            <div>
              <dt>Grade</dt>
              <dd>
                {commitment.grade_index} ({formatBps(commitment.grade_price_bps[commitment.grade_index] ?? 0)})
              </dd>
            </div>
            <div>
              <dt>Settlement</dt>
              <dd>{formatBps(commitment.settlement_bps)} of contract value</dd>
            </div>
          </dl>
          <button className="print-receipt-button" onClick={() => window.print()}>
            Print receipt
          </button>
        </div>
      )}

      <dl className="party-grid">
        <div>
          <dt>Buyer</dt>
          <dd>
            <AddressChip address={commitment.buyer} />
          </dd>
        </div>
        <div>
          <dt>Cooperative</dt>
          <dd>
            <AddressChip address={commitment.cooperative} />
          </dd>
        </div>
        <div>
          <dt>Contracted quantity</dt>
          <dd>{commitment.contracted_quantity}</dd>
        </div>
        <div>
          <dt>Delivery deadline</dt>
          <dd>{formatDeadline(commitment.delivery_deadline)}</dd>
        </div>
      </dl>

      <div className="tranches-scroll" role="region" aria-label="Grade price schedule" tabIndex={0}>
        <table className="tranches">
          <thead>
            <tr>
              <th>Grade</th>
              <th>Price multiplier</th>
            </tr>
          </thead>
          <tbody>
            {commitment.grade_price_bps.map((bps, i) => (
              <tr key={i}>
                <td>Grade {i}</td>
                <td>{formatBps(bps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
