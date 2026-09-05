import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Same timeout fix as buyer-app/coop-pwa's wallet.test.ts -- see that
 * file's comment for the real-browser finding this guards against.
 * Trimmed to what this app's wallet.ts actually exports.
 */

vi.mock("@stellar/freighter-api", () => ({
  default: {
    requestAccess: vi.fn(),
    signTransaction: vi.fn(),
  },
}));

describe("wallet timeouts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

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
  // No "never settles" timeout test for signTransactionXdr, deliberately --
  // same reasoning as buyer-app/coop-pwa: its withTimeout window is 60s,
  // too slow to be worth a real unit test.
});
