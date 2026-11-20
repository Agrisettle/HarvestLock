import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PENDING_POLL, submitTx } from "./api";

/**
 * submitTx's handling of a 202 PENDING submit (issue #40, finding F1).
 * Kept apart from api.test.ts, which is duplicated verbatim across the
 * three apps on purpose, and this behaviour is buyer-app's only (for now).
 */

function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

const original = { ...PENDING_POLL };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  PENDING_POLL.intervalMs = 0;
  PENDING_POLL.attempts = 3;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(PENDING_POLL, original);
});

describe("submitTx", () => {
  it("returns a SUCCESS submit directly, without polling", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "SUCCESS", hash: "h1" }));

    await expect(submitTx("SIGNED")).resolves.toEqual({ status: "SUCCESS", hash: "h1" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("polls GET /transactions/:hash after a 202 PENDING until it reports SUCCESS", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ status: "PENDING", hash: "h2" }, 202))
      .mockResolvedValueOnce(json({ status: "PENDING", hash: "h2" }))
      .mockResolvedValueOnce(json({ status: "SUCCESS", hash: "h2" }));

    await expect(submitTx("SIGNED", "CCONTRACT")).resolves.toEqual({ status: "SUCCESS", hash: "h2" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenLastCalledWith("http://localhost:3000/transactions/h2");
  });

  it("throws if the polled transaction FAILED", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ status: "PENDING", hash: "h3" }, 202))
      .mockResolvedValueOnce(json({ status: "FAILED", hash: "h3" }));

    await expect(submitTx("SIGNED")).rejects.toThrow("Transaction h3 failed on-chain.");
  });

  it("throws a don't-resubmit message, naming the hash, if still unconfirmed when polling stops", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "PENDING", hash: "h4" }, 202));
    vi.mocked(fetch).mockResolvedValue(json({ status: "PENDING", hash: "h4" }));

    await expect(submitTx("SIGNED")).rejects.toThrow(/h4 was submitted but is not confirmed yet\. Don't submit it again/);
    expect(fetch).toHaveBeenCalledTimes(1 + PENDING_POLL.attempts);
  });
});
