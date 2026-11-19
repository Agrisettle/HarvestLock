/**
 * Retries a flaky async operation with exponential backoff. Mirrors
 * api/src/stellar/retry.ts — same shape, same defaults — which exists
 * because of two real, observed transient Soroban RPC failures in this
 * project that both self-resolved on a bare retry (api/HANDOFF.md's
 * "Known testnet flakiness"). Copied rather than imported across the
 * frontend/backend boundary, same small-duplication convention as this
 * app's wallet.ts/api.ts copies.
 *
 * api.ts wraps only the `fetch` call itself in this. That placement is
 * the whole "retry a transient network error, never a real 4xx/5xx"
 * mechanism: `fetch` *rejects* on transport-level failures (a dropped
 * mobile connection, a DNS blip — the flaky-GET-poll case this was added
 * for) but *resolves* for every HTTP response, however bad the status.
 * Non-ok responses are handled and thrown as ordinary errors outside the
 * retry loop, so a server rejection is never replayed.
 *
 * Which calls may use it: GETs, and POSTs that explicitly opt in with
 * `{ retry: true }` in api.ts (building unsigned XDR is safe to replay).
 * A transport failure can happen after the request already reached the
 * API, so deploy, submit and propose/sign calls never retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
