# HarvestLock

Pre-harvest commodity forward commitments on Stellar. A cooperative and a buyer agree
price and quantity before harvest; the buyer's deposit sits in a Soroban escrow and
releases against an independent warehouse operator's grading receipt, not against
either party's say-so. A capped, tranched advance reaches the cooperative before
harvest. Each member farmer's share is recorded on chain at lock-in.

**Full PRD:** [`docs/PRD.md`](./docs/PRD.md) — currently v0.7

**Roadmap:** [`ROADMAP.md`](./ROADMAP.md)

## Status

Pre-validation, no pilot partner announced yet — but not just a spec. The
contract, API, and both product frontends are real, tested, and testnet-
verified for their current (deliberately partial) scope:

- **Contract**: full happy-path state machine plus mutual cancellation, 30/30 tests, deployed and exercised live on testnet.
- **`site/`**: built, public, includes a live badge reading the reference contract's real current state.
- **`api/`**: the full lifecycle (deploy through settle, including cancel's two-party signing) builds and submits against live testnet — not mocked.
- **`coop-pwa`/`buyer-app`**: read-only dashboards against the live API, browser-verified.

None of this is "feature-complete" — see `HANDOFF.md` for the honest
current-state breakdown (what's real vs. deliberately deferred, per
component) and `ROADMAP.md` for what happens next and in what order. Open
Questions in the PRD (§12) are what has to be resolved before this can move
past testnet regardless of how much gets built.

## Repositories

The Soroban contract lives in its own repo — separate audit trail and release
cadence from application code. This repo is everything else.

| Repo | Contents |
|---|---|
| [`HarvestLock-Contracts`](https://github.com/agrisettle/HarvestLock-Contracts) | Soroban escrow contract (Rust) — the state machine in PRD §4.8 |
| `harvestlock` *(this repo)* | Public site, API, both product frontends, docs, roadmap |

## Repository layout

```
site/         Public site (React/Vite) — the project's public face, not a logged-in product surface
api/          HarvestLock API (TypeScript/Node, Fastify) — contract lifecycle is real today; allocation/vouchers/attestation intake are planned, not built (see api/HANDOFF.md)
coop-pwa/     Cooperative-facing dashboard (React/Vite) — read-only today; phone-auth and offline-tolerance still ahead
buyer-app/    Buyer/off-taker dashboard (React/Vite) — read-only today; ERP integration still ahead
docs/         PRD pointer and supporting research notes
```

Stack rationale is in PRD §17. Short version: Rust for the contract because Soroban
requires it, TypeScript everywhere else for a two-person team, Postgres for app state
and the NDPA-compliant off-chain identity map, SDP deployed (never forked) for
farmer payouts, SMS-only for farmers — no app, because seasonal usage (PRD §13, P3)
means nobody will install or retain one.

## Organization

Part of [agrisettle](https://github.com/agrisettle) — settlement infrastructure
for agricultural commodity trade, of which HarvestLock is the first product.

## License

Apache-2.0 — see [`LICENSE`](./LICENSE).
