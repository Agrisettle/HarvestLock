# coop-pwa

HarvestLock's cooperative-facing dashboard. React + Vite + TypeScript.
Look up a commitment by contract ID, or pick one from the cached list, see
its status and advance-tranche claim windows straight from chain, and —
if a connected wallet matches the commitment's cooperative — claim an open
advance tranche. No auth, no offline support yet — deliberately deferred,
see below. Not a PWA yet either (no service worker/manifest) — that's tied
to the offline-queue work.

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

**Automated tests** (`npm test`, vitest + Testing Library, added 1 Sept
2026): `StatusBadge`, `CommitmentDetail`'s formatting logic (bps-to-
percentage, the deadline-0 special case, claim state), and `App`'s
fetch-mocked list/detail/error flows. Fetch is mocked at the network
boundary here — a different kind of mock than `api/`'s "no mocks"
testnet suite; the real integration is what the browser check above
already verified, these check this app's own rendering logic. Two real
environment issues found and fixed while setting this up: the default
vitest forks pool hangs on this machine (`pool: "threads"` in
`vitest.config.ts` fixes it), and Testing Library's automatic DOM
cleanup between tests needs vitest's global test APIs, which this
project doesn't use — needs an explicit `afterEach(cleanup)` instead
(`src/test-setup.ts`), found via a genuinely confusing failure (a count
assertion off by exactly 2x) before it was added.

**Claim-advance write action** (`src/wallet.ts`, `src/App.tsx`, added 2 Sept
2026): the app's first write. Build → Freighter signs → submit → refresh,
same shape every write in this project follows, now running client-side.
Freighter is explicitly a testnet/MVP stand-in, not the real auth model —
PRD §4.6 rules out seed-phrase wallets for cooperative users. **What's
verified and what isn't**: the API calls (build/submit) and the component
logic (button gating, error handling, the full flow with fetch and wallet
both mocked) are tested — 13 tests. What's **not** independently verified
in this session: signing against a real, installed Freighter extension —
this sandboxed environment has no way to install and drive a real browser
extension with a real funded account. A genuinely real finding *did* come
from a real browser, though: with no Freighter extension present at all
(the exact case a first-time visitor hits), `requestAccess()` neither
resolves nor rejects, it hangs forever — fixed with a timeout wrapper
around every Freighter call, see `wallet.ts`. Manual QA with a real
Freighter install is still a real gap before calling this fully proven.

**Deferred, per `TASKS.md`**:
- Phone-based auth (PRD §4.6) — needs the API's identity/session model decided first. Freighter is a stand-in, not this.
- Offline-tolerant queue for depot connectivity loss (PRD §7/§16.3).
- Allocation-ledger / per-member display — the API doesn't have this data yet either.

## A real testnet flakiness observed, not a bug — now handled

During testing, one `GET /commitments/:contractId` call failed with a
500 (`Account not found: G...` from the Stellar RPC) on an account that
had just transacted successfully seconds earlier — a transient Soroban
RPC inconsistency, not a code defect; a retry of the same request
succeeded normally. `api/`'s `simulateRead` now retries transient
failures automatically (`src/stellar/retry.ts`, added after a second,
different occurrence made this stop being speculative) — see
`api/HANDOFF.md`.
