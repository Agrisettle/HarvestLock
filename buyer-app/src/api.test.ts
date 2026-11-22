import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCommitment, submitTx, buildTx, deployCommitment, getTransactionStatus, waitForTransaction, assertSubmitted } from "./api";

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

  it("get throws `path -> status: body`", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(notOk(404, '{"error":"commitment not found"}'));

    await expect(getCommitment("CABC")).rejects.toThrow(
      '/commitments/CABC -> 404: {"error":"commitment not found"}',
    );
  });

  it("post throws `path -> status: body`, the same shape as get", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(notOk(400, "tx_bad_seq"));

    await expect(submitTx("SIGNED_XDR")).rejects.toThrow("/transactions/submit -> 400: tx_bad_seq");
  });

  it("reports the encoded path, not the raw argument", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(notOk(500, "boom"));

    // Both the thrown message and the URL fetched use the encoded form,
    // so an operator reading the error sees the path actually requested.
    await expect(getCommitment("C/../x")).rejects.toThrow("/commitments/C%2F..%2Fx -> 500: boom");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/commitments/C%2F..%2Fx");
  });

  it("includes an empty body as an empty tail rather than omitting the separator", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(notOk(502, ""));

    await expect(getCommitment("CABC")).rejects.toThrow("/commitments/CABC -> 502: ");
  });
});

/** An ok fetch response — only the two fields a successful get/post touches. */
function ok(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

/**
 * Issue #195: get/post retry a transient network failure (fetch rejecting
 * — a dropped connection, not a server response) with bounded exponential
 * backoff, mirroring api/src/stellar/retry.ts. The helper itself has its
 * own suite in retry.test.ts; these pin the placement, i.e. that the
 * retry wraps the fetch call and not the response handling.
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

  it("never retries /commitments/deploy: a replay would deploy a second, orphaned contract", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(deployCommitment()).rejects.toThrow("Failed to fetch");
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

    await expect(getCommitment("CABC")).rejects.toThrow("/commitments/CABC -> 500: boom");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

/** Finalize can answer 202 while the Soroban RPC confirmation is still in
 * flight; the UI follows the hash before declaring the dispute resolved. */
describe("pending transaction follow-up", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the hash through GET /transactions/:hash", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ status: "SUCCESS", hash: "abc123" }));

    await expect(getTransactionStatus("abc123")).resolves.toEqual({ status: "SUCCESS", hash: "abc123" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/transactions/abc123");
  });

  it("polls PENDING until the chain reports SUCCESS", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ok({ status: "PENDING", hash: "abc123" }))
      .mockResolvedValueOnce(ok({ status: "SUCCESS", hash: "abc123" }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(waitForTransaction("abc123", { attempts: 5, intervalMs: 50, sleep })).resolves.toEqual({
      status: "SUCCESS",
      hash: "abc123",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up with an actionable message when the hash never settles", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ status: "PENDING", hash: "abc123" }));

    await expect(waitForTransaction("abc123", { attempts: 3, intervalMs: 0, sleep: vi.fn() })).rejects.toThrow(
      /still pending/,
    );
    expect(() => assertSubmitted({ status: "PENDING", hash: "abc123" })).toThrow("still pending");
  });
});
