# HarvestLock

Pre-harvest commodity forward commitments on Stellar. A cooperative and a buyer agree
price and quantity before harvest; the buyer's deposit sits in a Soroban escrow and
releases against an independent warehouse operator's grading receipt, not against
either party's say-so. A capped, tranched advance reaches the cooperative before
harvest. Each member farmer's share is recorded on chain at lock-in.

**Full PRD (living document, v0.7+):** https://claude.ai/code/artifact/c9a2f2a6-b9f2-4218-b4e8-60651ddfbb5d

**Roadmap:** [`ROADMAP.md`](./ROADMAP.md)

## Status

Pre-validation. Nothing here is built yet. See `ROADMAP.md` for what happens first
and in what order, and Open Questions in the PRD (§12) for what has to be resolved
before this can move past testnet.

## Repositories

The Soroban contract lives in its own repo — separate audit trail and release
cadence from application code. This repo is everything else.

| Repo | Contents |
|---|---|
| [`HarvestLock-Contracts`](https://github.com/agrisettle/HarvestLock-Contracts) | Soroban escrow contract (Rust) — the state machine in PRD §4.8 |
| `harvestlock` *(this repo)* | API, both frontends, docs, roadmap |

## Repository layout

```
api/          HarvestLock API (TypeScript/Node) — contracts, allocation, vouchers, attestation intake
coop-pwa/     Cooperative-facing PWA (React/Vite) — offline-tolerant, phone-auth
buyer-app/    Buyer/off-taker web app — desktop, eventual ERP integration
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
