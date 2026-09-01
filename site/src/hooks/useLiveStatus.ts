import { useEffect, useState } from "react";

/**
 * Live current status of a deployed commitment contract, read from the
 * `api/` service — real chain state, not a number baked in at build time
 * (TASKS.md's "once the API exists" item). Opt-in: if `VITE_API_URL`
 * isn't set, this never fetches and always returns `null`, so the public
 * site doesn't visibly break or show a stuck loading state when there's
 * no API deployed anywhere reachable to it, which is the common case
 * until this project has a real public API host. Any fetch failure
 * degrades the same way — silent, not an error banner on a marketing
 * page over what's ultimately a "nice to have."
 */
export function useLiveStatus(contractId: string): string | null {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl) return;

    let cancelled = false;
    fetch(`${apiUrl}/commitments/${encodeURIComponent(contractId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { status?: string }) => {
        if (!cancelled && typeof data.status === "string") setStatus(data.status);
      })
      .catch(() => {
        // Silent — see doc comment above.
      });

    return () => {
      cancelled = true;
    };
  }, [contractId]);

  return status;
}
