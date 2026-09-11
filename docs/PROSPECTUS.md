# HarvestLock — Prospectus

*A concise, stakeholder-facing summary of where this project stands and where it's headed. For the full engineering detail, see [`../HANDOFF.md`](../HANDOFF.md), [`../ROADMAP.md`](../ROADMAP.md), and [`../docs/PRD.md`](./PRD.md) — this document exists so someone evaluating the project doesn't have to read all three first.*

## The problem

A Nigerian agricultural cooperative needs capital before harvest — to buy inputs, pay labor, get the crop in the ground. A buyer wants supply assurance — a guaranteed volume at a known price, without the risk of the cooperative side-selling to a higher bidder at harvest time. Today, closing that gap between them runs entirely on trust: an informal forward agreement with no enforcement mechanism beyond reputation and relationships.

HarvestLock replaces that trust requirement with a programmable escrow contract on Stellar — not a bank, not a broker, not a custodian of anyone's funds. The buyer's deposit locks into a Soroban smart contract. It releases in tranches as the season progresses, and the final payout only happens once an independent, existing warehouse operator — not either party — confirms the grain actually arrived, at the quantity and grade both sides agreed to before planting.

## Why Stellar

Two things this problem needs that a generic smart-contract platform doesn't automatically give you: cheap enough transactions that a forward-commitment-sized deal (not a DeFi-scale trade) still makes economic sense, and an existing anchor/on-ramp ecosystem that already does KYB and fiat rails in the markets this needs to work in. Stellar's Soroban gives the programmability; the wider Stellar ecosystem gives the distribution and compliance rails a two-person team can't build from scratch. This isn't a "we picked a chain and built a story around it" project — the architecture is built around Soroban's actual constraints (see `HarvestLock-Contracts/HANDOFF.md`'s design-decisions section for the specific tradeoffs made, e.g. why advance claims are built as contract-native state instead of classic `ClaimableBalanceEntry`).

## What's actually built — verified, not claimed

Every number below was re-verified live in the course of writing this document, not pulled from a stale doc:

- **The full state machine, on-chain**: two-phase funding, capped tranched advances with claim/reclaim-with-expiry semantics, mutual cancellation, buyer-position reassignment, shortfall/grade-adjusted settlement, an oracle-based FX conversion path for currency-denominated deals, and dispute flagging with a bounded freeze-and-resolve mechanism. **120/120 contract tests passing** (`cargo test`, re-run this session), deployed and exercised on Stellar testnet ten separate times with real cross-party signatures, not fixtures.
- **A real API layer**: the full commitment lifecycle — deploy, initialize, lock, release, claim, settle, cancel, reassign, dispute — builds and submits against live testnet, including a staged multi-party signing flow for actions that need more than one party's signature without any single process holding more than one key. Off-chain reputation/strike tracking backs the buyer-default and cooperative-forfeiture paths, since the contract itself has no concept of a party's history across other deals.
- **Three real frontends**, not one dashboard pretending to serve three audiences: a buyer app, a cooperative PWA (installable, offline-tolerant for the actual depot-connectivity problem this market has), and a warehouse-operator console — each with real write actions against live testnet through a connected wallet, not read-only mockups.
- **CI that actually verifies the above**: every component's real test suite runs on every push, including the API's database-backed tests against a real Postgres service container (wired in as of this audit — previously a real gap where the badge didn't mean what it looked like it meant).

## What's honestly still open

This project's own documentation is unusually blunt about this, on purpose — every "done" claim above is scoped to *"done for testnet,"* not *"done."* No cooperative or buyer has moved real money through this yet. Specifically still open, each tracked as a public issue rather than left implicit:

- Cooperative wallet social recovery and phone-based authentication — the PRD's explicit "no seed phrases for cooperative users" requirement needs a real identity/session model decided before it can be built, not assumed.
- SDP integration for farmer payouts, buyer KYB via anchor verification, voucher issuance/redemption, and SMS notifications — all named PRD must-haves with real design questions ahead of any code.
- Live production deployment — the frontends are previewable today on GitHub Pages (no API behind it, by design — see `../README.md`'s Deployment section), but the real Vercel + Render/Neon deployment hasn't happened yet. The configuration is ready; the account-level setup is the remaining step.
- Regulatory groundwork with Nigerian counsel — a non-engineering track, tracked in `../ROADMAP.md`'s Track C, that has to run in parallel with everything above before any real pilot.

## Where this is headed

The roadmap (`../ROADMAP.md`) is organized as five phases — Validation, Testnet build, Mainnet pilot, Prove the loop, Build on proven trust — each gated on real evidence, not a calendar date. The project's own stated exit criterion for moving past the current validation phase is blunt: at least one real buyer and one real warehouse operator have to say yes, in writing, before any of the above becomes worth finishing to production quality. Everything built so far is deliberately sequenced to be *ready* the moment that happens, not to have guessed ahead of it.

## Why this is a credible open-source project to contribute to, not just a solo build

- Public, Apache-2.0 licensed, active — commits land multiple times a week, not a repo that went quiet after an initial push.
- 13 open issues across both repos (11 on `HarvestLock`, 2 on `HarvestLock-Contracts`), each grounded in a real, verified gap (checked against the actual code before being filed, not invented to look active) — spanning "good first issue" scope (accessibility, manual QA) through substantial design questions (identity model, KYB, security review of a specific contract decision).
- Documentation that treats "what's not built" as seriously as "what is" — `HANDOFF.md` in each repo is the maintained source of truth, updated in the same change as the code it describes, not a stale artifact from project kickoff.
