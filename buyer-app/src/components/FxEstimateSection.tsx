import { useEffect, useState } from "react";
import type { CommitmentDetail, OracleConfig } from "../api";
import { getOracleConfig, getOracleRate } from "../api";
import { formatTokenAmount } from "../amount";
import { FX_ESTIMATE_BAND_BPS, fxEstimate } from "../fxEstimate";

/**
 * Statuses where no FX conversion will ever run: the deal ended without
 * reaching `resolve_fx_shortfall`. Showing a live estimate there would
 * imply a payment that isn't coming.
 */
const NO_SETTLEMENT_STATUSES = new Set(["Cancelled", "Defaulted", "Forfeited"]);

const quoteTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "estimate"; config: OracleConfig; price: bigint; timestamp: string }
  | { kind: "rate-unavailable"; config: OracleConfig; message: string }
  | { kind: "error"; message: string };

/**
 * PRD §4.2's "Reflector FX display as a range, labelled an estimate"
 * (issue #8). For an oracle-configured commitment, shows what the deal's
 * `denominated_amount` converts to in the settlement token at the live
 * Reflector rate, as a range (see fxEstimate.ts for the band and why).
 *
 * Renders nothing for a plain deal (`oracle-config` returns null). Once
 * `resolve_fx_shortfall` has run (`fx_resolved`), the real on-chain
 * figure replaces the estimate. At that point it isn't an estimate any
 * more, and no live read is made.
 *
 * Before delivery `settlement_bps` is still 0 on-chain, so the estimate
 * assumes full delivery at the top grade and says so. Once delivered, it
 * uses the real `settlement_bps`.
 */
export function FxEstimateSection({ commitment, contractId }: { commitment: CommitmentDetail; contractId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const skip = commitment.fx_resolved || NO_SETTLEMENT_STATUSES.has(commitment.status);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    setState({ kind: "loading" });
    getOracleConfig(contractId)
      .then(async ({ config }) => {
        if (!config) return { kind: "none" } as const;
        try {
          const rate = await getOracleRate(contractId);
          return { kind: "estimate", config, price: BigInt(rate.price), timestamp: rate.timestamp } as const;
        } catch (err) {
          return { kind: "rate-unavailable", config, message: err instanceof Error ? err.message : String(err) } as const;
        }
      })
      .catch((err: unknown) => ({ kind: "error", message: err instanceof Error ? err.message : String(err) }) as const)
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [contractId, skip]);

  if (commitment.fx_resolved) {
    const shortfall = BigInt(commitment.fx_shortfall_amount);
    return (
      <section className="fx-section" aria-labelledby="fx-heading">
        <h2 id="fx-heading">FX conversion</h2>
        <p className="fx-figure">
          Settled at the real rate: <strong>{formatTokenAmount(commitment.fx_adjusted_total)}</strong> in the settlement
          token.
        </p>
        {shortfall > 0n && (
          <p className="fx-note">
            FX shortfall to top up: {formatTokenAmount(shortfall)}
            {commitment.fx_shortfall_funded ? " (funded)." : "."}
          </p>
        )}
      </section>
    );
  }

  if (skip || state.kind === "none") return null;

  return (
    <section className="fx-section" aria-labelledby="fx-heading">
      <h2 id="fx-heading">FX estimate</h2>
      <div role="status" aria-live="polite">
        {state.kind === "loading" && <p className="fx-note">Reading the live oracle rate…</p>}
        {state.kind === "error" && <p className="fx-note">Couldn't check this commitment's FX setup: {state.message}</p>}
        {state.kind === "rate-unavailable" && (
          <p className="fx-note">
            Live {state.config.priceAsset} rate unavailable right now, so there's no estimate to show: {state.message}
          </p>
        )}
        {state.kind === "estimate" && <EstimateBody commitment={commitment} {...state} />}
      </div>
    </section>
  );
}

function EstimateBody({
  commitment,
  config,
  price,
  timestamp,
}: {
  commitment: CommitmentDetail;
  config: OracleConfig;
  price: bigint;
  timestamp: string;
}) {
  // settlement_bps is only meaningful once confirm_delivery has set it.
  // Before that it is 0 on-chain, which is "not known yet", not "nothing owed".
  const delivered = commitment.status === "Delivered";
  const { low, high } = fxEstimate(BigInt(config.denominatedAmount), price, {
    settlementBps: delivered ? commitment.settlement_bps : 10_000,
  });
  const quotedAt = quoteTimeFormatter.format(new Date(Number(timestamp) * 1000));
  const band = FX_ESTIMATE_BAND_BPS / 100;

  return (
    <>
      <p className="fx-figure">
        <strong>
          ≈ {formatTokenAmount(low)} – {formatTokenAmount(high)}
        </strong>{" "}
        in the settlement token, for {formatTokenAmount(config.denominatedAmount)} {config.priceAsset}
        {delivered ? " at the delivered quantity and grade" : ", assuming full delivery at the top grade"}.
      </p>
      <p className="fx-note">
        <strong>Estimate, not a quote.</strong> Based on the live Reflector {config.priceAsset} rate as of {quotedAt} UTC,
        ±{band}%. The real conversion happens at settlement at that day's rate. If it costs more than what's escrowed,
        you top up the difference; if less, you're refunded. The real rate can land outside this range.
      </p>
    </>
  );
}
