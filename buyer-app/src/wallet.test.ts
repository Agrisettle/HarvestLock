import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Same tests as coop-pwa's wallet.test.ts, locking in the same timeout
 * fix for this app's copy of wallet.ts — see that file's comment for the
 * real-browser finding this guards against.
 */

vi.mock("@stellar/freighter-api", () => ({
  default: {
    isConnected: vi.fn(),
    requestAccess: vi.fn(),
    signTransaction: vi.fn(),
    signAuthEntry: vi.fn(),
  },
}));

describe("wallet timeouts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("isFreighterAvailable resolves false, not hangs, when isConnected never settles", async () => {
    const freighterApi = (await import("@stellar/freighter-api")).default;
    vi.mocked(freighterApi.isConnected).mockReturnValue(new Promise(() => {}));
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
  // No "never settles" timeout test here, deliberately -- signAuthEntry's
  // withTimeout window is 60s, same as signTransactionXdr's (also
  // untested for this reason): too slow to be worth a real unit test.
  // isFreighterAvailable/connectWallet get theirs because their windows
  // are 3s/10s, cheap enough to actually wait out.
});
