# Handoff — HarvestLock (project-wide)

**Read this before anything else if you're new here** — human or AI agent. It exists so anyone can pick up exactly where this stopped, without re-deriving decisions someone already made. Update it whenever you finish a work session — a stale HANDOFF.md actively misleads the next person, which is worse than no HANDOFF.md at all.

This file covers the whole project. The Soroban contract has its own, more detailed handoff at [`HarvestLock-Contracts/HANDOFF.md`](https://github.com/Agrisettle/HarvestLock-Contracts/blob/main/HANDOFF.md) — read that one too if you're touching the contract specifically; this file won't duplicate its level of detail.

---

## Read these first, in this order

1. This file — current state, all components.
2. [`docs/PRD.md`](./docs/PRD.md) — the spec, v0.7, including a full audit trail of what earlier versions got wrong.
3. [`ROADMAP.md`](./ROADMAP.md) — the long-horizon plan (Phase 0 through 4).
4. [`SPRINT.md`](./SPRINT.md) — this week's tactical plan, if it still exists (archived after its 7-day window closes — check HANDOFF.md's own dates below to know if you're inside or past that window).

## Component state, as of this writing

| Component | State | Notes |
|---|---|---|
| `HarvestLock-Contracts` (separate repo) | **Real, tested, testnet-verified.** Happy-path state machine + claimable-balance-with-expiry + mutual cancellation + buyer-position assignability, 34/34 tests passing. | See its own HANDOFF.md for exactly what's built vs. deliberately deferred (allocation ledger, dispute/default paths, real attestation-driven settlement). |
| `site/` | **Real, built, deployed-ready.** Public marketing/credibility site. | Not a logged-in product surface — see `site/README.md`. |
| `api/` | **Real, tested, testnet-verified for the core lifecycle, including mutual cancellation and buyer-position assignability.** Fastify server; deploy, initialize, reassign_buyer, and every no-arg lifecycle method (lock, claim/reclaim, checkpoint, confirm, settle, cancel) all build/submit end to end against live testnet, HTTP-tested, not just unit-tested. `cancel`/`reassign_buyer` needed genuinely different multi-party signing mechanisms (two and three parties) — see `api/HANDOFF.md`. | Build-unsigned/client-signs/submit architecture — see `api/README.md`. Postgres mirrors chain state (`commitments` table); allocation ledger + off-chain identity map with erasure are built, but auth/sessions and SDP integration remain unimplemented (designs recorded below). |
| `coop-pwa/` | **Dashboard + its first write action (claim-advance), real and tested.** Commitment status + tranche claim windows, live from chain, plus a Freighter-signed claim flow for the connected cooperative wallet. | React/Vite. Freighter is a testnet/MVP stand-in, not the real phone-auth model (PRD §4.6). No real Freighter extension available in this environment — signing itself isn't manually QA'd, only the logic around it. Offline-tolerant queue built 4 Oct 2026 — see `coop-pwa/README.md`. Do not build a logged-in app experience for individual farmers — PRD §13 (P3) and §16.1 rule that out; farmers get SMS only. |
| `buyer-app/` | **Dashboard + lock/settle write actions, real and tested.** Same data as `coop-pwa`, buyer-framed. `settle` confirmed permissionless (any connected wallet, not just buyer/cooperative) since the contract has no `require_auth()` on it. | Desktop-first web app. Same Freighter caveat as `coop-pwa`. Auth, ERP integration (PRD §16.2) still deferred — see `buyer-app/README.md`. |
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

## Buyer-app CI follow-up — 23 Oct 2026

Buyer-app CI checks generated JavaScript and CSS in `dist/assets/` against a
350,000-byte budget after building. The measured production output is 265,840
bytes on Node 24/npm 11. Typecheck, lint, all 109 buyer-app tests, build, and the
budget check pass. The five lockfile-sync jobs also leave their lockfiles
unchanged with the current Node 24/npm 11 workflow; the older Node 20/npm 10
check with `--legacy-peer-deps` incorrectly rewrote peer-dependency entries.

## Manual Freighter QA — cancel & reassignment (#55–#58), 20 Nov 2026

`docs/qa/manual-freighter-qa-cancel-reassign.md` is a runbook for the four
outstanding `coop-pwa` wallet flows: #55 propose cancellation, #56 approve a
buyer-proposed cancellation, #57 finalize a ready cancellation, and #58
approve a buyer-reassignment proposal (cooperative side). Per-issue write-ups
ready to post as issue comments live alongside it in `docs/qa/`.

## Manual Freighter QA — warehouse-app dispute lifecycle (#65–#68), 21 Nov 2026

End-to-end Manual Freighter QA on Stellar Testnet executed and documented across the four sequential dispute lifecycle flows in `warehouse-app`:
- **#65 (`warehouse-app`):** Flag a dispute (`DisputeSection.tsx` -> `handleFlag`, single-signer `flag_dispute` transaction envelope, moving commitment from `Locked` to `Disputed`).
- **#66 (`warehouse-app`):** Propose resolving a dispute (`DisputeSection.tsx` -> `handlePropose`, off-chain API multi-party staging creating proposal in DB, triggers no Freighter popup).
- **#67 (`warehouse-app`):** Approve a dispute resolution (warehouse side) (`DisputeSection.tsx` -> `handleApprove`, signing `signAuthEntry` on non-source Soroban authorization entry with 0 gas).
- **#68 (`warehouse-app`):** Finalize a ready dispute resolution (`DisputeSection.tsx` -> `handleFinalize`, signing full multi-party envelope via `signTransactionXdr` on refreshed `ready_xdr`, unfreezing commitment back to `Locked`).

Detailed execution runbook, keypair role mappings, verification matrix, popup reviews, rejection handling checks, and state reconciliation reports are stored in:
- [`docs/qa/manual-freighter-qa-warehouse-dispute-lifecycle-65-68.md`](./docs/qa/manual-freighter-qa-warehouse-dispute-lifecycle-65-68.md)
- [`docs/qa/issue-65-flag-dispute.md`](./docs/qa/issue-65-flag-dispute.md)
- [`docs/qa/issue-66-propose-resolving-dispute.md`](./docs/qa/issue-66-propose-resolving-dispute.md)
- [`docs/qa/issue-67-approve-dispute-resolution.md`](./docs/qa/issue-67-approve-dispute-resolution.md)
- [`docs/qa/issue-68-finalize-dispute-resolution.md`](./docs/qa/issue-68-finalize-dispute-resolution.md)

Two discrepancies documented as bug reports:
1. `DisputeSection.tsx` loses "Approved — waiting" state on page reload due to component-local `justApproved` state.
2. `DisputeSection.tsx` ready state does not show the proposer's address, leaving other parties unable to tell who must finalize.

## Manual Freighter QA umbrella (#1) & Allocation Ledger verification (#2), 20 Nov 2026

`docs/qa/issue-1-manual-freighter-qa-umbrella.md` and `docs/qa/issue-2-allocation-ledger-verification.md`
document the complete audit, cross-app write-action verification matrix, and allocation ledger UI
workflow for issues #1 and #2.

**Honest status:** the full source traces across all three frontends (`coop-pwa`, `buyer-app`,
`warehouse-app`), API routes, contracts interface, and test suites are verified here. The real
Freighter popup interactions and live testnet transactions were not executed in this environment, as
this is a headless sandbox with no interactive desktop or browser extension. The reports record the
exact expected popup dialogs, parameter encodings (including salted hash guarantees), and tester
checklists.

**Findings from inspection:**
- Propose flows (`cancel`, `reassign_buyer`, `resolve_dispute`) trigger **no** wallet popup.
- Approvals require `signAuthEntry` (Authorization Entry dialog), not `signTransaction`.
- Allocation ledger recording (`set_allocation`) passes only salted hashes and basis points to Soroban, ensuring off-chain privacy and NDPA s.34 compliance.

## Design decisions on paper, not yet implemented (20 Nov 2026)

Three design-first proposals were written in response to issues #3, #4 and
#5. None of them is code, and none closes its issue on its own:

- Issue #5 — [`docs/identity-session-model.md`](./docs/identity-session-model.md):
  non-custodial entity identity, phone OTP only for verification,
  SEP-10/45 challenge → short-lived stateless JWT, and API party-match
  checks on writes.
- Issue #3 — [`docs/cooperative-wallet-recovery.md`](./docs/cooperative-wallet-recovery.md):
  Soroban smart wallet with 2-of-3 recovery as the target, classic
  multisig retained as a documented fallback; gated on a live
  escrow/client-support spike.
- Issue #4 — [`docs/sdp-integration-plan.md`](./docs/sdp-integration-plan.md):
  manual-first SDP payout trigger, idempotent schema, and the real
  phone/SMS/passkey + TIRM prerequisites.

Read these before implementing any of the three. The existing
[`docs/key-recovery-exercise.md`](./docs/key-recovery-exercise.md) and
[`docs/sdp-spike.md`](./docs/sdp-spike.md) remain the honest records of what
was actually exercised on testnet.

## Next steps

Check `SPRINT.md`'s day-by-day checklist first — it's the live tracker for this week. Beyond the sprint window, `ROADMAP.md` Phase 0 Track B (contracts) and the API/frontend work implied by Phase 1 are the source of truth.

## If you're an AI agent picking this up cold

Read in the order listed at the top of this file. Then run whatever tests exist for the component you're about to touch, before changing anything, to confirm your starting point matches what this file claims. If it doesn't match, trust the code and test output over this document, and fix this file before doing anything else — don't silently build on a wrong assumption.

---
*Last updated: 2 Sept 2026 — sprint day 1 turned into a genuinely large multi-session push. API's core lifecycle (deploy, initialize, lock, claim/reclaim, checkpoint, confirm, settle) built and verified end to end against live testnet via the actual HTTP server, not just the SDK wrapper; retry-with-backoff added after two real transient-RPC failures; malformed contract IDs and addresses now correctly return 400, not 500. Contracts gained `cancel()` (mutual unwind, PRD §7) and `reassign_buyer()` (buyer-position assignability, PRD §4.8, three-party-consented — one signer more than the PRD text alone requires, on purpose) — the two methods needing multi-party Soroban auth on one call, which took two false starts (stellar-cli's `tx sign`, then the naive `Transaction.sign()`-twice) before finding the real mechanism, documented in `api/test/helpers.ts` and proven live with genuinely different signers each time. `coop-pwa` and `buyer-app` both got read-only dashboards, browser-verified (which caught a real CORS bug — `curl` doesn't enforce it, only a real browser does), automated test suites, and then their first real write actions — `coop-pwa` can claim an advance tranche, `buyer-app` can lock a Draft commitment or settle a Delivered one — via Freighter (a testnet/MVP stand-in for the real phone-auth model, not itself production-ready). A real bug found in an actual browser here too: with no Freighter extension installed, the wallet call hangs forever instead of erroring — fixed with a timeout, unit-tested with a mock that never settles. `site/` gained an OG image, a skip-link and real focus-visible styling, and a live status badge reading real chain state through the API. CI now runs typecheck/lint/test/build on every push/PR for site, api, coop-pwa, and buyer-app. Root README.md, CONTRIBUTING.md, and ROADMAP.md all had real stale claims fixed along the way.*
