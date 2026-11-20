# Revisit: background cache refresh for `GET /commitments`

**Date:** 2026-10-18
**Issue:** #186 — "Revisit: a background cache-refresh job for GET /commitments"
**Scope:** whether the deferral in `api/HANDOFF.md` ("No background cache refresher… Fine for now (no real users yet); revisit once something else can also mutate a contract without going through this API") still holds, and if not, the smallest version that would help. Investigation only — no code changes to `api/` are part of this document.

## What was deferred, exactly

`api/HANDOFF.md`'s "What's deliberately deferred" and `api/README.md`'s "What's not built yet" both say the same thing: the Postgres `commitments` mirror only refreshes when someone calls `GET /commitments/:contractId` (which re-reads the chain) or `POST /transactions/submit` with `refreshContractId`. The list endpoint, `GET /commitments`, serves that mirror, so it can show a status older than the chain for a contract nobody has looked at recently. The deferred fix was a scheduler that refreshes the mirror independently of reads, explicitly gated on "once something else can also mutate a contract without going through this API." The same caveat is inherited by the reputation consequences (`applyReputationConsequences` only runs when a refresh observes a fresh transition into `Defaulted`/`Forfeited`).

## What has changed since the deferral

**The deferral's literal trigger is now reachable.** The contract is public, and several methods are permissionless or single-party:

- `expire_remainder_window` and `expire_dispute_window` are permissionless — any address can invoke them directly, with no API involvement.
- `settle` requires no specific party's auth; `reclaim_on_nondelivery` is buyer-gated.
- Counterparties can always submit a transaction from their own wallet through any RPC endpoint; the API is a convenience and a coordinator, not a gate on the chain.
- The contracts repo's own tooling (`stellar-cli` walkthroughs, the multi-party helpers) mutates deployed instances directly by design.

**The stakes of staleness went up.** When the deferral was written, a stale cache meant a stale list view. Since then, `applyReputationConsequences` made the same trigger point load-bearing for enforcement: a default/forfeiture that nobody reads is not recorded, and `requireNotBarred` therefore cannot bar that address until some future read happens. That is a correctness gap, not a UI one.

**The cache is now the product's only listing surface.** All three frontends call `listCommitments()` on their dashboard; `buyer-app`, `coop-pwa`, and `warehouse-app` paginate or display directly from the mirror.

## What has not changed

- **Zero real users.** The project is still testnet-only with team-operated parties; `render.yaml` deploys one free-tier API instance against Stellar testnet.
- **Every product write path still goes through this API, and every status-changing one refreshes the cache.** Checked all three frontends: `buyer-app` (`lock`, create, dispute, cancel, reassign), `coop-pwa` (claim, dispute, cancel, reassign), and `warehouse-app` (checkpoint, delivery confirm, dispute) all pass the contract ID as `refreshContractId` on `submitTx`. The one write that doesn't is `coop-pwa`'s `set_allocation` submit, which changes no cached field — it is pre-`lock`, and the cache never carried allocation data. The chain cannot change a commitment's status without an invocation, and every invocation a user can make from the product goes through a route that refreshes the mirror. The only ways to observe staleness today are (a) a party deliberately bypassing the frontends and the API, (b) a third party invoking a permissionless expiry directly, or (c) the contracts repo's own operational tooling.
- **A background job would be a refresher, not an indexer.** It can only iterate contracts already present in `commitments`. It cannot discover a commitment that was deployed and initialized without ever passing through this API. Closing that hole is a chain-indexer project (`getEvents` ingestion), which is a different, larger, not-currently-justified piece of infrastructure. This matters for the honesty of what the "smallest version" below does and does not buy.
- **No incident.** There is no recorded case of a stale list or an unapplied strike causing a wrong action. The gap is real and acknowledged; it is not demonstrated.

## Verdict: the original call still holds

The deferral's *wording* ("something else can also mutate a contract") is now technically satisfiable, but its *purpose* — a second, active writer making the mirror materially wrong for real users — has not materialized. Adding an always-on job now would:

- introduce the first server-side write path that is not the direct consequence of a user action, with its own failure modes (partial scans, transient RPC failures, duplicate work across multiple instances);
- add operational surface (interval/freshness configuration, advisory locking before any second instance exists, RPC budget) for a benefit no current user can observe; and
- contradict the same "don't build ahead of real usage" bias this repo applies everywhere else (the appeals process is an email inbox; the allocation ledger is record-only in v1).

The reputation dependency is the one serious argument in the other direction, and it does not change the answer yet: on testnet with team parties, an unrecorded default costs nothing, and enforcement re-establishes itself the next time anyone reads the contract. On the first real pilot, this flips — see the triggers below.

## If and when it changes: the smallest version

Pre-worked so the next session doesn't re-derive it. It is a **refresher for mirrored contracts, not a new service**:

1. **Extract the refresh path into one function first.** The GET-detail route and the `refreshContractId` branch of `/transactions/submit` currently inline the same chain-read → `upsertCommitment` → `applyReputationConsequences` sequence. Pull it into a single `refreshCommitment(contractId): Promise<void>` (best-effort per its existing contract) and call it from all three places. Without this, the job would be a third divergent copy of the refresh logic.
2. **An in-process interval, off by default.** `startCacheRefreshJob()` calls `setInterval` only when `CACHE_REFRESH_INTERVAL_MS` is set and > 0; `unref()` the timer; clear it in an `onClose` hook. No cron, no worker, no queue.
3. **Work through the mirror, oldest first, bounded.** Select existing `commitments` rows with `updated_at` older than the interval, `ORDER BY updated_at ASC LIMIT 20` (or a configured batch), and refresh them sequentially — concurrency 1, so the job can never burst Soroban RPC (the HTTP rate limiter does not apply to it). The `commitments` table is the work queue; no cursor or state is needed.
4. **Overlap guard and per-contract failure isolation.** A single `inFlight` boolean skips a tick if the previous one is still running; each contract's failure is logged and skipped, never aborting the batch — the same best-effort rule the cache refresh already follows at submit time.
5. **Multi-instance is a later problem, with a known answer.** One instance today (`render.yaml`). If a second ever runs, wrap the tick in `pg_try_advisory_lock` before doing anything else — do not build distributed scheduling.

Explicit non-goals for that version: no chain indexer, no backfill of contracts the API never saw, no per-contract schedules, no `getEvents`, no change to `GET /commitments`' response shape, no reputation recalculation beyond what a normal refresh already does.

## Triggers to revisit (concrete, testable)

Reopen this decision when any of the following becomes true:

1. **A real (non-team) user exists**, or the API is pointed at anything but a throwaway testnet deployment.
2. **A second writer appears** — another service, an ops CLI used in a real flow, a party operating their wallet directly, or a permissionless `expire_*` being invoked by third parties as a matter of course.
3. **One incident**: a wrong list status, a missed strike, or a barred party slipping through `initialize`, even once, on a deployment anyone depends on.
4. **More than one API instance** (then the advisory lock and a shared limiter store are prerequisites, not follow-ups).
5. **A consumer that trusts the list without drilling into details** — e.g. an SMS/dashboard alert built on `GET /commitments` state, or any automated decision on cached status.

Until one of those fires, the observed behaviour remains: the mirror is corrected on the next read or API write, the chain stays the source of truth, and no user is relying on the list being current.

## References

- `api/HANDOFF.md` — "What's deliberately deferred" (no background cache refresher), "Design decisions and why" (read-triggered cache, chain is source of truth), "Next steps" item 8.
- `api/README.md` — "What's not built yet" (same caveat, plus its reputation inheritance).
- `api/src/db/commitments.ts`, `api/src/server.ts` (the two refresh call sites), `api/src/reputation.ts`.
- `render.yaml` (single free-tier testnet instance).
- Frontend refresh coverage: `buyer-app/src/App.tsx`, `coop-pwa/src/App.tsx`, `warehouse-app/src/App.tsx` and the section components' `submitTx` calls.
