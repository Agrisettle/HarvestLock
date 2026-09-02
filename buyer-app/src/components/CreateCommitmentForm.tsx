import { useState } from "react";

// Mirrors api/src/server.ts's MIN_CLAIM_WINDOW_SECS/MAX_CLAIM_WINDOW_SECS —
// the API enforces these regardless, this is just so a bad value fails
// fast with a clear message instead of a round trip to find out. Keep in
// sync with that file if it changes; there's no shared package these two
// could both import the constant from without more monorepo tooling than
// two small numbers justify.
const MIN_CLAIM_WINDOW_SECS = 3600;
const MAX_CLAIM_WINDOW_SECS = 60 * 60 * 24 * 90;

export interface CreateCommitmentFields {
  cooperative: string;
  warehouseOperator: string;
  token: string;
  totalAmount: string;
  advance1Bps: number;
  advance2Bps: number;
  claimWindowSecs: string;
}

const emptyFields: CreateCommitmentFields = {
  cooperative: "",
  warehouseOperator: "",
  token: "",
  totalAmount: "",
  advance1Bps: 0,
  advance2Bps: 0,
  claimWindowSecs: String(60 * 60 * 24), // a day, a reasonable default, not a claim about what's "right"
};

/** Client-side only — the API is what actually enforces every one of these; this just avoids an obviously-doomed round trip. */
export function validateCreateCommitmentFields(fields: CreateCommitmentFields): string | null {
  if (!fields.cooperative.trim()) return "Cooperative address is required.";
  if (!fields.warehouseOperator.trim()) return "Warehouse operator address is required.";
  if (!fields.token.trim()) return "Token contract address is required.";
  const totalAmount = BigInt(fields.totalAmount || "0");
  if (totalAmount <= 0n) return "Total amount must be greater than zero.";
  if (fields.advance1Bps < 0 || fields.advance1Bps > 10_000) return "Advance 1 share must be between 0% and 100%.";
  if (fields.advance2Bps < 0 || fields.advance2Bps > 10_000) return "Advance 2 share must be between 0% and 100%.";
  if (fields.advance1Bps + fields.advance2Bps > 10_000) return "Advance 1 and Advance 2 shares can't add up to more than 100%.";
  const claimWindowSecs = Number(fields.claimWindowSecs);
  if (claimWindowSecs < MIN_CLAIM_WINDOW_SECS || claimWindowSecs > MAX_CLAIM_WINDOW_SECS) {
    return `Claim window must be between ${MIN_CLAIM_WINDOW_SECS} and ${MAX_CLAIM_WINDOW_SECS} seconds.`;
  }
  return null;
}

export function CreateCommitmentForm({
  onSubmit,
  submitting,
  submitError,
}: {
  onSubmit: (fields: CreateCommitmentFields) => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const [fields, setFields] = useState<CreateCommitmentFields>(emptyFields);
  const [validationError, setValidationError] = useState<string | null>(null);

  function update<K extends keyof CreateCommitmentFields>(key: K, value: CreateCommitmentFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const error = validateCreateCommitmentFields(fields);
    setValidationError(error);
    if (!error) onSubmit(fields);
  }

  return (
    <form className="create-commitment-form" onSubmit={handleSubmit}>
      <h3>Create a new commitment</h3>

      {(validationError ?? submitError) && <div className="error-banner">{validationError ?? submitError}</div>}

      <label htmlFor="cooperative-address">Cooperative address</label>
      <input
        id="cooperative-address"
        value={fields.cooperative}
        onChange={(e) => update("cooperative", e.target.value)}
        placeholder="G..."
        spellCheck={false}
      />

      <label htmlFor="warehouse-address">Warehouse operator address</label>
      <input
        id="warehouse-address"
        value={fields.warehouseOperator}
        onChange={(e) => update("warehouseOperator", e.target.value)}
        placeholder="G..."
        spellCheck={false}
      />

      <label htmlFor="token-address">Token contract address</label>
      <input
        id="token-address"
        value={fields.token}
        onChange={(e) => update("token", e.target.value)}
        placeholder="C..."
        spellCheck={false}
      />

      <label htmlFor="total-amount">Total amount (stroops)</label>
      <input
        id="total-amount"
        value={fields.totalAmount}
        onChange={(e) => update("totalAmount", e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="1000000000"
        inputMode="numeric"
      />

      <label htmlFor="advance1-bps">Advance 1 share (basis points)</label>
      <input
        id="advance1-bps"
        type="number"
        min={0}
        max={10_000}
        value={fields.advance1Bps}
        onChange={(e) => update("advance1Bps", Number(e.target.value))}
      />

      <label htmlFor="advance2-bps">Advance 2 share (basis points)</label>
      <input
        id="advance2-bps"
        type="number"
        min={0}
        max={10_000}
        value={fields.advance2Bps}
        onChange={(e) => update("advance2Bps", Number(e.target.value))}
      />

      <label htmlFor="claim-window">Claim window (seconds)</label>
      <input
        id="claim-window"
        value={fields.claimWindowSecs}
        onChange={(e) => update("claimWindowSecs", e.target.value.replace(/[^0-9]/g, ""))}
        inputMode="numeric"
      />

      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create commitment"}
      </button>
    </form>
  );
}
