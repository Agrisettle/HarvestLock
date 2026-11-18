# warehouse-app

HarvestLock's third frontend — the warehouse operator's console. Built 5
Sept 2026 to close a real, named gap: `mark_checkpoint` and
`confirm_delivery` are both warehouse-operator-gated in
`HarvestLock-Contracts/contracts/escrow/src/lib.rs`, and both have been
live-verified at the contract/API layer since early in this project, but
nothing in `buyer-app`/`coop-pwa` ever gave the warehouse operator a form
to call them from — they were reachable only via a direct API call.
`ROADMAP.md`'s testnet tranche named this explicitly as still open.

Same architecture and brand as `buyer-app`/`coop-pwa` — React + Vite +
TypeScript, `wallet.ts`/`api.ts`/`index.css`/`AddressChip.tsx` duplicated
rather than shared (matches this project's established convention for
these three apps; see `buyer-app/README.md`), Freighter for signing.

## Setup

Requires Node.js 24 (what CI uses — see
`.github/workflows/warehouse-app.yml`). `npm run dev` genuinely does
work on Node 20.19+ (vite 8's own floor; verified in a clean checkout),
and the repo root's `engines` range says `^20.19.0 || >=22.12.0` — but
`npm test` cannot run there: vitest 5 wants
`^22.12.0 || ^24.0.0 || >=26.0.0` and jsdom 30 wants
`^22.22.2 || ^24.15.0 || >=26.0.0`, so on Node 20 the test worker dies
loading undici before a single test runs (`no tests`, non-zero exit —
verified too). Install Node 24 and none of that matters.

```
npm ci
cp .env.example .env   # only needed if the API isn't on localhost:3000
npm run dev
```

Needs `api/` running and reachable at `VITE_API_URL` (defaults to
`http://localhost:3000`). On a fresh clone the bare
`cd ../api && npm run dev` is not enough — it fails with
`sh: 1: tsx: not found` until the API's own dependencies are installed.
The API's full
prerequisites live in [`../api/README.md`](../api/README.md)'s Setup
section; short version, from the repository root:

```
cd api
npm install
cp .env.example .env
npm run migrate   # needs PostgreSQL; api/README.md has a Docker one-liner
npm run dev
```

Then one more undocumented hop, and it fails *silently*: with
`CORS_ORIGINS` left empty (the `api/.env.example` default), the API
deliberately sends no CORS headers to any origin — so both servers can
be up, `curl http://localhost:3000/commitments` can return 200, and
every fetch from this app's browser tab is still blocked. Neither `curl`
nor this app's test suite enforces CORS, so nothing else tells you. Set
`CORS_ORIGINS=http://localhost:5173` in `api/.env` before starting the
API (restart it if it's already running), and add whatever origin Vite
actually binds to if 5173 was taken. Why CORS is opt-in at all:
[`../api/README.md`](../api/README.md)'s CORS section.

## What's real vs. deferred

**Real**: read-only lookup + list against the API (same shape as
`buyer-app`/`coop-pwa`'s), plus two write actions:

- **Mark mid-season checkpoint** — offered when a looked-up commitment is
  `Advance1Released`. Build → Freighter signs → submit → refresh, via the
  same generic no-arg `/tx/mark_checkpoint` route `buyer-app`/`coop-pwa`
  already use for their own lifecycle calls — nothing new needed on the
  API side for this one.
- **Confirm delivery** (`src/components/ConfirmDeliveryForm.tsx`) —
  offered when `ReadyForDelivery` *and* the buyer has funded the
  remainder (shown as a plain waiting note otherwise, not a disabled
  form with no explanation). Collects `deliveredQuantity` and a
  `gradeIndex` picked from the commitment's own pre-agreed
  `grade_price_bps` schedule, and calls the API's existing
  `POST /commitments/:contractId/tx/confirm-delivery` route (built in an
  earlier session for the PRD §7 shortfall/grade adjustment work, not new
  here). Once confirmed, `CommitmentDetail` shows the attested record
  (delivered quantity vs. contracted, grade, resulting settlement
  percentage) instead of the form.

25 component tests (fetch + wallet mocked, same conventions as
`buyer-app`/`coop-pwa`) cover both actions end to end, including the
"remainder not funded yet" waiting state and an error path for a
rejected signature. Same honesty note as every write action across these
three apps: no real, installed Freighter extension exists in this
environment, so actual on-extension signing hasn't been manually
verified — what's verified here is this app's own build/sign/submit
wiring against a mocked wallet. The two routes themselves
(`mark_checkpoint` since the original state machine, `confirm-delivery`
since the shortfall/grade work) were already live-verified against real
testnet in earlier sessions — see `api/HANDOFF.md` and
`HarvestLock-Contracts/HANDOFF.md` — so this app isn't re-proving routes
that were already proven, only the frontend wiring to them.

**A real gap this app's own `CommitmentDetail.tsx` surfaced while being
built**: `api/src/server.ts`'s `serializeCommitment` already returns
`contracted_quantity`,
`grade_price_bps`, `delivered_quantity`, `grade_index`, and
`settlement_bps` (they're just fields on the on-chain `Commitment`
struct, passed through by the existing `...c` spread), but
`buyer-app`/`coop-pwa`'s copies of the `CommitmentDetail` TypeScript
interface never had them added when those fields were added to the
contract. Not a runtime bug — those two apps just don't have any UI that
needs the fields — but a real type-accuracy gap worth fixing if either
app ever needs them. This app's own copy of the interface is complete.

**Stale note, corrected 4 Oct 2026**: this section used to say the
API's `initialize` route didn't yet accept `oracleConfig` and that no
commitment created through the API could have one set. Both parts are
now wrong, and left uncorrected would have actively misled the next
reader (this project's own stated rule — see the main repo's
`HANDOFF.md`): `initialize` has accepted `oracleConfig` since Deployment
8/9 (`api/HANDOFF.md`), and as of this session `buyer-app`'s
`CreateCommitmentForm.tsx` actually collects it at commitment-creation
time too — see `buyer-app/README.md`'s "Grade price schedule + FX/oracle
fields" entry. Still correctly not this app's job either way —
`mark_checkpoint`/`confirm_delivery` never touch oracle config.

## Accessibility assertions in component tests

`src/a11y.ts` exports `expectNoA11yViolations(container)`, which runs
axe-core against a rendered component. To cover a new component, take the
`container` from the existing `render(...)` in its test and end the test
with `await expectNoA11yViolations(container);` for each state that
matters (empty, error, pending, ready). `color-contrast` is disabled
because jsdom can't compute it; contrast stays a manual and Lighthouse
check (#145, #152).
