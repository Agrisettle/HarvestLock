import { API_URL, APP_ORIGINS, LIVE } from "./tests/helpers/env";

/**
 * Preflight for the whole live suite, run once when E2E_LIVE=1. Fails
 * fast with a specific, actionable message instead of letting three
 * specs each fail obscurely: an unreachable API, a Postgres outage the
 * API is honest about (its /health reports `database: "unavailable"`),
 * and a missing CORS origin are the three setup mistakes that otherwise
 * surface as an in-browser `Failed to fetch` with no explanation.
 */
export default async function globalSetup(): Promise<void> {
  if (!LIVE) return;

  const origin = APP_ORIGINS["buyer-app"];
  let res: Response;
  try {
    res = await fetch(`${API_URL}/health`, { headers: { origin } });
  } catch (err) {
    throw new Error(
      `E2E_LIVE=1 but the API at ${API_URL} is unreachable (${err instanceof Error ? err.message : String(err)}). ` +
        "Start Postgres and the API first, or point E2E_API_URL at where it's running — see e2e/README.md.",
    );
  }

  const health = (await res.json().catch(() => null)) as { checks?: { database?: string } } | null;
  if (!res.ok || health?.checks?.database !== "ok") {
    throw new Error(
      `The API at ${API_URL} is up but not healthy (HTTP ${res.status}, database: ${health?.checks?.database ?? "unknown"}). ` +
        "Check that Postgres is running and api/.env's DATABASE_URL points at it, then re-run migrations if needed — see e2e/README.md.",
    );
  }

  const allowedOrigin = res.headers.get("access-control-allow-origin");
  if (allowedOrigin !== origin) {
    throw new Error(
      `The API at ${API_URL} did not send an Access-Control-Allow-Origin header for ${origin} ` +
        `(got: ${allowedOrigin ?? "none"}). Set CORS_ORIGINS=${Object.values(APP_ORIGINS).join(",")} in api/.env and restart the API — ` +
        "the three dev servers run at " +
        `${Object.values(APP_ORIGINS).join(", ")} (an origin mismatch fails as a browser-side "Failed to fetch", not a clear server error).`,
    );
  }
}
