import freighterApi from "@stellar/freighter-api";

/**
 * Freighter (browser extension wallet) integration — the write path's
 * signing mechanism for this MVP/testnet build only. This is NOT the
 * production auth model: PRD §4.6 rules out seed-phrase-based wallets for
 * cooperative users, and Freighter is exactly that. It's here because
 * proving the write path (build → sign → submit) works end to end needs
 * *some* real signer, and Freighter is the standard way to do that for a
 * Stellar dApp today. Don't mistake this for the real phone-auth flow —
 * see coop-pwa/README.md and api/HANDOFF.md's "Next steps."
 *
 * Testnet only — this app never builds a mainnet transaction, so the
 * passphrase isn't configurable. Matches @stellar/stellar-sdk's
 * `Networks.TESTNET` constant; not importing the SDK itself here to
 * avoid pulling its full bundle weight into this app for one string.
 */
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export interface FreighterError {
  message: string;
}

function throwIfError(error: FreighterError | undefined): void {
  if (error) {
    throw new Error(typeof error.message === "string" ? error.message : JSON.stringify(error));
  }
}

/**
 * Real finding, checked in a real browser with no Freighter extension
 * installed (the exact case a first-time visitor hits): `requestAccess()`
 * neither resolves nor rejects — it just hangs forever, with zero
 * feedback, silently. Not a crash, but worse than one: the user clicks
 * "Connect wallet" and nothing ever happens again. Every call into
 * freighter-api goes through this so a missing/unresponsive extension
 * fails fast with a clear message instead of hanging.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error("No response from Freighter — is the extension installed and unlocked?")),
        timeoutMs,
      ),
    ),
  ]);
}

/** Whether the Freighter extension is installed and reachable — not whether a wallet is connected yet. */
export async function isFreighterAvailable(): Promise<boolean> {
  try {
    const result = await withTimeout(freighterApi.isConnected(), 3000);
    return result.isConnected === true && !result.error;
  } catch {
    return false;
  }
}

/** Prompts the user to connect/select an account. Returns their public key (G...). */
export async function connectWallet(): Promise<string> {
  const result = await withTimeout(freighterApi.requestAccess(), 10_000);
  throwIfError(result.error);
  return result.address;
}

/** Signs a transaction XDR with whichever account the connected wallet holds for `address`. */
export async function signTransactionXdr(xdr: string, address: string): Promise<string> {
  const result = await withTimeout(
    freighterApi.signTransaction(xdr, { address, networkPassphrase: NETWORK_PASSPHRASE }),
    60_000, // a human reviewing/approving in the extension's own UI can reasonably take a while
  );
  throwIfError(result.error);
  return result.signedTxXdr;
}
