# Handoff — HarvestLock (project-wide)

**Read this before anything else if you're new here** — human or AI agent. It exists so anyone can pick up exactly where this stopped, without re-deriving decisions someone already made. Update it whenever you finish a work session — a stale HANDOFF.md actively misleads the next person, which is worse than no HANDOFF.md at all.

This file covers the whole project. The Soroban contract has its own, more detailed handoff at [`HarvestLock-Contracts/HANDOFF.md`](https://github.com/agrisettle/HarvestLock-Contracts/blob/main/HANDOFF.md) — read that one too if you're touching the contract specifically; this file won't duplicate its level of detail.

---

## Read these first, in this order

1. This file — current state, all components.
2. [`docs/PRD.md`](./docs/PRD.md) — the spec, v0.7, including a full audit trail of what earlier versions got wrong.
3. [`ROADMAP.md`](./ROADMAP.md) — the long-horizon plan (Phase 0 through 4).
4. [`SPRINT.md`](./SPRINT.md) — this week's tactical plan, if it still exists (archived after its 7-day window closes — check HANDOFF.md's own dates below to know if you're inside or past that window).

## Component state, as of this writing

| Component | State | Notes |
|---|---|---|
| `HarvestLock-Contracts` (separate repo) | **Real, tested, testnet-verified.** Happy-path state machine + claimable-balance-with-expiry, 24/24 tests passing. | See its own HANDOFF.md for exactly what's built vs. deliberately deferred (allocation ledger, cancellation/dispute paths, real attestation-driven settlement). |
| `site/` | **Real, built, deployed-ready.** Public marketing/credibility site. | Not a logged-in product surface — see `site/README.md`. |
| `api/` | **Scaffolding only as of Day 1 of the sprint** — check the date below against `SPRINT.md`'s day-by-day to know how far this has actually gotten. | Talks to the deployed testnet contract via `@stellar/stellar-sdk`. Postgres for app state and the off-chain identity map (PRD §16.1). |
| `coop-pwa/` | **Not started.** | React/Vite, phone-auth, offline-tolerant. Do not build a logged-in app experience for individual farmers — PRD §13 (P3) and §16.1 rule that out; farmers get SMS only. |
| `buyer-app/` | **Not started.** | Desktop-first web app. |
| `docs/` | PRD lives here now (`docs/PRD.md`), not behind an external link. | If you're about to link the PRD from anywhere, link this file, not an artifact URL — that was a real bug fixed on 1 Sept 2026, don't reintroduce it. |

## What's real vs. what's a stub — the rule that matters most

Everything in this repo should either work and be tested, or be explicitly marked as not built yet. **Never leave code that looks finished but silently does nothing, or docs that describe behavior that doesn't exist.** This project's credibility so far has come specifically from being checkable — a testnet contract address anyone can query, test counts that are real, an audit trail that admits mistakes. Sloppy stubs erode exactly that. If something's a placeholder, say so in the code comment and in this file, not just in your own memory of writing it.

## Identity discipline — a recurring, real gotcha on this machine

The `gh` CLI's active account on this development machine has silently switched away from the correct account (`samjay8`) **multiple times** across sessions, for reasons outside any single session's control. **Before every push**, run `gh auth status` and confirm `samjay8` is active; switch back with `gh auth switch --user samjay8` if not. This has caused a rejected push before. It will probably happen again — check every time, don't assume the previous session left it correct.

## Toolchain notes that will save you time

- `stellar-cli` must be the prebuilt MSVC binary from GitHub releases on this machine, not `cargo install` — the default Rust host toolchain here is `windows-gnu` and lacks `dlltool.exe`. Full detail in the contracts repo's HANDOFF.md.
- If you're testing scroll/UI behavior on `site/` with a headless browser, use real simulated input (Playwright's `page.mouse.wheel()`), not `window.scrollTo()` in a loop — the site sets `scroll-behavior: smooth`, which turns programmatic scrolls into animated, self-interrupting ones and produces flaky false alarms. Documented in `site/README.md`.
- Windows/WSL git boundary: committing from native Git Bash then pushing via `wsl git push` (or vice versa) can produce false "modified" diffs that are pure CRLF/LF noise. Run `git diff` before trusting a "changes not staged" warning — if every line shows as removed-and-readded with identical content, it's line-endings, not real changes, and safe to discard with `git checkout -- <file>`.

## Next steps

Check `SPRINT.md`'s day-by-day checklist first — it's the live tracker for this week. Beyond the sprint window, `ROADMAP.md` Phase 0 Track B (contracts) and the API/frontend work implied by Phase 1 are the source of truth.

## If you're an AI agent picking this up cold

Read in the order listed at the top of this file. Then run whatever tests exist for the component you're about to touch, before changing anything, to confirm your starting point matches what this file claims. If it doesn't match, trust the code and test output over this document, and fix this file before doing anything else — don't silently build on a wrong assumption.

---
*Last updated: 1 Sept 2026, sprint day 1 — SPRINT.md and this file created; CI and CONTRIBUTING.md in progress; API scaffold starting.*
