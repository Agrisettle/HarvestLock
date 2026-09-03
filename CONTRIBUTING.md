# Contributing to HarvestLock

Thanks for looking at this. Read this file, then [`HANDOFF.md`](./HANDOFF.md) for current state, before opening a PR — both are short and will save you from redoing work someone already thought through.

## Before you write any code

1. Read [`docs/PRD.md`](./docs/PRD.md) — at least the sections relevant to what you're touching. This project has an unusual amount of "why," including a full audit trail of things earlier versions got wrong. If your PR contradicts something the PRD deliberately decided, either you've found a real problem (say so in the PR, don't just override it) or you've missed context (the PRD will usually have it).
2. Check [`HANDOFF.md`](./HANDOFF.md) and, if you're touching the contract, [`HarvestLock-Contracts/HANDOFF.md`](https://github.com/Agrisettle/HarvestLock-Contracts/blob/main/HANDOFF.md) for the current real state of what you're about to work on. Don't trust a README's "status" line over these — HANDOFF.md is maintained to be the accurate one.
3. Check [`TASKS.md`](./TASKS.md) — the current shared backlog. GitHub issues aren't being filed yet (a deliberate, current choice, not a gap); TASKS.md is where in-progress and planned work is tracked until that changes. Say what you're picking up before starting anything nontrivial, to avoid two people building the same thing.

## Local setup

**Contracts** (Rust, Soroban) — see [`HarvestLock-Contracts/README.md`](https://github.com/Agrisettle/HarvestLock-Contracts/blob/main/README.md). Short version: `cargo test` needs only Rust; `stellar contract build`/deploy needs the Stellar CLI.

**Site** (`site/`, React/Vite):
```bash
cd site
npm install
npm run dev
```

**API** (`api/`, TypeScript/Node/Fastify) — see [`api/README.md`](./api/README.md) for setup and [`api/HANDOFF.md`](./api/HANDOFF.md) for current state. Needs Postgres (Docker is the easy path) and testnet credentials; `npm test` hits real testnet, not mocks — read the README before running it blind.

**`coop-pwa`** and **`buyer-app`** (React/Vite, real write actions via Freighter — not just read-only dashboards):
```bash
cd coop-pwa   # or buyer-app
npm install
npm run dev
```
Both need `api/` running to show real data — see each app's `README.md`.

## What a good PR looks like here

- **Scoped to one thing.** This project has been built with deliberate scope discipline throughout — don't refactor adjacent code, don't rename things "while you're in there," don't add a dependency the task doesn't need. If you spot something else worth fixing, note it as a follow-up issue instead of folding it in.
- **Tested.** Every component that has tests should keep passing them, and new behavior should come with new tests, not just manual verification you don't write down.
- **Honest about what's stubbed.** If part of your change is a placeholder for something you didn't finish, say so explicitly in a code comment and in the PR description. Silent stubs that look finished are the one thing this project has been specifically careful to avoid — see `HANDOFF.md`'s "What's real vs. what's a stub" section.
- **Documented in the same PR.** If your change makes a README or HANDOFF.md inaccurate, update it in the same PR — not as a follow-up that may never happen.

## Commit messages

Conventional-commit-ish (`feat:`, `fix:`, `docs:`, `refactor:`) with a body explaining *why*, not just what — this repo's history is written to be read later, not just skimmed in a PR diff. Look at recent commits in any of the repos under [Agrisettle](https://github.com/Agrisettle) for the tone.

## CI

Contract tests, and typecheck/lint/build for `site/`, `api/`, `coop-pwa/`, and `buyer-app/`, run automatically on every push and PR (path-scoped — touching one component doesn't trigger the others). `api/`'s CI does *not* run its live-testnet test suite (`npm test`) — that needs a funded key as a repo secret, a decision not yet made; run it locally. A red check means something real broke — fix the cause, don't disable the check.

## Security

Found a vulnerability, not just a bug? Don't open a public issue for
it — see [`SECURITY.md`](./SECURITY.md) for how to report it privately.

## Questions

Open an issue. If it's about direction rather than a specific bug, say so in the title so it's clear you're not reporting something broken.
