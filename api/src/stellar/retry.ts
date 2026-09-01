/**
 * Retries a flaky async operation with exponential backoff. Exists because
 * of two real, observed Soroban RPC failures in this project, not
 * speculatively: a `getStatus` call that 500'd with "Account not found"
 * on an account that had transacted successfully seconds earlier
 * (api/HANDOFF.md's "Known testnet flakiness"), and a `getTransaction`
 * poll that hit a raw `fetch failed` mid-run while building cancel()'s
 * test coverage. Both self-resolved on a bare retry — this makes that
 * retry automatic instead of "re-run the script and hope."
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
