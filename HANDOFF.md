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
| `HarvestLock-Contracts` (separate repo) | **Real, tested, testnet-verified.** Happy-path state machine + claimable-balance-with-expiry + mutual cancellation, 30/30 tests passing. | See its own HANDOFF.md for exactly what's built vs. deliberately deferred (allocation ledger, dispute/default paths, real attestation-driven settlement). |
| `site/` | **Real, built, deployed-ready.** Public marketing/credibility site. | Not a logged-in product surface — see `site/README.md`. |
| `api/` | **Real, tested, testnet-verified for the core lifecycle, including mutual cancellation.** Fastify server; deploy, initialize, and every no-arg lifecycle method (lock, claim/reclaim, checkpoint, confirm, settle, cancel) all build/submit end to end against live testnet, HTTP-tested, not just unit-tested. `cancel` needed a genuinely different two-party signing mechanism — see `api/HANDOFF.md`. | Build-unsigned/client-signs/submit architecture — see `api/README.md`. Postgres mirrors chain state (`commitments` table); allocation ledger and identity map (PRD §16.1) not started. |
| `coop-pwa/` | **Read-only dashboard real, browser-verified, and unit-tested.** Commitment status + tranche claim windows, live from chain via the API. | React/Vite. Phone-auth, write actions, offline-tolerant queue all deferred — see `coop-pwa/README.md`. Do not build a logged-in app experience for individual farmers — PRD §13 (P3) and §16.1 rule that out; farmers get SMS only. |
| `buyer-app/` | **Read-only dashboard real, browser-verified, and unit-tested.** Same data as `coop-pwa`, buyer-framed (leads with a plain-language "what's pending" summary). | Desktop-first web app. Write actions, auth, ERP integration (PRD §16.2) all deferred — see `buyer-app/README.md`. |
| `docs/` | PRD lives here now (`docs/PRD.md`), not behind an external link. | If you're about to link the PRD from anywhere, link this file, not an artifact URL — that was a real bug fixed on 1 Sept 2026, don't reintroduce it. |

## What's real vs. what's a stub — the rule that matters most

Everything in this repo should either work and be tested, or be explicitly marked as not built yet. **Never leave code that looks finished but silently does nothing, or docs that describe behavior that doesn't exist.** This project's credibility so far has come specifically from being checkable — a testnet contract address anyone can query, test counts that are real, an audit trail that admits mistakes. Sloppy stubs erode exactly that. If something's a placeholder, say so in the code comment and in this file, not just in your own memory of writing it.

## Identity discipline — a recurring, real gotcha on this machine

The `gh` CLI's active account on this development machine has silently switched away from the correct account (`samjay8`) **multiple times** across sessions, for reasons outside any single session's control. **Before every push**, run `gh auth status` and confirm `samjay8` is active; switch back with `gh auth switch --user samjay8` if not. This has caused a rejected push before. It will probably happen again — check every time, don't assume the previous session left it correct.

## Toolchain notes that will save you time

- `stellar-cli` must be the prebuilt MSVC binary from GitHub releases on this machine, not `cargo install` — the default Rust host toolchain here is `windows-gnu` and lacks `dlltool.exe`. Full detail in the contracts repo's HANDOFF.md.
- If you're testing scroll/UI behavior on `site/` with a headless browser, use real simulated input (Playwright's `page.mouse.wheel()`), not `window.scrollTo()` in a loop — the site sets `scroll-behavior: smooth`, which turns programmatic scrolls into animated, self-interrupting ones and produces flaky false alarms. Documented in `site/README.md`.
- Windows/WSL git boundary: committing from native Git Bash then pushing via `wsl git push` (or vice versa) can produce false "modified" diffs that are pure CRLF/LF noise. Run `git diff` before trusting a "changes not staged" warning — if every line shows as removed-and-readded with identical content, it's line-endings, not real changes, and safe to discard with `git checkout -- <file>`.
- `@stellar/stellar-sdk`'s `scValToNative` resolves a payload-less Rust enum variant (e.g. `Status::Draft`) into a **one-element array** (`['Draft']`), not a bare string — a real bug in `api/src/stellar/client.ts` shipped with a comment claiming the opposite until `npm test` caught it against the live contract. Unwrap it (see `unwrapStatus` in that file) rather than casting past it.
- Running a dev server with `&` inside a single Bash-tool call doesn't survive past that call on this machine — the child gets orphaned/killed when the tool call's own shell exits. Use the tool's own `run_in_background` on the server-start command itself (not wrapped with other commands), then hit it from separate calls.
- **Multi-party Soroban auth** (a contract call needing more than one address's `require_auth()`, like `cancel`) is not "sign the transaction twice." Neither `stellar-cli`'s `tx sign --sign-with-key <second party>` nor `@stellar/stellar-sdk`'s `Transaction.sign()` called once per party works — both add an extra *classic envelope* signature and the network rejects the whole tx with `tx_bad_auth_extra`. The correct mechanism, worked out and proven live in `api/test/helpers.ts`: sign each non-source party's `SorobanAuthorizationEntry` individually via `authorizeEntry()`, then rebuild the operation/transaction around the signed entries (mutating the built transaction's `.operations` in place doesn't persist — it's a derived view). Also: a participating address's auth only verifies against a real, *funded/created* account — an unfunded keypair fails with a storage error, not a signature error.

## Next steps

Check `SPRINT.md`'s day-by-day checklist first — it's the live tracker for this week. Beyond the sprint window, `ROADMAP.md` Phase 0 Track B (contracts) and the API/frontend work implied by Phase 1 are the source of truth.

## If you're an AI agent picking this up cold

Read in the order listed at the top of this file. Then run whatever tests exist for the component you're about to touch, before changing anything, to confirm your starting point matches what this file claims. If it doesn't match, trust the code and test output over this document, and fix this file before doing anything else — don't silently build on a wrong assumption.

---
*Last updated: 2 Sept 2026 — sprint day 1 turned into a genuinely large single session. API's core lifecycle (deploy, initialize, lock, claim/reclaim, checkpoint, confirm, settle) built and verified end to end against live testnet via the actual HTTP server, not just the SDK wrapper; retry-with-backoff added after two real transient-RPC failures; a malformed-contract-ID request now correctly returns 400, not 500. Contracts gained `cancel()` (mutual unwind, PRD §7) — the one method needing two different parties' Soroban auth on one call, which took two false starts (stellar-cli's `tx sign`, then the naive `Transaction.sign()`-twice) before finding the real mechanism, documented in `api/test/helpers.ts` and proven live with two genuinely different signers. `coop-pwa` and `buyer-app` both got their read-only dashboards, browser-verified (which caught a real CORS bug — `curl` doesn't enforce it, only a real browser does) and then given their first automated test suites (vitest + Testing Library, two real environment issues found and fixed: the default forks pool hangs on this machine, and Testing Library's auto-cleanup needs vitest globals this project doesn't use). `site/` gained an OG image, a skip-link and real focus-visible styling, and a live status badge reading real chain state through the API. CI now runs typecheck/lint/test/build on every push/PR for site, api, coop-pwa, and buyer-app. Root README.md, CONTRIBUTING.md, and ROADMAP.md all had real stale claims fixed along the way (the API/frontends were described as unbuilt after they weren't, test counts were off, filed-issue instructions pointed at a workflow this project isn't using yet).*
