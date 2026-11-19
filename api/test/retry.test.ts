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

  it("exhausts every attempt and surfaces the last real error, not an earlier one", async () => {
    // Distinct error objects, not three throws of the same message: the
    // exhaustion path must rethrow the *last* failure by identity, not
    // just any error that happens to share its text.
    const errors = [new Error("attempt 1"), new Error("attempt 2"), new Error("attempt 3")];
    const fn = vi.fn();
    for (const err of errors) fn.mockRejectedValueOnce(err);

    const attempts = errors.length;
    await expect(withRetry(fn, { attempts, baseDelayMs: 1 })).rejects.toBe(errors.at(-1));

    // Exactly the configured count: no extra attempt after the loop, and
    // no early give-up before the final one.
    expect(fn).toHaveBeenCalledTimes(attempts);
  });

  it("attempts: 1 makes exactly one call and surfaces that error (the lower boundary)", async () => {
    const onlyError = new Error("only attempt");
    const fn = vi.fn().mockRejectedValue(onlyError);

    await expect(withRetry(fn, { attempts: 1, baseDelayMs: 1 })).rejects.toBe(onlyError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("defaults to 3 attempts when not specified", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
