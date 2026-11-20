import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError, getCommitment, submitTx, buildTx } from "./api";

/**
 * These three apps each keep their own copy of api.ts rather than
 * sharing one package — a deliberate convention, not an oversight — so
 * the standing risk is the copies drifting apart silently as each app
 * evolves. `get`/`post`'s thrown message is the likeliest place for that
 * to happen unnoticed, and also the costliest: it is load-bearing, not
 * cosmetic. coop-pwa's `getAllocationLedger` decides whether "no
 * allocation recorded yet" is a normal empty state or a genuine failure
 * by pattern-matching `err.message`, and every app's UI puts this string
 * in front of a user verbatim. Change the shape in one copy and that
 * check quietly reclassifies an expected state as an error.
 *
 * This file is itself duplicated verbatim across the three apps, which
 * is the point: if one copy's formatting is edited, that app's suite
 * fails on its own rather than the three silently disagreeing.
 */

/** A non-ok fetch response — only the three fields `get`/`post` touch. */
function notOk(status: number, body: string): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as Response;
}

describe("api non-ok error formatting", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows only the API's `message` from the {statusCode, error, message} envelope", async () => {
    const body = '{"statusCode":400,"error":"Bad Request","message":"gradeIndex must be a non-negative integer"}';
    vi.mocked(fetch).mockResolvedValueOnce(notOk(400, body));

    const err = await getCommitment("CABC").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("gradeIndex must be a non-negative integer");
    // Debug detail stays on the object, out of the message.
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).path).toBe("/commitments/CABC");
    expect((err as ApiError).body).toBe(body);
  });

  it("falls back to `error` for the older bare {error} shape", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(notOk(404, '{"error":"commitment not found"}'));

    await expect(getCommitment("CABC")).rejects.toThrow(/^commitment not found$/);
  });

  it("falls back to the status text for a non-JSON body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ...notOk(502, "<html>bad gateway</html>"), statusText: "Bad Gateway" } as Response);

    await expect(submitTx("SIGNED_XDR")).rejects.toThrow(/^Bad Gateway$/);
  });

  it("reads Retry-After on a 429", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ...notOk(429, '{"statusCode":429,"error":"Too Many Requests","message":"Rate limit exceeded, retry in 12 seconds"}'),
      headers: new Headers({ "Retry-After": "12" }),
    } as Response);

    const err = (await getCommitment("CABC").catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe("Too many requests, try again in 12 s");
    expect(err.retryAfterSecs).toBe(12);
  });

  it("exposes the contract error code when the message carries one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      notOk(400, '{"statusCode":400,"error":"Bad Request","message":"simulation failed: HostError: Error(Contract, #23)"}'),
    );

    const err = (await getCommitment("CABC").catch((e: unknown) => e)) as ApiError;
    expect(err.contractError).toBe("Error(Contract, #23)");
  });

  it("leaves a network failure as a TypeError (coop-pwa's offline queue depends on it)", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
      const result = getCommitment("CABC").catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const err = await result;
      expect(err).toBeInstanceOf(TypeError);
      expect(err).not.toBeInstanceOf(ApiError);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** An ok fetch response — only the two fields a successful get/post touches. */
function ok(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

/**
 * Issue #197: get/post retry a transient network failure (fetch rejecting
 * — a dropped connection, not a server response) with bounded exponential
 * backoff, mirroring api/src/stellar/retry.ts. These are warehouse-app-only
 * (the other two apps' copies don't retry), which is why they live in this
 * file's own block rather than in the shared verbatim section above.
 *
 * The delays are real (500ms/1s at the defaults, not fake timers) —
 * deliberately, so the tests exercise the actual timer path a flaky
 * mobile connection would, not a mocked-out stand-in for it.
 */
describe("api transient-network retry", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("get recovers from one transient network failure without surfacing an error", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok({ status: "Draft" }));

    await expect(getCommitment("CABC")).resolves.toEqual({ status: "Draft" });
    expect(fetch).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("never retries submitTx: the first attempt may already have reached the API", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(submitTx("SIGNED_XDR")).rejects.toThrow("Failed to fetch");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still retries POSTs that only build unsigned XDR", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok({ xdr: "UNSIGNED" }));

    await expect(buildTx("CABC", "lock", "GKEY")).resolves.toEqual({ xdr: "UNSIGNED" });
    expect(fetch).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("still surfaces a persistent network failure as an error, after the bounded attempts", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getCommitment("CABC")).rejects.toThrow("Failed to fetch");
    expect(fetch).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("does not retry a real non-ok response — the server answered, so there's nothing transient to wait out", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(notOk(500, "boom"));

    await expect(getCommitment("CABC")).rejects.toThrow("Request failed (500)");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
