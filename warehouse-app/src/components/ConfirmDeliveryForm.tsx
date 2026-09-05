import { useState } from "react";

function formatGradeLabel(index: number, bps: number): string {
  return `Grade ${index} — ${(bps / 100).toFixed(2)}% of unit price`;
}

/**
 * The one-time, irreversible attestation: `confirm_delivery(delivered_quantity,
 * grade_index)`. lib.rs computes `settlement_bps` from these two numbers
 * against the pre-agreed `grade_price_bps` table and `settle` pays out
 * against it — this contract doesn't arbitrate a grade/quantity dispute,
 * that's the warehouse operator's own appeals process (PRD's edge-case
 * table), which is why the confirmation copy below says so plainly rather
 * than implying HarvestLock could undo or referee it later.
 */
export function ConfirmDeliveryForm({
  contractedQuantity,
  gradePriceBps,
  onSubmit,
  submitting,
  submitError,
}: {
  contractedQuantity: number;
  gradePriceBps: number[];
  onSubmit: (deliveredQuantity: number, gradeIndex: number) => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const [deliveredQuantity, setDeliveredQuantity] = useState(String(contractedQuantity));
  const [gradeIndex, setGradeIndex] = useState(0);

  const parsedQuantity = Number(deliveredQuantity);
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity >= 0;

  return (
    <form
      className="confirm-delivery-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (quantityValid) onSubmit(parsedQuantity, gradeIndex);
      }}
    >
      <h3>Confirm delivery</h3>
      <p>
        Attest what actually arrived, against the {contractedQuantity}-unit contracted quantity. This can't be
        corrected afterward — a grade or quantity dispute is your own appeals process, not HarvestLock's.
      </p>

      <label htmlFor="delivered-quantity">Delivered quantity</label>
      <input
        id="delivered-quantity"
        type="number"
        min={0}
        value={deliveredQuantity}
        onChange={(e) => setDeliveredQuantity(e.target.value)}
      />

      <label htmlFor="grade-index">Grade</label>
      <select id="grade-index" value={gradeIndex} onChange={(e) => setGradeIndex(Number(e.target.value))}>
        {gradePriceBps.map((bps, i) => (
          <option key={i} value={i}>
            {formatGradeLabel(i, bps)}
          </option>
        ))}
      </select>

      {submitError && <div className="error-banner">{submitError}</div>}

      <button type="submit" disabled={submitting || !quantityValid}>
        {submitting ? "Confirming…" : "Confirm delivery"}
      </button>
    </form>
  );
}
