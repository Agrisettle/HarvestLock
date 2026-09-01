# Task backlog

The granular, living breakdown behind `SPRINT.md`'s day-by-day schedule and `ROADMAP.md`'s long-horizon plan. `SPRINT.md` says *when*; `ROADMAP.md` says *why and in what phase*; this file says *exactly what*, task by task, with enough detail that picking one up doesn't require asking what it means. Check items off as they land, and keep descriptions accurate to what actually got built — same rule as everywhere else in this project.

Not GitHub issues yet — this is the shared reference we work from directly before anything gets filed publicly.

---

## Contracts (`HarvestLock-Contracts`)

Current state: happy-path state machine + claimable-balance-with-expiry, 24/24 tests, testnet-verified twice. Next, in priority order (matches the contracts repo's own `HANDOFF.md`):

- [ ] **Allocation ledger** — per-member salted-hash entries, stored on-chain, with the identity mapping kept in an off-chain store (API's Postgres, once it exists) so it's actually erasable per NDPA s.34 (PRD §16.1). Decide the salt scheme (per-contract, never a bare phone-number hash) before writing any code — this is a compliance-load-bearing decision, not just an implementation detail.
  - Sub-task: contract-side — add member entries + share bps to `Commitment`, or a separate storage-mapped structure if instance storage gets too large for many members.
  - Sub-task: settlement math — pro-rate the final payout across members instead of paying the cooperative wallet a lump sum, OR keep lump-sum-to-cooperative for v1 and treat the ledger as record-only (transparency ladder Rung 1, PRD §4.9) — **this needs a decision, not just code**, since it changes what `settle()` actually does.
- [ ] **Real attestation-driven settlement** — replace `confirm_delivery`'s boolean gate with something that takes delivered quantity/grade and applies the PRD §7 shortfall/grade adjustment schedule. Depends on deciding the on-chain data shape for an attestation (just numbers signed by the warehouse operator, most likely — no oracle needed for this part).
- [ ] **Oracle staleness handling** — PRD §16.3. Currently unbuilt: no NGN/oracle conversion exists at all yet (§4.2 is entirely deferred). This becomes real once denomination work starts; not urgent before that.
- [ ] **Assignability** — buyer position transfer with cooperative consent, recorded on-chain. Deliberately not a market (no order book/listing) — a novation, not a trade.
- [ ] **Cancellation / mutual unwind** — PRD §7's defined unwind: advance settled per agreed schedule, remaining escrow returned, no penalty, logged. `Status::Cancelled` already exists in the enum; no function transitions into it yet.
- [ ] **Buyer default / side-selling forfeiture paths** — `Status::Defaulted`, `Status::Disputed` similarly unbuilt.
- [ ] **`claim_window_secs` minimum/maximum** — currently unenforced; a careless or adversarial buyer could set an absurdly short window. Needs a decision on whether this is a contract-level floor or an API-level validation before submission (leaning API-level, since "reasonable" is a business call, not a protocol invariant) — see contracts HANDOFF.md item 5.

## API (`api/`) — where today's build effort is going

Nothing exists yet. Target shape per PRD §17: TypeScript/Node, Postgres, talks to the deployed Soroban contract via `@stellar/stellar-sdk`, deploys SDP for farmer payouts (later, not week 1).

- [ ] **Project scaffold** — package.json, TypeScript config, a real (not toy) project layout. Decide the framework now rather than drifting into one: recommend a minimal one (Fastify or plain `node:http` + a router) over a heavy framework, matching this project's general bias against unnecessary dependencies.
- [ ] **Postgres schema, v1** — at minimum: `commitments` (mirrors on-chain state for fast reads — contract address, status, parties, amounts, cached from chain, not the source of truth), `allocation_members` (the off-chain identity map — real identifier ↔ salted hash, wipeable independent of on-chain state, per NDPA). Write the schema as versioned migrations from day one, not a single `schema.sql` someone has to hand-diff later.
- [ ] **Stellar SDK connection layer** — a thin, tested wrapper around `@stellar/stellar-sdk` for reading contract state (`get_status`, `get_commitment`) and building/submitting the invoke transactions for `initialize`/`lock`/`release_advance_*`/`claim_advance_*`/`reclaim_advance_*`/`mark_checkpoint`/`confirm_delivery`/`settle`. This is the piece that unlocks both frontends — prioritize breadth (cover every contract function) over polish.
- [ ] **REST (or equivalent) endpoints** wrapping the above — one per contract function, plus read endpoints for status/commitment. Auth is out of scope for v1 (matches PRD's "no auth, no multi-tenant" MVP-tranche framing) — but don't build something that *can't* have auth added later; avoid baking "there is exactly one user" assumptions into the data model.
- [ ] **Tests against testnet** — not mocked. Same discipline as the contracts repo: a test that actually invokes the deployed contract and checks the result, not just that a function was called with the right arguments.
- [ ] **`api/README.md` and `api/HANDOFF.md`** — written as the API is built, not after. Follow the same structure as the contracts repo's HANDOFF.md (what's real, what's deliberately deferred, design decisions and why).

## `coop-pwa/` — blocked on API's contract-status + claim/checkpoint endpoints existing

- [ ] Read-only dashboard: show a commitment's current status, the state-machine position, advance-tranche claim windows and deadlines.
- [ ] Phone-based auth flow — no seed phrases surfaced to cooperative users (PRD §4.6). Needs the API's identity/session model decided first.
- [ ] Claim-advance action (write, not just read) — once the read-only slice is proven, wire up `claim_advance_1`/`claim_advance_2` calls through the API.
- [ ] Offline-tolerant queue for the depot connectivity-loss case (PRD §7/§16.3) — service worker + IndexedDB, deliberately deferred until the online path works first.

## `buyer-app/` — blocked on the same API endpoints, desktop-first

- [ ] Read-only dashboard: same information as coop-pwa's, buyer-facing framing (what they've locked, what's pending, settlement status).
- [ ] Lock/settle actions once read-only is proven.
- [ ] ERP integration — explicitly out of scope until there's a real off-taker to integrate with (PRD §16.2); don't build this speculatively.

## `site/` — small, unblocked, good starting points for a new contributor

- [ ] Wordmark lockup (icon + "Agrisettle" text) for use in docs/README headers — mentioned as a quick follow-up in `BRANDING.md`, never built.
- [ ] Accessibility pass beyond the contrast check already done: skip-to-content link, explicit focus states audit across interactive elements, `aria-hidden` correctness on the decorative mark SVGs (should already be set — verify).
- [ ] Open Graph image — `index.html` has `og:title`/`og:description` but no `og:image`; link previews currently fall back to nothing.
- [ ] Once the API exists: a small "live" indicator on the Status section pulling real current testnet contract state instead of the hand-written numbers baked in at build time — nice-to-have, not urgent.

---

## How this file is meant to be used

Pick an unblocked task, say so before starting on anything nontrivial (avoids duplicate work), build it with the same rigor as everything shipped so far — real tests, testnet verification where applicable, HANDOFF.md updated in the same PR, not a follow-up that may never happen. Check the box here when it's actually done, not when it's started.
