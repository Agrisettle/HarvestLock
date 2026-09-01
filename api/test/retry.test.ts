import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/stellar/retry.js";

describe("withRetry", () => {
  it("returns the result on the first try if it succeeds", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure and succeeds if a later attempt works", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");
    const result = await withRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured number of attempts and throws the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still failing"));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow("still failing");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("defaults to 3 attempts when not specified", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
