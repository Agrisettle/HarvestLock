import { useEffect, useState } from "react";

const REFRESH_INTERVAL_MS = 60_000;
const STALE_AFTER_MS = 5 * 60_000;

type LiveStatus = {
  status: string;
  updatedAt: number;
  isStale: boolean;
};

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
export function useLiveStatus(contractId: string): LiveStatus | null {
  const [liveStatus, setLiveStatus] = useState<Omit<LiveStatus, "isStale"> | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl) return;

    let cancelled = false;
    setLiveStatus(null);

    const refresh = async () => {
      try {
        const res = await fetch(`${apiUrl}/commitments/${encodeURIComponent(contractId)}`);
        if (!res.ok) return;
        const data: { status?: string } = await res.json();
        if (!cancelled && typeof data.status === "string") {
          const updatedAt = Date.now();
          setLiveStatus({ status: data.status, updatedAt });
          setNow(updatedAt);
        }
      } catch {
        // Silent — preserve the last successful read and mark it stale by age.
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [contractId]);

  if (!liveStatus) return null;
  return { ...liveStatus, isStale: now - liveStatus.updatedAt >= STALE_AFTER_MS };
}
