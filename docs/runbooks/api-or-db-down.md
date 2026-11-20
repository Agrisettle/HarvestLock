# Runbook: API or Postgres Unreachable

Use this when a HarvestLock API request times out, returns `5xx`, or the API
health check reports a database problem. The hosted API runs on Render and its
Postgres database is an external Neon project; both are needed for normal
operation.

## What users may see

- If the API process is reachable but Postgres is not, `GET /health` returns
  HTTP `503` with `{"ok":false,"checks":{"api":"ok","database":"unavailable"}}`.
- If the API host itself is down or unreachable, `/health` cannot return a
  response. Check the Render service before treating this as a database-only
  incident.
- `GET /commitments` reads the Postgres cache directly and fails while the
  database is unavailable. The live `GET /commitments/:contractId` chain read
  can still return commitment data; a failed cache update is logged and does
  not replace that response with an error.
- A signed transaction is submitted to Stellar before its optional cache
  refresh. A Postgres failure during that refresh is logged as a warning and
  does not turn a successful on-chain submission into an API failure. Do not
  submit the same transaction again just because a cache or UI refresh failed.
- Other database-backed features, including proposal coordination and party
  standing, may be unavailable until Postgres recovers. The chain remains the
  source of truth for commitment state.

## Confirm the cause

1. Check the API response:

   ```sh
   curl -i "$API_URL/health"
   ```

   `200` with both checks `ok` means the API and its database probe are
   currently reachable. `503` with `database: unavailable` points to the
   database connection. A timeout, DNS error, or connection refusal means the
   API host may not be reachable.

2. Open the Render dashboard and inspect the `harvestlock-api` service for its
   current deploy, restart history, and recent logs. Look for the health-check
   error `health check could not reach Postgres` and connection or
   authentication errors. Do not paste `DATABASE_URL` into chat, an issue, or
   a public log.

3. Check the Neon project status and connection limits. Confirm the configured
   `DATABASE_URL` in Render still points to the intended Neon database and
   includes the provider's required SSL settings. Never replace it with a
   staging or local database URL during an incident.

4. If the health response is green but a user action still fails, capture the
   request path, UTC time, response status, and request ID if present. Inspect
   the Render logs for that request; the failure may be Stellar RPC or a
   particular route rather than Postgres.

## Restore service

1. If Render shows the API process stopped or a failed deployment, inspect the
   deploy logs first. Roll back only when the failure began with that deploy
   and the previous deployment is known healthy. Do not change database
   settings to compensate for an API build problem.

2. If Neon is paused, unavailable, at its connection limit, or reports a
   provider incident, restore it in Neon or follow the provider's recovery
   guidance. If the Render connection string is wrong, correct it in the
   Render dashboard without exposing its value, then restart/redeploy the API
   so the process reconnects.

3. Recheck `GET /health` until it returns HTTP `200` with both checks `ok`.
   Then verify `GET /commitments` returns a JSON array. Check a known
   commitment through `GET /commitments/:contractId` if a user reports stale
   data; that endpoint reads live chain state and refreshes its cache on a
   best-effort basis.

4. Tell affected users when service is restored. If a transaction was involved,
   verify its on-chain result before asking anyone to build, sign, or submit a
   replacement transaction.

## After recovery

The API has no background cache refresher. A list row can remain stale until a
successful live commitment read or an API submission refreshes it. Check the
relevant commitment directly if its cached list status matters. Record the
incident time, user-visible symptoms, Render/Neon evidence, and recovery action
in the normal operations channel so connection-limit or deploy regressions are
visible before the next outage.