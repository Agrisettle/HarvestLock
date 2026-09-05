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

```
npm install
cp .env.example .env   # only needed if the API isn't on localhost:3000
npm run dev
```

Needs `api/` running (`cd ../api && npm run dev`) and reachable at
`VITE_API_URL` (defaults to `http://localhost:3000`).

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

**Deferred, and not this app's job to fix**: the API's `initialize`
route doesn't yet accept the oracle config `HarvestLock-Contracts`
gained in the same session (`oracleConfig: Option<OracleConfig>` — see
`HarvestLock-Contracts/HANDOFF.md`'s Deployment 8), and
`api/.env`'s `ESCROW_WASM_HASH` still points at Deployment 7's hash, not
Deployment 8's. Neither blocks this app — `mark_checkpoint`/
`confirm_delivery` don't touch oracle config at all — but it means no
commitment created through the API today can have one set. Tracked in
the main repo's `TASKS.md`, not silently left for someone to discover.
