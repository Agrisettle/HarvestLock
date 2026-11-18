import { describe, expect, it } from "vitest";
import { durationToSecs, formatDuration, formatTokenAmount, parseTokenAmount, percentToBps } from "./amount";

const I128_MAX = 170141183460469231731687303715884105727n;

describe("parseTokenAmount", () => {
  it("parses exactly", () => {
    expect(parseTokenAmount("1250.5", 7)).toBe(12505000000n);
    expect(parseTokenAmount("1")).toBe(10000000n);
    expect(parseTokenAmount("0.0000001")).toBe(1n);
    expect(parseTokenAmount("5.")).toBe(50000000n);
  });
  it("rejects more than 7 decimal places", () => {
    expect(() => parseTokenAmount("1.12345678")).toThrow(/decimal places/);
  });
  it("rejects negative, empty and junk input", () => {
    for (const bad of ["-1", "", "  ", ".5", "1e3", "abc", "1,000"]) {
      expect(() => parseTokenAmount(bad)).toThrow();
    }
  });
  it("is exact near the i128 max", () => {
    const text = formatPlain(I128_MAX);
    expect(parseTokenAmount(text)).toBe(I128_MAX);
  });
});

function formatPlain(v: bigint): string {
  const s = v.toString().padStart(8, "0");
  return `${s.slice(0, -7)}.${s.slice(-7)}`;
}

describe("formatTokenAmount", () => {
  it("formats with grouping and at least two decimals", () => {
    expect(formatTokenAmount(12505000000n, 7, "en-US")).toBe("1,250.50");
    expect(formatTokenAmount("10000000", 7, "en-US")).toBe("1.00");
    expect(formatTokenAmount(1n, 7, "en-US")).toBe("0.0000001");
  });
  it("respects the locale", () => {
    expect(formatTokenAmount(12505000000n, 7, "de-DE")).toBe("1.250,50");
  });
  it("round-trips with parseTokenAmount", () => {
    for (const v of [0n, 1n, 12505000000n, 999999999999n, I128_MAX]) {
      const text = formatTokenAmount(v, 7, "en-US").replaceAll(",", "");
      expect(parseTokenAmount(text)).toBe(v);
    }
  });
  it("is exact near the i128 max", () => {
    expect(formatTokenAmount(I128_MAX, 7, "en-US").replaceAll(",", "")).toBe(formatPlain(I128_MAX));
  });
  it("returns unparseable input unchanged", () => {
    expect(formatTokenAmount("not-a-number")).toBe("not-a-number");
  });
});

describe("durations and percentages", () => {
  it("converts days and hours to seconds", () => {
    expect(durationToSecs("7", "days")).toBe("604800");
    expect(durationToSecs("36", "hours")).toBe("129600");
    expect(() => durationToSecs("1.5", "days")).toThrow();
    expect(() => durationToSecs("", "days")).toThrow();
  });
  it("formats seconds back", () => {
    expect(formatDuration("604800")).toBe("7 days");
    expect(formatDuration("3600")).toBe("1 hour");
    expect(formatDuration("5400")).toBe("5400s");
  });
  it("converts percent to bps", () => {
    expect(percentToBps("15")).toBe(1500);
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("")).toBe(0);
    expect(() => percentToBps("12.555")).toThrow();
  });
});
