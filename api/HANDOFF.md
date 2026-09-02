# Handoff — `api/`

Component-scoped handoff, same structure as `HarvestLock-Contracts/HANDOFF.md`. Read the project-wide [`../HANDOFF.md`](../HANDOFF.md) first if you haven't — this one assumes it.

## What's real

- **Read path**: `getStatus`/`getCommitment` (`src/stellar/client.ts`) simulate against the live contract, no mocks. Tested in `test/stellar.test.ts` against a known deployed instance. `Commitment` now also carries `remainder_window_secs`, `delivery_deadline`, `remainder_deadline`, `remainder_funded` — see below.
- **Deploy path**: `deployContractInstance` (`src/stellar/deploy.ts`) deploys a fresh, uninitialized escrow WASM instance, deployer-paid. Tested against live testnet — confirms the new instance really is an uninitialized copy of *this* contract (asserts `NotInitialized`, not just "some contract exists").
- **Write path**: `buildInvokeTransaction`/`submitSignedTransaction` (`src/stellar/tx.ts`) are generic — they work for `initialize` and every no-arg lifecycle method identically, because only `initialize` (and `reassign_buyer`) take arguments (checked directly against `lib.rs`). Tested end to end: deploy → build `initialize` XDR → sign → submit → read back `Draft` with the right fields. **Except `cancel`** — see below, it needs a genuinely different signing path.
- **`cancel`** (mutual unwind, requires both buyer's and cooperative's auth): wired into the same `/tx/:method` route as every other no-arg method, but the generic single-signer build/submit flow does **not** correctly handle it — see `api/test/helpers.ts`'s `submitMultiPartyCall` for the real mechanism (per-entry `authorizeEntry()`, not `Transaction.sign()` per party) and `HarvestLock-Contracts/HANDOFF.md`'s "Verified on testnet" section for the two false starts that preceded finding it. Verified live with two genuinely different, freshly-funded signers.
- **`reassign_buyer`** (buyer-position assignability, requires outgoing buyer + cooperative + incoming buyer, three parties): its own route (`POST /commitments/:contractId/tx/reassign-buyer`, since it takes an argument) reusing the same `buildInvokeTransaction`; submission reuses `submitMultiPartyCall` unchanged except for a new optional `args` param. Verified live with three genuinely different signers, including a functional check that the buyer field actually changed, not just that submission returned success.
- **Two-phase funding + buyer-default/seller-non-delivery forfeiture** (`ready_for_delivery`, `fund_remainder`, `expire_remainder_window`, `reclaim_on_nondelivery` — contracts `HANDOFF.md` has the contract-level detail): all four are no-arg and single-signer-or-permissionless, so they went straight into the existing `NO_ARG_METHODS` set in `server.ts` — no new route, no multi-party signing path needed, unlike `cancel`/`reassign_buyer`. `initialize` grew two new required params, `remainderWindowSecs` and `deliveryWindowSecs`, each with its own API-level floor/ceiling (`server.ts`) matching the existing `claimWindowSecs` pattern — 1hr–30day and 1day–365day respectively, engineering defaults not researched values, same caveat as `claimWindowSecs`'s. `test/stellar.test.ts` covers three live scenarios: the full two-phase-funding happy path (asserting `remainder_funded` flips and `confirm_delivery` is genuinely rejected before it does), `expire_remainder_window` triggered by a **third signer that is neither the buyer nor the cooperative** (the actual proof it's permissionless, not just an assumption), and `reclaim_on_nondelivery` after a deliberately short `deliveryWindowSecs` lapses with the cooperative never having acted — both deadline tests wait out a real, short window rather than mocking time, same as the contract-level testnet walk.
- **Address-field validation** (`requireValidPublicKey`, alongside the existing `requireValidContractId`): every G-address field on `initialize` and `reassign-buyer` is checked against `StrKey.isValidEd25519PublicKey` before a transaction is built — same malformed-input-should-be-400-not-500 principle as the contract-ID fix, applied to the other address type.
- **HTTP layer** (`src/server.ts`): wraps all of the above as Fastify routes. Verified by hand, live, through the running server (not just the SDK layer in isolation) on 1 Sept 2026 — deploy → initialize → lock walked end to end over real HTTP calls against real testnet, contract observed reaching `Locked`. See `api/README.md` for the endpoint list.
- **CORS** (`@fastify/cors`, `origin: true`): added after `coop-pwa`'s first real-browser check against this API failed silently — `curl` doesn't enforce CORS, so every prior HTTP-layer test here missed it. A live browser is the only thing that actually catches this class of bug; keep checking frontends in a real browser, not just against `curl`/Node scripts.
- **Postgres cache** (`src/db/commitments.ts`, migration `001_init.sql`): `commitments` table, upserted from live chain reads on every `GET /commitments/:contractId` and on `POST /transactions/submit` when `refreshContractId` is passed. `GET /commitments` lists the cache — the only way to list at all, since the chain has no such query. Deliberately still summary-only — the new per-commitment deadline/funded fields (`remainder_deadline`, `remainder_funded`, `delivery_deadline`, etc.) are exposed only via the live `GET /commitments/:contractId` read, same as the tranche-deadline fields already weren't cached; no migration needed for this feature.
- **Off-chain reputation/strikes** (`src/reputation.ts`, `src/db/reputation.ts`, migration `002_reputation.sql`): the contract only ever emits a clean terminal status (`Status::Defaulted`/`Status::Forfeited`) — no visibility into a party's history across other commitments, so consequences are tracked here, per this session's product decision (`TASKS.md`). `party_standing` is one denormalized row per address (strike count, barred flag, reason, timestamp); `standing_events` is a pure audit log for a human reviewing an appeal, not the source of truth for current state. `recordBuyerDefault` bars immediately and is idempotent (a second call for an already-barred address doesn't overwrite the original `barred_at`); `recordCooperativeForfeiture` increments a strike counter and only bars at three. `applyReputationConsequences` is the orchestration point: called after `upsertCommitment` returns the *previous* cached status (a new field on its return value, `UpsertResult`, read inside the same transaction as the write so two concurrent refreshes of the same contract can't double-apply a consequence), it fires exactly once per fresh transition into a terminal status. Wired into both `upsertCommitment` call sites in `server.ts` (`GET /commitments/:contractId` and `/transactions/submit`'s `refreshContractId` path). `requireNotBarred` is the enforcement half — checked for both `buyer` and `cooperative` on `initialize`, rejects with 403 before a transaction is even built. `GET /parties/:address/standing` exposes the read side, returning a clean default rather than 404 for an address with no history. **Same observation-triggered caveat as the commitments cache**: nothing here is backed by a chain indexer, so a default/forfeiture nobody ever reads via this API won't be recorded until someone does.
- **`deploy.ts` retry hardening** — found while live-testing the reputation feature: `deployContractInstance`'s `server.getAccount()` call was the one Soroban RPC call in `src/stellar/` that hadn't been wrapped in `withRetry`, unlike the equivalent calls in `client.ts` and `tx.ts`. It hit the exact "Account not found" flakiness this file already documents below — repeatedly, since `deployContractInstance` runs first in nearly every test, so one unretried transient failure there took the whole test down with it. Now wrapped, along with `simulateTransaction` and the `getTransaction` confirmation poll (which gained the same mid-poll-throw tolerance `tx.ts`'s equivalent loop already had). A real, reproducible gap this session's live testing surfaced, not a hypothetical.
- **Staged multi-party signing for `cancel`** (`src/stellar/multiParty.ts`, `src/db/pendingCancellations.ts`, migration `003_pending_cancellations.sql`) — the item directly below used to say this needed deciding between a server-side staging store and a client-side (QR code / link) hand-off. Decided: server-side staging, since the API is already the coordination point for everything else both frontends do, and neither party needs to be near the other or exchange anything out of band. Either party proposes (`POST .../tx/cancel/propose`); the API simulates, and — this is the one non-obvious wrinkle — sets a `signatureExpirationLedger` on the non-source auth entry itself, server-side, before that entry's XDR ever reaches a wallet, since simulation doesn't set one sensibly and Freighter's `signAuthEntry(entryXdr)` takes no separate expiration parameter to fill it in later (unlike the SDK's local-signer `authorizeEntry()`, which takes `validUntilLedgerSeq` explicitly). The other party signs that entry via their own wallet and `POST .../propose/:id/sign`; once every pending entry is signed, the API rebuilds the final transaction (same resource-footprint-reuse reasoning `submitMultiPartyCall` already documents) and the proposal flips to `ready`. The proposer then signs the `ready_xdr` classically and submits through the **existing** `/transactions/submit` — deliberately not a new submit endpoint, to keep this feature's added surface area small. `api/README.md` has the full request/response shape. Verified live end to end through the real HTTP layer (`test/stellar.test.ts`, `buildServer()` + `app.inject()`, not the SDK functions called directly): propose, an unrelated third party rejected, sign via `test/helpers.ts`'s new `simulateFreighterSignAuthEntry` (a stand-in for a real Freighter extension — same "not available in this environment" caveat every frontend `wallet.ts` already carries), a double-sign rejected, finalize, submit, confirmed `Cancelled` on chain. Frontend UI for both apps followed shortly after — see below.

## What's deliberately deferred

- **The appeals process itself** — a barred party can email `samuelojetunde898@gmail.com` (user-supplied, confirmed for this exact purpose) to contest a bar; the contact is documented on `site/roles.html`. No inbox automation, no ticketing/reinstatement workflow here yet (matches this project's bias against over-building ahead of real usage) — reinstating a barred address today means a human directly updating `party_standing`, not a self-service flow.
- **`allocation_members` table / off-chain identity map** (PRD §16.1) — no schema, no code. Needs the salt-scheme decision from `TASKS.md`'s contracts section resolved first; this is compliance-load-bearing, not just a missing table.
- **A single "create commitment" convenience endpoint** — today, creating a commitment is three calls (`POST /commitments/deploy`, `POST /commitments/:id/tx/initialize`, `POST /transactions/submit`), not one. Left this way on purpose: the buyer has to sign `initialize` with their own wallet, so a one-call version can't exist without either the API holding the buyer's key (rejected, see below) or the frontend doing the multi-step dance anyway. Don't collapse this into one call unless the signing model changes.
- **No background cache refresher** — `GET /commitments` can go stale for a contract nobody has read via `GET /commitments/:contractId` recently, since the cache only refreshes on read or on this API's own writes. Fine for now (no real users yet); revisit once something else can also mutate a contract without going through this API.
- **Auth/sessions** — none. Matches PRD's MVP framing (no auth, no multi-tenant), but the data model doesn't assume a single user, so this can be layered on later.
- **Voucher issuance/redemption, warehouse receipt attestation intake, SDP integration** — mentioned in the original `api/README.md` placeholder as eventual scope; nothing built.
- **The same staged-signing UX for `reassign_buyer`** — only `cancel` got it (see above). `reassign_buyer` needs three signers instead of two, but the same mechanism (propose, each non-source party signs their own entry, proposer finalizes) would extend to it; nothing built for that case yet.

## Design decisions and why

- **Build-unsigned/client-signs/submit, not custodial signing.** Checked `lib.rs` directly: `initialize` and `lock` require the buyer's signature, `claim_*` requires the cooperative's, `mark_checkpoint`/`confirm_delivery` require the warehouse operator's, `reclaim_*` requires the buyer's, `settle` requires no specific party. The API cannot hold all three parties' keys without becoming a custodial risk and contradicting PRD §4.6's "no seed phrases" principle — so it only ever builds transactions and never signs anything except the deployer's own fee-paying deploy op. This is the same reasoning as the phone-auth "no seed phrases for farmers" decision, generalized.
- **Deploy is a separate call from initialize**, not one atomic "create commitment." A single atomic call was possible via `Operation.createCustomContract`'s `constructorArgs`, but that requires the contract to expose a Soroban `__constructor` — ours doesn't (`initialize` is a regular method, added before constructor-arg deploys were being planned for). Changing the contract to add a constructor is a contracts-repo decision, not an API one; noted here so nobody "fixes" this by guessing instead of checking.
- **Postgres cache refresh is read-triggered, not source-of-truth.** Chain is authoritative (PRD §17) — every `GET` re-reads live and only *incidentally* updates the cache. This avoids ever serving state the API itself knows is stale, at the cost of no cheap listing freshness guarantee (see deferred items above).

## Known testnet flakiness (not a bug here) — now retried automatically

During `coop-pwa`'s browser check, one `GET /commitments/:contractId` call failed with a 500 — the underlying RPC call reported `Account not found` for an account (the deployer/reader) that had transacted successfully seconds earlier. A retry of the identical request succeeded. A second, different transient failure (a bare `fetch failed`) hit `submitSignedTransaction`'s confirmation poll while building `cancel()`'s test coverage. Both read as transient Soroban-RPC-over-HTTP issues, not defects in this code. Two real occurrences was enough evidence to stop calling this speculative: `src/stellar/retry.ts`'s `withRetry` now wraps the relevant network calls in `client.ts` and `tx.ts`, and the `getTransaction` poll loop tolerates a mid-poll throw instead of aborting. A genuine simulation-level contract error (e.g. reading a truly uninitialized contract) is unaffected — that's a normal return value, not a throw, so it was never retried and still isn't.

**A third occurrence, and the actual gap it was hitting**: while live-testing the reputation feature, the exact same "Account not found" error hit `deployContractInstance`'s `getAccount` call specifically — the one call in `src/stellar/` `withRetry` hadn't reached yet (see "What's real" above). Confirmed via Horizon directly that the account genuinely existed and was current, ruling out "the account actually ran out of funds" as the explanation — this was the RPC node's view lagging, not ledger reality. Also independently observed: running `test/stellar.test.ts`'s full suite back-to-back sometimes hits `fundTestnetAccount`-related failures (friendbot rate limiting under load) that don't reproduce when the same test is run alone — noted here rather than chased further, since retrying the same test in isolation is the practical mitigation and it isn't this code's bug to fix.

## A real bug this caught, and why it matters for the next person

`scValToNative` resolves a Rust enum variant with no payload (e.g. `Status::Draft`) into a **one-element array** (`['Draft']`), not a bare string. `src/stellar/client.ts` originally cast the result straight to `string` with a comment claiming this was "verified empirically" — it wasn't; the comment was aspirational, not actually checked. `npm test` caught the mismatch on the first real run (`expected 'object' to be 'string'`). Fixed via `unwrapStatus()` in `client.ts`, applied to both `getStatus` and the `status` field inside `getCommitment`. Lesson: a comment claiming empirical verification is not itself verification — the test that ran against the live contract is what actually caught this, not the earlier `scratch-verify.ts` script whose output was eyeballed rather than asserted on.

## Next steps, in priority order

1. The appeals process's actual reinstatement path — today it's "email a human, they update `party_standing` by hand." Fine for zero real users; revisit once there's a first real appeal to learn from.
2. Allocation-ledger schema + salt-scheme decision (blocks `allocation_members`, blocks a real off-chain identity map).
3. The same staged-signing treatment for `reassign_buyer` (three parties instead of two) — the mechanism is proven end to end now (both API and frontend, via `cancel`); `reassign_buyer` doesn't have any frontend entry point yet at all, so this would need to start from scratch on that side too.
4. ~~A real write action in a frontend~~ — **done**: `coop-pwa` can claim an advance tranche, `buyer-app` can lock, settle, and create a commitment end to end, all via Freighter. Manual QA against a real, installed Freighter extension is still outstanding — see `coop-pwa/README.md`/`buyer-app/README.md`.
5. ~~A "Cancel this commitment" UI in `coop-pwa` and `buyer-app`~~ — **done**: `CancelSection.tsx` in both apps, propose/approve/finalize, `wallet.ts` gained `signAuthEntry`. See both apps' READMEs.
6. A background cache-refresh job, once there's a real reason to care about `GET /commitments`/reputation freshness beyond what's already been read.

---
*Last updated: 2 Sept 2026 (later same day, third time) — staged
multi-party signing for `cancel`: propose/sign/finalize
(`src/stellar/multiParty.ts`, `src/db/pendingCancellations.ts`, migration
`003_pending_cancellations.sql`). Either party proposes; the *other*
signs their own Soroban auth entry from their own wallet in a separate
request (Freighter's `signAuthEntry`, not `signTransaction`); the
proposer finalizes through the existing `/transactions/submit`. The one
real wrinkle: simulation doesn't set a sensible `signatureExpirationLedger`
on its own, and Freighter's `signAuthEntry` takes no parameter to supply
one later, so `multiParty.ts` sets it server-side before any entry XDR
reaches a wallet — verified correct with an offline round-trip (set →
serialize → deserialize → sign → inspect) before touching live network.
45/45 tests passing, including a new end-to-end scenario through the
real HTTP layer (`buildServer()` + `app.inject()`, not the SDK called
directly) proving the full propose → an unrelated party rejected → sign
→ finalize → submit → `Cancelled` loop on real testnet, plus
network-free validation coverage in `server.test.ts`. This was the
"decide between a server-side store and a client-side hand-off" item —
decided: server-side, since the API already coordinates everything else
both frontends do.
*Addendum, later same day: frontend UI followed* — `CancelSection.tsx`
in both `coop-pwa` and `buyer-app` (identical, same small-duplication
convention as `wallet.ts`/`api.ts`), `signAuthEntry` added to both apps'
`wallet.ts`, 7 new component tests each. See both apps' READMEs and
`TASKS.md`.
Prior entry: off-chain reputation/
strikes tracking (`src/reputation.ts`, `src/db/reputation.ts`, migration
`002_reputation.sql`): immediate buyer bar on `Status::Defaulted`,
graduated 3-strike cooperative bar on `Status::Forfeited`, both applied
exactly once via `applyReputationConsequences` reading the previous
cached status `upsertCommitment` now returns alongside the row.
`initialize` rejects a barred buyer/cooperative with 403
(`requireNotBarred`); new `GET /parties/:address/standing` exposes the
read side. 39/39 tests passing across all four suites, including a new
real-Postgres-only `test/reputation.test.ts` (10 tests) and two extended
live-testnet scenarios in `stellar.test.ts` proving the full
chain-read → cache → consequence loop end to end. Also fixed a real gap
this session's live testing surfaced: `deployContractInstance`'s
`getAccount` call was the one Soroban RPC call in `src/stellar/` not
wrapped in `withRetry`, so it took the documented "Account not found"
flakiness (below) down with it — now retried, along with
`simulateTransaction` and a hardened `getTransaction` poll matching
`tx.ts`'s existing one.
Prior entry: wired the contract's two-phase-funding/default-forfeiture
additions (`ready_for_delivery`, `fund_remainder`,
`expire_remainder_window`, `reclaim_on_nondelivery`) into the existing
generic no-arg route (all four are single-signer or permissionless — no
new multi-party path needed), added `remainderWindowSecs`/
`deliveryWindowSecs` to `initialize` with their own API-level bounds, and
extended `Commitment`'s type/serialization for the new fields.
`test/stellar.test.ts` gained three new live-testnet scenarios (26/26
passing overall): the full two-phase-funding happy path,
`expire_remainder_window` triggered by a genuinely unrelated third-party
signer, and `reclaim_on_nondelivery` after a real (short, deliberately)
delivery-deadline lapse. Also fixed the exact process gap contracts
`HANDOFF.md` warned about: `.env`'s `ESCROW_WASM_HASH` was still
pointing at deployment 4 (the pre-two-phase-funding WASM), which made
every new test fail with `MismatchingParameterLen` until updated to
deployment 5's hash.
Before that: `reassign_buyer` (buyer-position assignability) added: its own route, three-party signing verified live via `submitMultiPartyCall` (now extended to support method args). Address-field validation added to `initialize`/`reassign-buyer` (G-addresses), matching the earlier contract-ID fix. Earlier still: core lifecycle (deploy/initialize/lock/claim/reclaim/checkpoint/confirm/settle) built and testnet-verified at both the SDK-wrapper and HTTP layers; `cancel` added and verified live with two genuinely different signers (see `test/helpers.ts`) — the first method needing real multi-party Soroban auth, and the first place the generic single-signer build/submit design didn't just work unchanged.*
