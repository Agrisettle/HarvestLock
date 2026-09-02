import freighterApi from "@stellar/freighter-api";

/**
 * Freighter (browser extension wallet) integration — the write path's
 * signing mechanism for this MVP/testnet build only. This is NOT the
 * production auth model: PRD §4.6 rules out seed-phrase-based wallets for
 * cooperative users, and by extension the same principle applies broadly.
 * Freighter is here because proving the write path (build → sign →
 * submit) works end to end needs *some* real signer.
 *
 * Identical to coop-pwa's wallet.ts, including the timeout fix below —
 * that was found once, in coop-pwa, via a real browser with no Freighter
 * extension installed: requestAccess() neither resolves nor rejects, it
 * hangs forever. Applied here from the start rather than re-discovering
 * it, since the two apps share the same underlying freighter-api.
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

/**
 * Signs a single Soroban authorization entry — NOT a whole transaction.
 * Used for the staged multi-party `cancel` flow (api/HANDOFF.md): when
 * someone other than the proposer approves a pending cancellation, they
 * sign only their own auth entry, not an envelope — the proposer's
 * classic signature (via `signTransactionXdr` above) is what finalizes
 * things later. `signTransaction` would be the wrong call here — it adds
 * a classic envelope signature, which isn't what a non-source party's
 * `require_auth()` needs.
 */
export async function signAuthEntry(entryXdr: string, address: string): Promise<string> {
  const result = await withTimeout(
    freighterApi.signAuthEntry(entryXdr, { address, networkPassphrase: NETWORK_PASSPHRASE }),
    60_000, // same reasoning as signTransactionXdr's timeout
  );
  throwIfError(result.error);
  if (!result.signedAuthEntry) {
    throw new Error("Freighter returned no signed auth entry");
  }
  return result.signedAuthEntry;
}
