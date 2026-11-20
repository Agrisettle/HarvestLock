import { describe, it, expect } from "vitest";
import { fxEstimate, FX_ESTIMATE_BAND_BPS } from "./fxEstimate";

describe("fxEstimate", () => {
  // The worked example from the contract's own resolve_fx_shortfall doc
  // comment: ₦1,000,000 at Reflector price 66_700_000_000 (decimals 14)
  // is 667 USDC, i.e. 6_670_000_000 at 7 decimals.
  it("matches the contract's worked example at the midpoint", () => {
    const { mid } = fxEstimate(10_000_000_000_000n, 66_700_000_000n);
    expect(mid).toBe(6_670_000_000n);
  });

  it("widens the midpoint by ±5% by default", () => {
    expect(FX_ESTIMATE_BAND_BPS).toBe(500);
    const { low, high } = fxEstimate(10_000_000_000_000n, 66_700_000_000n);
    expect(low).toBe(6_336_500_000n);
    expect(high).toBe(7_003_500_000n);
  });

  it("applies settlement_bps before converting, same order as the contract", () => {
    const { mid } = fxEstimate(10_000_000_000_000n, 66_700_000_000n, { settlementBps: 9_000 });
    expect(mid).toBe(6_003_000_000n);
  });

  it("truncates like the contract's integer division, never rounds up", () => {
    const { mid } = fxEstimate(3n, 1n, { decimals: 0, settlementBps: 3_333 });
    // 3 * 3333 / 10000 = 0.9999 -> 0
    expect(mid).toBe(0n);
  });

  it("accepts a custom band", () => {
    const { low, mid, high } = fxEstimate(10_000_000n, 100_000_000_000_000n, { bandBps: 1_000 });
    expect(mid).toBe(10_000_000n);
    expect(low).toBe(9_000_000n);
    expect(high).toBe(11_000_000n);
  });
});
