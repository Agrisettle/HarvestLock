import freighterApi from "@stellar/freighter-api";

/**
 * Freighter (browser extension wallet) integration — the write path's
 * signing mechanism for this MVP/testnet build only. This is NOT the
 * production auth model: PRD §4.6 rules out seed-phrase-based wallets for
 * cooperative users, and by extension the same principle applies broadly.
 * Freighter is here because proving the write path (build → sign →
 * submit) works end to end needs *some* real signer.
 *
 * Trimmed relative to buyer-app/coop-pwa's wallet.ts: this app has no
 * multi-party flow (mark_checkpoint and confirm_delivery are both
 * single-signer, warehouse-operator-only per lib.rs's require_auth), so
 * there's no signAuthEntry here — only what this app actually calls.
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
