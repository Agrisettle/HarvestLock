import { Keypair, TransactionBuilder, authorizeEntry, inspectAuthEntry, xdr } from "@stellar/stellar-sdk";
import type { Page } from "@playwright/test";
import { NETWORK_PASSPHRASE } from "./env";

/**
 * A stand-in for the Freighter browser extension, injected directly into
 * the page — this is the "throwaway testnet keypair instead of a real
 * Freighter popup" mechanism these smoke tests were asked for. No real
 * extension is installed (and never has been in this environment); the
 * apps' wallet.ts talks to Freighter entirely through
 * `window.postMessage`, which is exactly what this stubs, so the app's
 * own wallet.ts code path is what actually runs — only the extension
 * behind the channel is replaced.
 *
 * The wire protocol (verified against @stellar/freighter-api@6.0.1's
 * bundled source, not its docs): a request is a window message shaped
 * `{ source: "FREIGHTER_EXTERNAL_MSG_REQUEST", messageId, type, ... }`;
 * the response must be `{ source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
 * messagedId: messageId, ... }` — note the library's own `messagedId`
 * spelling; a response with a correctly-spelled `messageId` is silently
 * ignored and the call hangs until wallet.ts's own timeout.
 *
 * The heavy lifting (XDR parsing + signing) happens Node-side, via
 * page.exposeFunction, using the same @stellar/stellar-sdk the API and
 * its tests use — so the page never needs the SDK or a private key
 * itself, only the signed result. `signAuthEntry` mirrors
 * api/test/helpers.ts's `simulateFreighterSignAuthEntry`: it signs each
 * entry with whatever `signatureExpirationLedger` the entry already
 * embeds (Freighter's real call takes no expiration parameter either).
 *
 * Two QA hooks beyond the original happy-path stub:
 * - `setInjectedSigningRejected(page, true)` answers signing requests
 *   with the library's own declined error (`code: -4`), so a test can
 *   drive the exact reject-then-retry sequence a human would.
 * - `connectInjectedWallet` returns the live list of signing requests
 *   the page made, which lets a test prove an action never opened a
 *   wallet popup at all (e.g. the multi-party `propose` routes).
 */

declare global {
  interface Window {
    __harvestlockE2eFreighter: (request: unknown) => Promise<Record<string, unknown>>;
    /** Set by `setInjectedSigningRejected`; the message listener refuses signing requests while true. */
    __harvestlockE2eRejectSigning?: boolean;
  }
}

/** What a real Freighter extension returns when the user clicks reject (see `FreighterApiDeclinedError` in @stellar/freighter-api). */
const DECLINED_ERROR = { code: -4, message: "The user rejected this request." };

export interface InjectedWalletHandle {
  /**
   * Every signing request the page has actually sent so far
   * (`SUBMIT_TRANSACTION` / `SUBMIT_AUTH_ENTRY`). Lets a test prove an
   * action never invoked the wallet at all — e.g. the multi-party
   * `propose` routes stage auth entries server-side and show no popup.
   */
  signRequests: string[];
}

interface FreighterRequest {
  type?: string;
  messageId?: number;
  transactionXdr?: string;
  entryXdr?: string;
  networkPassphrase?: string;
}

export async function connectInjectedWallet(page: Page, signer: Keypair): Promise<InjectedWalletHandle> {
  const publicKey = signer.publicKey();
  const signRequests: string[] = [];

  await page.exposeFunction("__harvestlockE2eFreighter", async (raw: unknown) => {
    const request = (raw ?? {}) as FreighterRequest;
    switch (request.type) {
      case "REQUEST_ACCESS":
      case "REQUEST_PUBLIC_KEY":
        // The external API reads `publicKey` off the response for both.
        return { publicKey };
      case "REQUEST_CONNECTION_STATUS":
        return { isConnected: true };
      case "REQUEST_ALLOWED_STATUS":
        // @stellar/freighter-api's signAuthEntry asks this first; a real
        // extension answers true after requestAccess has been granted.
        return { isAllowed: true };
      case "REQUEST_NETWORK":
      case "REQUEST_NETWORK_DETAILS":
        return {
          network: "TESTNET",
          networkDetails: { network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASE, networkUrl: "", sorobanRpcUrl: "" },
        };
      case "SUBMIT_TRANSACTION": {
        signRequests.push("SUBMIT_TRANSACTION");
        if (!request.transactionXdr) throw new Error("SUBMIT_TRANSACTION without transactionXdr");
        const tx = TransactionBuilder.fromXDR(request.transactionXdr, request.networkPassphrase ?? NETWORK_PASSPHRASE);
        tx.sign(signer);
        return { signedTransaction: tx.toXDR(), signerAddress: publicKey };
      }
      case "SUBMIT_AUTH_ENTRY": {
        signRequests.push("SUBMIT_AUTH_ENTRY");
        if (!request.entryXdr) throw new Error("SUBMIT_AUTH_ENTRY without entryXdr");
        const entry = xdr.SorobanAuthorizationEntry.fromXDR(request.entryXdr, "base64");
        const info = inspectAuthEntry(entry);
        if (info.signatureExpirationLedger === null) {
          throw new Error("auth entry has no address credentials to sign");
        }
        const signed = await authorizeEntry(
          entry,
          signer,
          info.signatureExpirationLedger,
          request.networkPassphrase ?? NETWORK_PASSPHRASE,
        );
        return { signedAuthEntry: signed.toXDR("base64"), signerAddress: publicKey };
      }
      default:
        throw new Error(`injected Freighter stub does not implement request type ${request.type ?? "(missing)"}`);
    }
  });

  // addInitScript runs before any page script on every navigation, so the
  // listener is in place before the app bundle can call postMessage.
  await page.addInitScript((declined: { code: number; message: string }) => {
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return;
      const request = event.data as { source?: string; messageId?: number; type?: string } | null;
      if (!request || request.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;

      // The test-controlled "user clicked reject in the extension" path:
      // answer exactly as the real extension's declined response would,
      // without asking the Node-side signer for a signature.
      if (
        window.__harvestlockE2eRejectSigning &&
        (request.type === "SUBMIT_TRANSACTION" || request.type === "SUBMIT_AUTH_ENTRY")
      ) {
        window.postMessage(
          {
            source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
            messagedId: request.messageId,
            apiError: declined,
          },
          window.location.origin,
        );
        return;
      }

      void (async () => {
        let response: Record<string, unknown>;
        try {
          response = await window.__harvestlockE2eFreighter(request);
        } catch (err) {
          response = { apiError: { code: -1, message: err instanceof Error ? err.message : String(err) } };
        }
        window.postMessage(
          // `messagedId` is the library's own field name — see the file doc.
          { source: "FREIGHTER_EXTERNAL_MSG_RESPONSE", messagedId: request.messageId, ...response },
          window.location.origin,
        );
      })();
    });
  }, DECLINED_ERROR);

  return { signRequests };
}

/**
 * Toggles the injected extension's "user rejects the next signing
 * request" behavior. Off by default. Reset it to false to let a retry
 * sign normally — the same reject-then-approve sequence a manual QA pass
 * exercises against a real popup.
 */
export async function setInjectedSigningRejected(page: Page, rejected: boolean): Promise<void> {
  await page.evaluate((flag) => {
    window.__harvestlockE2eRejectSigning = flag;
  }, rejected);
}
