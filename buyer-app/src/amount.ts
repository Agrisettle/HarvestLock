/** Stellar assets (USDC included) use 7 decimal places. */
export const TOKEN_DECIMALS = 7;

/**
 * Parses a decimal string ("1250.5") into integer base units using exact
 * string/BigInt arithmetic — never Number. Throws on empty, negative,
 * non-numeric, or more fractional digits than `decimals` allows.
 */
export function parseTokenAmount(input: string, decimals: number = TOKEN_DECIMALS): bigint {
  const text = input.trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new Error("Enter a plain positive number, e.g. 1250.50.");
  const whole = match[1];
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`At most ${decimals} decimal places are allowed.`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** Formats integer base units as a locale-aware decimal ("1,250.50"), exactly (BigInt, no float). Unparseable input is returned unchanged. */
export function formatTokenAmount(
  amount: bigint | string,
  decimals: number = TOKEN_DECIMALS,
  locale?: string,
): string {
  let value: bigint;
  try {
    value = BigInt(amount);
  } catch {
    return String(amount);
  }
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  let fraction = digits.slice(digits.length - decimals);
  // Show at least 2 fraction digits, trim trailing zeros beyond that.
  fraction = fraction.replace(/0+$/, "").padEnd(Math.min(2, decimals), "0");
  // Intl.NumberFormat accepts a decimal *string* exactly (ES2023 / Intl.NumberFormat v3).
  const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: fraction.length, maximumFractionDigits: fraction.length });
  const text = fraction ? `${whole}.${fraction}` : whole;
  const formatted = formatter.format(text as unknown as number);
  return negative ? `-${formatted}` : formatted;
}

export type DurationUnit = "days" | "hours";
const SECS_PER_UNIT: Record<DurationUnit, number> = { days: 86_400, hours: 3_600 };

/** Converts a whole-number amount of days/hours to seconds. Throws on anything but a non-negative whole number. */
export function durationToSecs(value: string, unit: DurationUnit): string {
  if (!/^\d+$/.test(value.trim())) throw new Error("Enter a whole number.");
  return (BigInt(value.trim()) * BigInt(SECS_PER_UNIT[unit])).toString();
}

/** Converts a percentage ("12.5") to basis points (1250). At most 2 decimal places. */
export function percentToBps(value: string): number {
  return Number(parseTokenAmount(value.trim() === "" ? "0" : value, 2));
}

/** Seconds → "7 days" / "36 hours" / raw seconds when not a whole number of hours. */
export function formatDuration(secs: string): string {
  let n: bigint;
  try {
    n = BigInt(secs);
  } catch {
    return `${secs}s`;
  }
  if (n > 0n && n % 86_400n === 0n) return `${n / 86_400n} ${n === 86_400n ? "day" : "days"}`;
  if (n > 0n && n % 3_600n === 0n) return `${n / 3_600n} ${n === 3_600n ? "hour" : "hours"}`;
  return `${secs}s`;
}
