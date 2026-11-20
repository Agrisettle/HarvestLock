/**
 * PRD §4.2's must-have "Reflector FX display as a range, labelled an
 * estimate" (issue #8).
 *
 * The midpoint copies the contract's own `resolve_fx_shortfall` math
 * (HarvestLock-Contracts, contracts/escrow/src/lib.rs) so the estimate
 * and the real settlement figure come from the same formula:
 *
 *   owed       = denominated_amount * settlement_bps / 10_000
 *   fx_total   = owed * price / 10^decimals
 *
 * All integer (BigInt) arithmetic with truncating division, exactly as
 * the contract's i128 math does, so no float rounding creeps in.
 */

/**
 * Reflector's fiat-rate oracle reports prices with 14 decimals. The
 * contract reads this live from the oracle at settlement, but documents it
 * as immutable (write-once, and SEP-40 says it "should never change"; see
 * docs/reflector-decimals-assumption.md in the contracts repo). The API
 * doesn't expose it, so it's pinned here. If it ever changed, this
 * estimate would be off by a power of ten, and so would the contract's
 * conversion.
 */
export const REFLECTOR_DECIMALS = 14;

/**
 * Half-width of the displayed range, in basis points (500 = ±5%).
 *
 * This is a display choice, not a forecast. Nothing queryable today gives
 * a principled bound: the API exposes only the latest quote, not
 * Reflector's history. A fixed band is honest about that. It shows
 * movement is expected without pretending to know how much. ±5% is
 * roughly the size of a bad month for a managed emerging-market currency
 * against USD, so it reads as "this can move", not "this is a quote".
 * The real settlement rate can still land outside it, and the UI says so.
 */
export const FX_ESTIMATE_BAND_BPS = 500;

const BPS = 10_000n;

export interface FxEstimate {
  low: bigint;
  mid: bigint;
  high: bigint;
}

/**
 * Converts a commitment's `denominated_amount` (7-decimal units of the
 * price asset) into settlement-token units at `price`, then widens it to
 * a ±`bandBps` range. `settlementBps` defaults to full delivery at the
 * top grade (10_000), the right assumption before delivery is confirmed.
 */
export function fxEstimate(
  denominatedAmount: bigint,
  price: bigint,
  {
    settlementBps = 10_000,
    decimals = REFLECTOR_DECIMALS,
    bandBps = FX_ESTIMATE_BAND_BPS,
  }: { settlementBps?: number; decimals?: number; bandBps?: number } = {},
): FxEstimate {
  const owed = (denominatedAmount * BigInt(settlementBps)) / BPS;
  const mid = (owed * price) / 10n ** BigInt(decimals);
  return {
    low: (mid * (BPS - BigInt(bandBps))) / BPS,
    mid,
    high: (mid * (BPS + BigInt(bandBps))) / BPS,
  };
}
