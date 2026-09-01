# 7-Day Sprint — get this contributor-ready

**Start:** 1 Sept 2026 &nbsp;|&nbsp; **Target:** 8 Sept 2026 &nbsp;|&nbsp; **Goal:** a stranger can clone this, run it, understand it, and pick up real work — not "the product is finished."

This is a tactical, week-scoped plan layered on top of `ROADMAP.md`'s Phase 0/1. `ROADMAP.md` doesn't change; this file expires after day 7 and gets archived once its job is done. `HANDOFF.md` is the living source of truth for *current state* — this file is the plan, HANDOFF.md is the reality, and they will drift as the week goes. Trust HANDOFF.md when they disagree.

## What "ready for contributors" actually means here

Not "feature-complete." It means: the repo builds and tests pass from a clean clone in under 10 minutes, the next 10 tasks are already written down as issues with enough context to start without asking, CI catches broken PRs automatically, and no contributor's first PR requires reverse-engineering undocumented decisions — HANDOFF.md and the component READMEs already carry that.

## Honest scope call

Fully building the API and both product frontends to the same rigor as the contracts work (real tests, testnet-verified, audited) is not a 7-day job for one contributor. Building all three shallowly, unaudited, would actively work against "contributor-ready" — new contributors inherit debt instead of a foundation. So the priority order is:

1. **Onboarding infrastructure** (this week's real deliverable) — CI, CONTRIBUTING.md, HANDOFF.md, filed issues with real context.
2. **The API** — real, tested, testnet-verified, because both frontends are blocked on it existing. This is the one component worth building deep rather than wide this week.
3. **coop-pwa and buyer-app** — a thin, honest read-only slice each if time allows; otherwise these become the first real contributor tasks, fully scoped as issues rather than half-started.

## Day-by-day

- [x] **Day 1 (1 Sept)** — `SPRINT.md`, `HANDOFF.md` (project-wide, new — distinct from `HarvestLock-Contracts/HANDOFF.md` which stays component-scoped), `CONTRIBUTING.md`. CI: contract tests + site build on every push/PR. API scaffold: package.json, Postgres schema, connection to the deployed testnet contract confirmed working. Filing GitHub issues explicitly deferred per project-owner decision — `TASKS.md` is the shared backlog instead until told otherwise; the "First batch of scoped GitHub issues filed" item originally planned here does not apply.
- [x] **Day 2 (started early, 1 Sept)** — API: contract lifecycle endpoints (deploy, initialize, lock, release/claim/reclaim advance 1 & 2, mark_checkpoint, confirm_delivery, settle) via a generic build-unsigned/client-signs/submit design, proxying to `HarvestLock-Contracts` through `@stellar/stellar-sdk`. Tested against live testnet both at the SDK-wrapper level (`api/test/stellar.test.ts`) and through the real running HTTP server (deploy → initialize → lock walked end to end, contract observed reaching `Locked` on-chain). Postgres cache wired into the read/write paths. Not yet done from the original Day 2 scope: "create commitment" as a single convenience call (today it's deploy + build-initialize + submit, three calls) — left as-is since the multi-call shape is what a real signing flow needs anyway.
- [ ] **Day 3** — API: allocation-ledger stub endpoints (salted-hash member entries, per PRD §4.8/§16.1 — the off-chain identity map, not just the on-chain hash). Postgres migrations. HANDOFF.md updated with what's real vs. stubbed.
- [ ] **Day 4** — `coop-pwa`: read-only dashboard hitting the API (contract status, allocation, claim windows). No write actions yet unless Day 2-3 land early. If the API isn't far enough along, this day becomes filing detailed issues for it instead of starting it half-fed.
- [ ] **Day 5** — `buyer-app`: same read-only-first approach. Same fallback rule.
- [ ] **Day 6** — Whatever from Days 2-5 is genuinely unfinished gets turned into well-scoped issues instead of being left as silent partial code. Full pass on every README/HANDOFF for accuracy against what actually got built.
- [ ] **Day 7** — Final audit pass (same discipline as the contracts work: verify claims against real test/build output, not memory). Publish the sprint retro at the bottom of this file. Archive this file's active-tracking role to HANDOFF.md going forward.

## Definition of done, day 7

- [ ] `git clone` → documented setup → `npm test` / `cargo test` all green, for every component that has code.
- [ ] CI red on a genuinely broken PR (tested, not assumed).
- [ ] At least 8 filed issues, each with: what, why, where to start, and what "done" looks like — not just a title.
- [ ] HANDOFF.md accurately describes every component's real state, including "not started" where that's the truth.
- [ ] No component's docs claim something the code doesn't actually do.

## Retro (fill in on day 7, not before)

*Not yet — this section is written at the end, honestly, including what slipped.*
