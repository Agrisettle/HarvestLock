import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Real finding, checked in an actual browser with no Freighter extension
 * installed: freighter-api's promises neither resolve nor reject in that
 * case — they hang forever, silently. These tests lock in the fix
 * (withTimeout, internal to wallet.ts) using a mocked freighter-api that
 * never settles, the same shape as the real failure.
 */

vi.mock("@stellar/freighter-api", () => ({
  default: {
    isConnected: vi.fn(),
    requestAccess: vi.fn(),
    signTransaction: vi.fn(),
  },
}));

describe("wallet timeouts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("isFreighterAvailable resolves false, not hangs, when isConnected never settles", async () => {
    const freighterApi = (await import("@stellar/freighter-api")).default;
    vi.mocked(freighterApi.isConnected).mockReturnValue(new Promise(() => {})); // never settles, like the real failure
    const { isFreighterAvailable } = await import("./wallet");

    const result = await isFreighterAvailable();
    expect(result).toBe(false);
  }, 5000);

  it("connectWallet rejects with a clear message, not hangs, when requestAccess never settles", async () => {
    const freighterApi = (await import("@stellar/freighter-api")).default;
    vi.mocked(freighterApi.requestAccess).mockReturnValue(new Promise(() => {}));
    const { connectWallet } = await import("./wallet");

    await expect(connectWallet()).rejects.toThrow(/No response from Freighter/);
  }, 15_000);

  it("connectWallet resolves normally when Freighter responds quickly", async () => {
    const freighterApi = (await import("@stellar/freighter-api")).default;
    vi.mocked(freighterApi.requestAccess).mockResolvedValue({ address: "GABCDEF" });
    const { connectWallet } = await import("./wallet");

    await expect(connectWallet()).resolves.toBe("GABCDEF");
  });
});
