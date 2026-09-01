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

## API (`api/`) — core lifecycle real and testnet-verified; identity/ledger work still ahead

Target shape per PRD §17: TypeScript/Node, Postgres, talks to the deployed Soroban contract via `@stellar/stellar-sdk`, deploys SDP for farmer payouts (later, not week 1).

- [x] **Project scaffold** — package.json, TypeScript config, Fastify (chosen over a heavier framework, matching this project's bias against unnecessary dependencies).
- [x] **Postgres schema, v1** — `commitments` table (migration `001_init.sql`), mirrors on-chain state, cached from chain reads, not the source of truth. `allocation_members` deliberately **not** added yet — see below, this needs a decision first, not just a table.
- [x] **Stellar SDK connection layer** — `src/stellar/{client,deploy,tx}.ts`. Covers reads (`get_status`, `get_commitment`) and every write (`initialize` plus every no-arg lifecycle method — `lock`/`release_advance_*`/`claim_advance_*`/`reclaim_advance_*`/`mark_checkpoint`/`confirm_delivery`/`settle`, generically, since only `initialize` takes arguments). Breadth achieved: every contract function is reachable.
- [x] **REST endpoints** wrapping the above — `src/server.ts`. Deploy, build-tx-per-method, generic signed-submit, live read, cached list. No auth, and the data model doesn't assume a single user (see `api/README.md`).
- [x] **Tests against testnet** — `api/test/stellar.test.ts`, not mocked, plus a full HTTP-layer walk (deploy → initialize → lock) run by hand against the live server on 1 Sept 2026 and confirmed via a fresh chain read (`status: Locked`).
- [x] **`api/README.md` and `api/HANDOFF.md`** — both written 1 Sept 2026, describing what's real, what's deferred, and why (build-unsigned/client-signs/submit architecture, deploy-vs-initialize split, cache-refresh-on-read model).
- [ ] **`allocation_members` table + off-chain identity map** — still blocked on the same salt-scheme decision as the contracts-side allocation ledger (see above); don't build one side without the other, the schemes need to match.
- [ ] **A real "create commitment" UX flow** — today it's three API calls plus a client-side wallet signature in the middle; no frontend has exercised this yet. First real user of it will surface whatever's awkward about the three-call shape.

## `coop-pwa/` — was blocked on the API existing; it now does (see above), so this is unblocked

- [ ] Read-only dashboard: show a commitment's current status, the state-machine position, advance-tranche claim windows and deadlines.
- [ ] Phone-based auth flow — no seed phrases surfaced to cooperative users (PRD §4.6). Needs the API's identity/session model decided first.
- [ ] Claim-advance action (write, not just read) — once the read-only slice is proven, wire up `claim_advance_1`/`claim_advance_2` calls through the API.
- [ ] Offline-tolerant queue for the depot connectivity-loss case (PRD §7/§16.3) — service worker + IndexedDB, deliberately deferred until the online path works first.

## `buyer-app/` — was blocked on the same API endpoints, desktop-first; also unblocked now

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
