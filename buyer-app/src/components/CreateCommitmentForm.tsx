import { useState } from "react";
import { durationToSecs, parseTokenAmount, percentToBps, type DurationUnit } from "../amount";

// Mirrors api/src/server.ts's MIN_CLAIM_WINDOW_SECS/MAX_CLAIM_WINDOW_SECS
// (and the two window pairs below) — the API enforces these regardless,
// this is just so a bad value fails fast with a clear message instead of
// a round trip to find out. Keep in sync with that file if it changes;
// there's no shared package these two could both import the constants
// from without more monorepo tooling than a handful of numbers justify.
const MIN_CLAIM_WINDOW_SECS = 3600;
const MAX_CLAIM_WINDOW_SECS = 60 * 60 * 24 * 90;
const MIN_REMAINDER_WINDOW_SECS = 3600;
const MAX_REMAINDER_WINDOW_SECS = 60 * 60 * 24 * 30;
const MIN_DELIVERY_WINDOW_SECS = 60 * 60 * 24;
const MAX_DELIVERY_WINDOW_SECS = 60 * 60 * 24 * 365;

// Set if the marketing site is deployed somewhere reachable; unset by
// default (no deployed site domain exists yet — see site/README.md and
// index.html's OG-image comment for the same caveat). When unset, the
// consent line below degrades to plain text instead of a broken link,
// same "opt-in, gracefully absent" pattern as site/'s useLiveStatus hook.
const rolesUrl = import.meta.env.VITE_SITE_URL ? `${import.meta.env.VITE_SITE_URL}/roles.html` : null;

export interface CreateCommitmentFields {
  cooperative: string;
  warehouseOperator: string;
  token: string;
  totalAmount: string;
  advance1Bps: number;
  advance2Bps: number;
  claimWindowSecs: string;
  remainderWindowSecs: string;
  deliveryWindowSecs: string;
  // contractedQuantity/gradePriceBps mirror lib.rs's initialize() args of
  // the same name (PRD §7's shortfall/grade adjustment schedule) — see
  // api/HANDOFF.md's "next steps" item 10: the API/contract have carried
  // these since Deployment 6, but no frontend ever collected them, so
  // every commitment created through this form got whatever the API
  // happened to receive instead of a real, buyer-chosen schedule.
  contractedQuantity: string;
  gradePriceBps: string;
  // oracleConfig fields, same gap, one deployment later (Deployment 8/9,
  // PRD §16.3/§4.2 option (b)). fxConversionEnabled toggles the whole
  // group; leaving it off sends oracleConfig: null, exactly lib.rs's
  // documented "a plain deal that needs no conversion" case.
  fxConversionEnabled: boolean;
  oracleContract: string;
  priceAsset: string;
  oracleMaxAgeSecs: string;
  denominatedAmount: string;
  rolesAcknowledged: boolean;
}

const emptyFields: CreateCommitmentFields = {
  cooperative: "",
  warehouseOperator: "",
  token: "",
  totalAmount: "",
  advance1Bps: 0,
  advance2Bps: 0,
  claimWindowSecs: String(60 * 60 * 24), // a day, a reasonable default, not a claim about what's "right"
  remainderWindowSecs: String(60 * 60 * 24 * 7), // 7 days, per this project's default/forfeiture model
  deliveryWindowSecs: String(60 * 60 * 24 * 120), // 120 days, same
  contractedQuantity: "",
  // A single grade bucket at 10000bps (full price regardless of grade) —
  // the sensible default for a deal that doesn't need a real grade
  // schedule, since lib.rs requires at least one entry unconditionally.
  gradePriceBps: "10000",
  fxConversionEnabled: false,
  oracleContract: "",
  priceAsset: "",
  oracleMaxAgeSecs: String(60 * 60 * 24), // a day, same non-claim as the windows above
  denominatedAmount: "",
  rolesAcknowledged: false,
};

// What the buyer actually types: token units (USDC), a number plus a
// days/hours unit, and percentages. Converted to the API's stroop / second /
// basis-point strings on submit, so the API contract is unchanged.
interface WindowInput {
  value: string;
  unit: DurationUnit;
}
interface FriendlyInputs {
  amount: string;
  advance1Pct: string;
  advance2Pct: string;
  claim: WindowInput;
  remainder: WindowInput;
  delivery: WindowInput;
}

const emptyInputs: FriendlyInputs = {
  amount: "",
  advance1Pct: "0",
  advance2Pct: "0",
  claim: { value: "1", unit: "days" },
  remainder: { value: "7", unit: "days" },
  delivery: { value: "120", unit: "days" },
};

/** Converts the friendly inputs into the API-shaped fields. Returns an error message instead of throwing. */
export function applyFriendlyInputs(
  fields: CreateCommitmentFields,
  inputs: FriendlyInputs,
): { fields: CreateCommitmentFields } | { error: string } {
  try {
    const totalAmount = parseTokenAmount(inputs.amount.trim() === "" ? "0" : inputs.amount).toString();
    return {
      fields: {
        ...fields,
        totalAmount,
        advance1Bps: percentToBps(inputs.advance1Pct),
        advance2Bps: percentToBps(inputs.advance2Pct),
        claimWindowSecs: durationToSecs(inputs.claim.value, inputs.claim.unit),
        remainderWindowSecs: durationToSecs(inputs.remainder.value, inputs.remainder.unit),
        deliveryWindowSecs: durationToSecs(inputs.delivery.value, inputs.delivery.unit),
      },
    };
  } catch (e) {
    return { error: `${e instanceof Error ? e.message : "Invalid number."}` };
  }
}

/** Parses the comma-separated grade-price-schedule input into lib.rs's `grade_price_bps: Vec<u32>` shape. Exported so App.tsx's submit handler can reuse the exact same parse, not a second copy of it. */
export function parseGradePriceBps(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

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
  const remainderWindowSecs = Number(fields.remainderWindowSecs);
  if (remainderWindowSecs < MIN_REMAINDER_WINDOW_SECS || remainderWindowSecs > MAX_REMAINDER_WINDOW_SECS) {
    return `Remainder-payment window must be between ${MIN_REMAINDER_WINDOW_SECS} and ${MAX_REMAINDER_WINDOW_SECS} seconds.`;
  }
  const deliveryWindowSecs = Number(fields.deliveryWindowSecs);
  if (deliveryWindowSecs < MIN_DELIVERY_WINDOW_SECS || deliveryWindowSecs > MAX_DELIVERY_WINDOW_SECS) {
    return `Delivery window must be between ${MIN_DELIVERY_WINDOW_SECS} and ${MAX_DELIVERY_WINDOW_SECS} seconds.`;
  }
  // Mirrors api/src/server.ts's initialize validation exactly (no API-level
  // narrowing beyond the contract's own guards — see that file's comment
  // on why, right next to these same two checks).
  const contractedQuantity = Number(fields.contractedQuantity);
  if (!Number.isInteger(contractedQuantity) || contractedQuantity <= 0) {
    return "Contracted quantity must be a positive whole number.";
  }
  const gradePriceBps = parseGradePriceBps(fields.gradePriceBps);
  if (gradePriceBps.length === 0 || gradePriceBps.some((bps) => !Number.isInteger(bps) || bps < 0 || bps > 10_000)) {
    return "Grade price schedule must be a comma-separated list of whole numbers between 0 and 10000, with at least one entry.";
  }
  if (fields.fxConversionEnabled) {
    if (!fields.oracleContract.trim()) return "Oracle contract address is required when FX conversion is enabled.";
    if (!fields.priceAsset.trim()) return "Price asset is required when FX conversion is enabled.";
    const maxAgeSecs = Number(fields.oracleMaxAgeSecs);
    if (!Number.isInteger(maxAgeSecs) || maxAgeSecs <= 0) {
      return "Oracle max quote age must be a positive whole number of seconds.";
    }
    try {
      if (BigInt(fields.denominatedAmount || "0") <= 0n) {
        return "Deal value in the price asset must be greater than zero.";
      }
    } catch {
      return "Deal value in the price asset must be a whole number.";
    }
  }
  // Not enforced by the API (it can't know whether a UI showed this) —
  // enforced here so a buyer can't lock a commitment without ever having
  // been shown what a missed remainder deadline means. See site/roles.html.
  if (!fields.rolesAcknowledged) {
    return "You must confirm you've read Roles & Responsibilities before creating a commitment.";
  }
  return null;
}

// Every message validateCreateCommitmentFields can emit for the FX/oracle
// group. Turning FX conversion off hides those inputs, so an error that
// points at one would be left in the banner with nothing the buyer can do
// about it -- clear those when the group closes, but leave unrelated
// validation errors alone.
const FX_VALIDATION_ERROR_PREFIXES = [
  "Oracle contract address",
  "Price asset",
  "Oracle max quote age",
  "Deal value in the price asset",
];

function isFxValidationError(message: string): boolean {
  return FX_VALIDATION_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix));
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
  const [inputs, setInputs] = useState<FriendlyInputs>(emptyInputs);
  const [validationError, setValidationError] = useState<string | null>(null);

  function update<K extends keyof CreateCommitmentFields>(key: K, value: CreateCommitmentFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function toggleFxConversion(enabled: boolean) {
    update("fxConversionEnabled", enabled);
    if (!enabled) {
      setValidationError((current) => (current && isFxValidationError(current) ? null : current));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const converted = applyFriendlyInputs(fields, inputs);
    if ("error" in converted) {
      setValidationError(converted.error);
      return;
    }
    const error = validateCreateCommitmentFields(converted.fields);
    setValidationError(error);
    if (!error) onSubmit(converted.fields);
  }

  return (
    <form className="create-commitment-form" aria-labelledby="create-commitment-heading" onSubmit={handleSubmit}>
      <h2 id="create-commitment-heading">Create a new commitment</h2>

      {(validationError ?? submitError) && <div className="error-banner" role="alert">{validationError ?? submitError}</div>}

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

      <label htmlFor="total-amount">Total amount (USDC)</label>
      <input
        id="total-amount"
        value={inputs.amount}
        onChange={(e) => setInputs((p) => ({ ...p, amount: e.target.value.replace(/[^0-9.]/g, "") }))}
        placeholder="100.00"
        inputMode="decimal"
      />

      <label htmlFor="advance1-pct">Advance 1 share (%)</label>
      <input
        id="advance1-pct"
        value={inputs.advance1Pct}
        onChange={(e) => setInputs((p) => ({ ...p, advance1Pct: e.target.value.replace(/[^0-9.]/g, "") }))}
        inputMode="decimal"
      />

      <label htmlFor="advance2-pct">Advance 2 share (%)</label>
      <input
        id="advance2-pct"
        value={inputs.advance2Pct}
        onChange={(e) => setInputs((p) => ({ ...p, advance2Pct: e.target.value.replace(/[^0-9.]/g, "") }))}
        inputMode="decimal"
      />

      <label htmlFor="claim-window">Claim window</label>
      <div className="window-input">
        <input
          id="claim-window"
          value={inputs.claim.value}
          onChange={(e) => setInputs((p) => ({ ...p, claim: { ...p.claim, value: e.target.value.replace(/[^0-9]/g, "") } }))}
          inputMode="numeric"
        />
        <select
          aria-label="Claim window unit"
          value={inputs.claim.unit}
          onChange={(e) => setInputs((p) => ({ ...p, claim: { ...p.claim, unit: e.target.value as DurationUnit } }))}
        >
          <option value="days">days</option>
          <option value="hours">hours</option>
        </select>
      </div>

      <label htmlFor="remainder-window">Remainder-payment window</label>
      <div className="window-input">
        <input
          id="remainder-window"
          value={inputs.remainder.value}
          onChange={(e) => setInputs((p) => ({ ...p, remainder: { ...p.remainder, value: e.target.value.replace(/[^0-9]/g, "") } }))}
          inputMode="numeric"
        />
        <select
          aria-label="Remainder-payment window unit"
          value={inputs.remainder.unit}
          onChange={(e) => setInputs((p) => ({ ...p, remainder: { ...p.remainder, unit: e.target.value as DurationUnit } }))}
        >
          <option value="days">days</option>
          <option value="hours">hours</option>
        </select>
      </div>

      <label htmlFor="delivery-window">Delivery window</label>
      <div className="window-input">
        <input
          id="delivery-window"
          value={inputs.delivery.value}
          onChange={(e) => setInputs((p) => ({ ...p, delivery: { ...p.delivery, value: e.target.value.replace(/[^0-9]/g, "") } }))}
          inputMode="numeric"
        />
        <select
          aria-label="Delivery window unit"
          value={inputs.delivery.unit}
          onChange={(e) => setInputs((p) => ({ ...p, delivery: { ...p.delivery, unit: e.target.value as DurationUnit } }))}
        >
          <option value="days">days</option>
          <option value="hours">hours</option>
        </select>
      </div>

      <label htmlFor="contracted-quantity">Contracted quantity (units — e.g. kg or bags)</label>
      <input
        id="contracted-quantity"
        value={fields.contractedQuantity}
        onChange={(e) => update("contractedQuantity", e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="1000"
        inputMode="numeric"
      />

      <label htmlFor="grade-price-bps">Grade price schedule (basis points per grade, comma-separated)</label>
      <input
        id="grade-price-bps"
        value={fields.gradePriceBps}
        onChange={(e) => update("gradePriceBps", e.target.value.replace(/[^0-9,]/g, ""))}
        placeholder="10000"
        inputMode="numeric"
      />

      <label className="consent-checkbox">
        <input
          id="fx-conversion-checkbox"
          type="checkbox"
          checked={fields.fxConversionEnabled}
          onChange={(e) => toggleFxConversion(e.target.checked)}
        />
        <span>This deal needs FX conversion to stablecoin at settlement (optional) — leave unchecked for a plain deal.</span>
      </label>

      {fields.fxConversionEnabled && (
        <>
          <label htmlFor="oracle-contract">Reflector oracle contract address</label>
          <input
            id="oracle-contract"
            value={fields.oracleContract}
            onChange={(e) => update("oracleContract", e.target.value)}
            placeholder="C..."
            spellCheck={false}
          />

          <label htmlFor="price-asset">Price asset (e.g. NGN)</label>
          <input
            id="price-asset"
            value={fields.priceAsset}
            onChange={(e) => update("priceAsset", e.target.value)}
            placeholder="NGN"
            spellCheck={false}
          />

          <label htmlFor="oracle-max-age">Oracle max quote age (seconds)</label>
          <input
            id="oracle-max-age"
            value={fields.oracleMaxAgeSecs}
            onChange={(e) => update("oracleMaxAgeSecs", e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
          />

          <label htmlFor="denominated-amount">Deal value in price asset (smallest units)</label>
          <input
            id="denominated-amount"
            value={fields.denominatedAmount}
            onChange={(e) => update("denominatedAmount", e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="500000000"
            inputMode="numeric"
          />
          {/* Issue #8 / PRD §4.2. The live rate route is per-commitment
              (GET /commitments/:id/oracle-rate reads through the contract's
              own oracle config), so nothing can be quoted until it exists.
              Say where the estimate shows up and what kind of number it is,
              rather than leaving the buyer with no sense of FX exposure. */}
          <p className="fx-note" id="fx-exposure-note">
            You carry the FX risk on this deal: the conversion to the settlement token happens at settlement, at that
            day&apos;s rate. You top up any shortfall or get any excess refunded. Once the commitment is created, its page
            shows a live estimate range from the Reflector oracle.
          </p>
        </>
      )}

      <label className="consent-checkbox">
        <input
          id="roles-acknowledged-checkbox"
          type="checkbox"
          checked={fields.rolesAcknowledged}
          onChange={(e) => update("rolesAcknowledged", e.target.checked)}
        />
        <span>
          I've read{" "}
          {rolesUrl ? (
            <a href={rolesUrl} target="_blank" rel="noreferrer">
              Roles &amp; Responsibilities
            </a>
          ) : (
            "Roles & Responsibilities"
          )}
          , including that missing the remainder-payment deadline means an immediate,
          permanent bar.
        </span>
      </label>

      <button type="submit" disabled={submitting} aria-busy={submitting}>
        {submitting ? "Creating…" : "Create commitment"}
      </button>
    </form>
  );
}
