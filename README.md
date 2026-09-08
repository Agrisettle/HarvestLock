<div align="center">

```
██╗  ██╗ █████╗ ██████╗ ██╗   ██╗███████╗███████╗████████╗██╗      ██████╗  ██████╗██╗  ██╗
██║  ██║██╔══██╗██╔══██╗██║   ██║██╔════╝██╔════╝╚══██╔══╝██║     ██╔═══██╗██╔════╝██║ ██╔╝
███████║███████║██████╔╝██║   ██║█████╗  ███████╗   ██║   ██║     ██║   ██║██║     █████╔╝
██╔══██║██╔══██║██╔══██╗╚██╗ ██╔╝██╔══╝  ╚════██║   ██║   ██║     ██║   ██║██║     ██╔═██╗
██║  ██║██║  ██║██║  ██║ ╚████╔╝ ███████╗███████║   ██║   ███████╗╚██████╔╝╚██████╗██║  ██╗
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚══════╝   ╚═╝   ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝
```

**Pre-harvest commodity forward commitments on Stellar**

[![api](https://github.com/Agrisettle/HarvestLock/actions/workflows/api.yml/badge.svg)](https://github.com/Agrisettle/HarvestLock/actions/workflows/api.yml)
[![buyer-app](https://github.com/Agrisettle/HarvestLock/actions/workflows/buyer-app.yml/badge.svg)](https://github.com/Agrisettle/HarvestLock/actions/workflows/buyer-app.yml)
[![coop-pwa](https://github.com/Agrisettle/HarvestLock/actions/workflows/coop-pwa.yml/badge.svg)](https://github.com/Agrisettle/HarvestLock/actions/workflows/coop-pwa.yml)
[![warehouse-app](https://github.com/Agrisettle/HarvestLock/actions/workflows/warehouse-app.yml/badge.svg)](https://github.com/Agrisettle/HarvestLock/actions/workflows/warehouse-app.yml)
[![site](https://github.com/Agrisettle/HarvestLock/actions/workflows/site.yml/badge.svg)](https://github.com/Agrisettle/HarvestLock/actions/workflows/site.yml)
[![gh-pages](https://github.com/Agrisettle/HarvestLock/actions/workflows/gh-pages.yml/badge.svg)](https://github.com/Agrisettle/HarvestLock/actions/workflows/gh-pages.yml)
[![contracts](https://github.com/Agrisettle/HarvestLock-Contracts/actions/workflows/test.yml/badge.svg)](https://github.com/Agrisettle/HarvestLock-Contracts/actions/workflows/test.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

[**Live Preview**](https://agrisettle.github.io/HarvestLock/) &nbsp;·&nbsp; [**PRD**](./docs/PRD.md) &nbsp;·&nbsp; [**Roadmap**](./ROADMAP.md)

</div>

---

A cooperative and a buyer agree price and quantity before harvest; the buyer's
deposit sits in a Soroban escrow and releases against an independent warehouse
operator's grading receipt, not against either party's say-so. A capped,
tranched advance reaches the cooperative before harvest. Each member farmer's
share is recorded on chain at lock-in.

> The live preview above has no API behind it yet — it's a UI-only build. See
> [Deployment](#deployment) for what's real and what's still pending.

## Status: pre-pilot, work in progress

**This is not production software and shouldn't be treated as such.**
No cooperative or buyer has actually used HarvestLock yet — there's no
pilot partner signed, no mainnet deployment, no real money has ever
moved through any of this. Everything described below is real, tested,
and verified against live Stellar *testnet*, which is a meaningfully
different claim from "ready for real users." The Open Questions in the
PRD (§12) are what has to be resolved with an actual counterparty
before that changes, regardless of how much gets built in the
meantime. Treat every "done" below as "done for testnet," not "done."

With that framing — what's actually real, not just specified:

- **Contract** (`HarvestLock-Contracts`): the full state machine —
  happy path, claimable-balance-with-expiry advance tranches, mutual
  cancellation, buyer-position assignability, two-phase funding with
  buyer-default/seller-non-delivery forfeiture, PRD §7 shortfall/grade
  adjustment at settlement, PRD §4.8/§16.1's allocation ledger, PRD
  §4.2/§16.3's oracle-based FX settlement, and PRD's must-have dispute
  flagging with defined escalation. 120/120 tests, deployed and
  exercised live on testnet ten times.
- **`api/`**: the full lifecycle (deploy through settle, including
  `cancel`/`reassign_buyer`/`resolve_dispute`'s multi-party staged
  signing) builds and submits against live testnet, not mocked.
  Off-chain reputation/strike tracking backs the buyer-default and
  forfeiture paths.
- **`coop-pwa`/`buyer-app`/`warehouse-app`**: real write actions (lock,
  settle, claim advances, propose/approve cancel/reassign/dispute
  resolution, mark checkpoints, confirm delivery) against the live API
  via Freighter, browser-verified — not just read-only dashboards.
- **`site/`**: built, public, includes a live badge reading the
  reference contract's real current state.

See `HANDOFF.md` for the honest current-state breakdown (what's real
vs. deliberately deferred, per component) and `ROADMAP.md` for what
happens next and in what order.

## Repositories

The Soroban contract lives in its own repo — separate audit trail and release
cadence from application code. This repo is everything else.

| Repo | Contents |
|---|---|
| [`HarvestLock-Contracts`](https://github.com/Agrisettle/HarvestLock-Contracts) | Soroban escrow contract (Rust) — the state machine in PRD §4.8 |
| [`HarvestLock`](https://github.com/Agrisettle/HarvestLock) *(this repo)* | Public site, API, all three product frontends, docs, roadmap |

## Repository layout

```
site/            Public site (React/Vite) — the project's public face, not a logged-in product surface
api/             HarvestLock API (TypeScript/Node, Fastify) — contract lifecycle is real today; vouchers/SDP payouts are planned, not built (see api/HANDOFF.md)
coop-pwa/        Cooperative-facing dashboard (React/Vite) — real write actions against live testnet; phone-auth and offline-tolerance still ahead
buyer-app/       Buyer/off-taker dashboard (React/Vite) — real write actions against live testnet; ERP integration still ahead
warehouse-app/   Warehouse-operator console (React/Vite) — mark checkpoints, confirm delivery, flag/resolve disputes, against live testnet
docs/            PRD pointer and supporting research notes
```

Stack rationale is in PRD §17. Short version: Rust for the contract because Soroban
requires it, TypeScript everywhere else for a two-person team, Postgres for app state
and the NDPA-compliant off-chain identity map, SDP deployed (never forked) for
farmer payouts, SMS-only for farmers — no app, because seasonal usage (PRD §13, P3)
means nobody will install or retain one.

## CI

Every push and PR to `main` runs typecheck/lint/build/test for each
component that changed (path-scoped — touching `api/` doesn't trigger
`site/`'s workflow, and vice versa). The badges above reflect `main`'s
current state, not any particular commit — a red badge means something
on `main` is actually broken; check the linked workflow run for which
commit and why. `api/`'s CI intentionally does not run its live-testnet
suite (`npm test`) — that needs a funded key as a repo secret, a
decision not yet made — see `CONTRIBUTING.md`.

## Deployment

`coop-pwa`, `buyer-app`, and `warehouse-app` deploy together as one
Vercel project, one domain — not three separate deployments with three
separate URLs. Their code stays exactly as it is (still three apps,
still deliberately not merged — see each app's `TASKS.md` entries for
why), but the repo root's `vercel.json`/`vercel-build.sh` build all
three and stitch the output into `/buyer/`, `/coop/`, `/warehouse/`,
and a landing page at `/` that links to each (`landing/index.html`).
Each app's `vite.config.ts` only switches its build `base` to a
subpath when Vercel's own `VERCEL=1` build env var is
set — local `npm run dev`/`npm run build` in any app still runs at
root, unaffected.

To deploy: point a Vercel project at this repo root (not a subdirectory)
and set `VITE_API_URL` in the Vercel project's environment variables to
wherever `api/` ends up hosted — Vercel's build step doesn't run the API
itself (it's a long-running Fastify/Postgres service, not a static
build or serverless function), so that still needs its own host. The
root `render.yaml` is a ready-to-use blueprint for the API's free web
service — deliberately **not** paired with Render's own free Postgres,
since that expires 30 days after creation and is then deleted
(confirmed via Render's own changelog, not assumed). Point `DATABASE_URL`
at a [Neon](https://neon.tech) project instead: its free tier is
permanent (no expiration, no card needed). Two values need filling in
by hand from the Render dashboard after the blueprint deploys —
`DATABASE_URL` (the Neon connection string) and `DEPLOYER_SECRET_KEY` —
see `render.yaml`'s comments.

**Interim GitHub Pages preview, while the above is still pending:**
[agrisettle.github.io/HarvestLock](https://agrisettle.github.io/HarvestLock/)
(`.github/workflows/gh-pages.yml`, `gh-pages-build.sh`) builds and
publishes the same three apps + landing page automatically on every
push to `main`, so the UI is browsable from the repo before Vercel/
Render are actually set up. **No API is deployed alongside it** —
GitHub Pages only serves static files, it can't host the Fastify/
Postgres service at all — so every write action (lock, settle, cancel,
...) will fail there; it's a UI preview only, not a functional
deployment, and isn't a substitute for the Vercel + Render/Neon setup
above.

`site/` is a separate app with its own deploy story (see `site/README.md`)
and isn't part of this combined build.

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR — it
covers local setup for every component and what a good PR looks like
here. Security issues specifically go through [`SECURITY.md`](./SECURITY.md),
not a public issue.

## Organization

<a href="https://github.com/Agrisettle"><img src="./site/public/wordmark-agrisettle.png" alt="Agrisettle" width="360" /></a>

Part of [Agrisettle](https://github.com/Agrisettle) — settlement infrastructure
for agricultural commodity trade, of which HarvestLock is the first product.

## Maintainer

<a href="https://github.com/samjay8"><img src="./site/public/samuel-ojetunde.png" alt="Samuel Ojetunde" width="120" style="border-radius: 50%;" /></a>

**[Samuel Ojetunde](https://github.com/samjay8)** — Project Maintainer & Founder.

## License

Apache-2.0 — see [`LICENSE`](./LICENSE).
