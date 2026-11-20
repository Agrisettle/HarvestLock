import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Same timeout fix as buyer-app/coop-pwa's wallet.test.ts -- see that
 * file's comment for the real-browser finding this guards against.
 *
 * This app has no `isFreighterAvailable`, so it has no test for one;
 * everything else here is deliberately the same set of assertions as the
 * other two copies, because the three wallet.ts files are kept in sync
 * by hand and a missing test is how one of them drifts unnoticed.
 */

vi.mock("@stellar/freighter-api", () => ({
  default: {
    requestAccess: vi.fn(),
    signTransaction: vi.fn(),
    signAuthEntry: vi.fn(),
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

  it("signAuthEntry returns the signed entry XDR, not the whole-transaction shape", async () => {
    const freighterApi = (await import("@stellar/freighter-api")).default;
    vi.mocked(freighterApi.signAuthEntry).mockResolvedValue({
      signedAuthEntry: "SIGNED_ENTRY_XDR",
      signerAddress: "GABCDEF",
    });
    const { signAuthEntry } = await import("./wallet");

    await expect(signAuthEntry("ENTRY_XDR", "GABCDEF")).resolves.toBe("SIGNED_ENTRY_XDR");
    expect(freighterApi.signAuthEntry).toHaveBeenCalledWith("ENTRY_XDR", {
      address: "GABCDEF",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });
  // No "never settles" timeout test for signTransactionXdr or
  // signAuthEntry, deliberately -- same reasoning as buyer-app/coop-pwa:
  // their withTimeout windows are 60s, too slow to be worth a real unit
  // test. connectWallet gets one because its window is 10s.
});
