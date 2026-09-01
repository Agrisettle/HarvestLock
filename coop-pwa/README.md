# coop-pwa

HarvestLock's cooperative-facing dashboard. React + Vite + TypeScript.
**Read-only, for now** — look up a commitment by contract ID, or pick one
from the cached list, and see its status and advance-tranche claim windows
straight from chain. No write actions, no auth, no offline support yet —
all deliberately deferred, see below. Not a PWA yet either (no service
worker/manifest) — that's tied to the offline-queue work.

Note what this app is *not*, even once it's further along: individual
farmers never get an app. They get SMS (and eventually USSD) only — PRD
§13 (P3) and §16.1 (shared handsets) both rule out an app for that user.
This dashboard is for cooperative staff, not farmers.

## Setup

```
npm install
cp .env.example .env   # only needed if the API isn't on localhost:3000
npm run dev
```

Needs `api/` running (`cd ../api && npm run dev`) and reachable at
`VITE_API_URL` (defaults to `http://localhost:3000`).

## What's real vs. deferred

**Real**: the whole read path. `GET /commitments` (cached list) and
`GET /commitments/:contractId` (live chain read) from the API, rendered
as a list + detail view. Verified in a real browser (Playwright, used
once for this check and removed afterward — not a project dependency)
against the live API and live testnet data on 1 Sept 2026: a real cached
commitment rendered in the list, clicking it loaded live on-chain data
(buyer/cooperative/warehouse addresses, tranche bps, claim deadlines,
claimed/expired state) with zero console errors.

**A real bug that check caught**: the API had no CORS headers, so the
browser silently blocked every cross-origin fetch — invisible to `curl`
(which doesn't enforce CORS), only visible from an actual browser. Fixed
by adding `@fastify/cors` to `api/src/server.ts` (`origin: true` —
appropriate for now since there's no auth to protect; revisit if that
changes). This is exactly why "start the dev server and check it in a
browser" matters more than typecheck/build passing.

**Deferred, per `TASKS.md`**:
- Phone-based auth (PRD §4.6) — needs the API's identity/session model decided first.
- Claim-advance write actions.
- Offline-tolerant queue for depot connectivity loss (PRD §7/§16.3).
- Allocation-ledger / per-member display — the API doesn't have this data yet either.

## A real testnet flakiness observed, not a bug

During testing, one `GET /commitments/:contractId` call failed with a
500 (`Account not found: G...` from the Stellar RPC) on an account that
had just transacted successfully seconds earlier — a transient Soroban
RPC inconsistency, not a code defect; a retry of the same request
succeeded normally. Neither the API nor this app retries automatically
yet. If this becomes a recurring nuisance once there's real usage, add
retry-with-backoff to the API's `simulateRead` — don't add it
speculatively before there's evidence it's needed often enough to matter.
