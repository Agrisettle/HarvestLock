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
- **`oracle_config` wired into `initialize`, plus two new read routes** (5 Sept 2026): `HarvestLock-Contracts`' `initialize` gained a 13th, optional argument the same day (`Option<OracleConfig>` — Deployment 8, PRD §16.3's oracle staleness bound) that this API had not been updated to pass at all until now — a real gap `warehouse-app` surfaced (see `TASKS.md`), not one this repo introduced today. `InitializeBody`/`InitializeArgs` gained `oracleConfig?: { oracleContract, priceAsset, maxAgeSecs } | null`, validated the same way `contractedQuantity`/`gradePriceBps` are (mirror the contract's own guards, no extra business judgment). `deploy.ts`'s `oracleConfigToScVal` builds the struct's `ScVal::Map` by hand, same reasoning as `allocationMemberToScVal` — **and** the map's keys have to be in ascending Symbol order (`max_age_secs` < `oracle_contract` < `price_asset`), not struct-declaration order, since Soroban's host rejects an out-of-order `ScVal::Map` as malformed rather than just looking fields up by name regardless of position. `GET .../oracle-config` (`null` if never set — a valid `Ok(None)`, not an error, unlike `get_allocation`'s `AllocationNotSet`) and `GET .../oracle-rate` (a genuine live cross-contract call to the configured Reflector oracle on every request, never cached) round out the read side. Verified by hand against Deployment 8's real testnet WASM before writing the automated test: deploy → build `initialize` with a real Reflector oracle address (`CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W`, GBP) through the actual HTTP route → sign → submit → read both new routes back, config round-tripping exactly and the rate read genuinely live (a fresh timestamp on a second call, not a cached one). `ESCROW_WASM_HASH` bumped locally to Deployment 8's hash to run this (`.env` is gitignored, so this is a local-only change — the committed `.env.example` still has no hash baked in, same as before).
- **Staged multi-party signing — `cancel` and `reassign_buyer`** (`src/stellar/multiParty.ts`, `src/db/pendingMultisigProposals.ts`, migration `004_generalize_multisig_proposals.sql`, generalized from the `cancel`-only `003_pending_cancellations.sql`) — the item that used to say this needed deciding between a server-side staging store and a client-side (QR code / link) hand-off. Decided: server-side staging, since the API is already the coordination point for everything else both frontends do, and no party needs to be near the other or exchange anything out of band. One party proposes (`POST .../tx/cancel/propose` or `POST .../tx/reassign-buyer/propose`); the API simulates, and — the one non-obvious wrinkle — sets a `signatureExpirationLedger` on each non-source auth entry itself, server-side, before that entry's XDR ever reaches a wallet, since simulation doesn't set one sensibly and Freighter's `signAuthEntry(entryXdr)` takes no separate expiration parameter to fill it in later (unlike the SDK's local-signer `authorizeEntry()`, which takes `validUntilLedgerSeq` explicitly). Every other required party signs their own entry via their own wallet and the fully method-agnostic `POST .../tx/propose/:id/sign`; once every pending entry is signed, the API rebuilds the final transaction (same resource-footprint-reuse reasoning `submitMultiPartyCall` already documents) and the proposal flips to `ready`. The proposer then signs the `ready_xdr` classically and submits through the **existing** `/transactions/submit` — deliberately not a new submit endpoint, to keep this feature's added surface area small. `cancel` needs one other signature (buyer or cooperative may propose); `reassign_buyer` needs two (only the *current* buyer may propose — see `api/README.md` for why that's tighter than cancel's either-party rule). `api/README.md` has the full request/response shape. Verified live end to end through the real HTTP layer (`test/stellar.test.ts`, `buildServer()` + `app.inject()`, not the SDK functions called directly) for both methods, including proving the "only the current buyer may propose" rule by having the cooperative's own propose attempt get rejected too, not just an unrelated third party's. Frontend UI exists for `cancel` (`CancelSection.tsx`, both apps); `reassign_buyer`'s is still open — see below.

## What's deliberately deferred

- **The appeals process itself** — a barred party can email `samuelojetunde898@gmail.com` (user-supplied, confirmed for this exact purpose) to contest a bar; the contact is documented on `site/roles.html`. No inbox automation, no ticketing/reinstatement workflow here yet (matches this project's bias against over-building ahead of real usage) — reinstating a barred address today means a human directly updating `party_standing`, not a self-service flow.
- **`allocation_members` table / off-chain identity map** (PRD §16.1) — no schema, no code. Needs the salt-scheme decision from `TASKS.md`'s contracts section resolved first; this is compliance-load-bearing, not just a missing table.
- **A single "create commitment" convenience endpoint** — today, creating a commitment is three calls (`POST /commitments/deploy`, `POST /commitments/:id/tx/initialize`, `POST /transactions/submit`), not one. Left this way on purpose: the buyer has to sign `initialize` with their own wallet, so a one-call version can't exist without either the API holding the buyer's key (rejected, see below) or the frontend doing the multi-step dance anyway. Don't collapse this into one call unless the signing model changes.
- **No background cache refresher** — `GET /commitments` can go stale for a contract nobody has read via `GET /commitments/:contractId` recently, since the cache only refreshes on read or on this API's own writes. Fine for now (no real users yet); revisit once something else can also mutate a contract without going through this API.
- **Auth/sessions** — none. Matches PRD's MVP framing (no auth, no multi-tenant), but the data model doesn't assume a single user, so this can be layered on later.
- **Voucher issuance/redemption, warehouse receipt attestation intake, SDP integration** — mentioned in the original `api/README.md` placeholder as eventual scope; nothing built.
- **A "Propose reassignment" UI for `reassign_buyer`** — the API side is fully built and live-tested (see above), same as `cancel`'s was before its UI landed; neither `coop-pwa` nor `buyer-app` has any UI for `reassign_buyer` at all yet (not even a single-signer form), so this needs more than what `cancel`'s `CancelSection.tsx` needed — a form to collect the new buyer's address, not just a propose/approve/finalize state machine.

## Design decisions and why

- **Build-unsigned/client-signs/submit, not custodial signing.** Checked `lib.rs` directly: `initialize` and `lock` require the buyer's signature, `claim_*` requires the cooperative's, `mark_checkpoint`/`confirm_delivery` require the warehouse operator's, `reclaim_*` requires the buyer's, `settle` requires no specific party. The API cannot hold all three parties' keys without becoming a custodial risk and contradicting PRD §4.6's "no seed phrases" principle — so it only ever builds transactions and never signs anything except the deployer's own fee-paying deploy op. This is the same reasoning as the phone-auth "no seed phrases for farmers" decision, generalized.
- **Deploy is a separate call from initialize**, not one atomic "create commitment." A single atomic call was possible via `Operation.createCustomContract`'s `constructorArgs`, but that requires the contract to expose a Soroban `__constructor` — ours doesn't (`initialize` is a regular method, added before constructor-arg deploys were being planned for). Changing the contract to add a constructor is a contracts-repo decision, not an API one; noted here so nobody "fixes" this by guessing instead of checking.
- **Postgres cache refresh is read-triggered, not source-of-truth.** Chain is authoritative (PRD §17) — every `GET` re-reads live and only *incidentally* updates the cache. This avoids ever serving state the API itself knows is stale, at the cost of no cheap listing freshness guarantee (see deferred items above).

## Known testnet flakiness (not a bug here) — now retried automatically

During `coop-pwa`'s browser check, one `GET /commitments/:contractId` call failed with a 500 — the underlying RPC call reported `Account not found` for an account (the deployer/reader) that had transacted successfully seconds earlier. A retry of the identical request succeeded. A second, different transient failure (a bare `fetch failed`) hit `submitSignedTransaction`'s confirmation poll while building `cancel()`'s test coverage. Both read as transient Soroban-RPC-over-HTTP issues, not defects in this code. Two real occurrences was enough evidence to stop calling this speculative: `src/stellar/retry.ts`'s `withRetry` now wraps the relevant network calls in `client.ts` and `tx.ts`, and the `getTransaction` poll loop tolerates a mid-poll throw instead of aborting. A genuine simulation-level contract error (e.g. reading a truly uninitialized contract) is unaffected — that's a normal return value, not a throw, so it was never retried and still isn't.

**A third occurrence, and the actual gap it was hitting**: while live-testing the reputation feature, the exact same "Account not found" error hit `deployContractInstance`'s `getAccount` call specifically — the one call in `src/stellar/` `withRetry` hadn't reached yet (see "What's real" above). Confirmed via Horizon directly that the account genuinely existed and was current, ruling out "the account actually ran out of funds" as the explanation — this was the RPC node's view lagging, not ledger reality. Also independently observed: running `test/stellar.test.ts`'s full suite back-to-back sometimes hits `fundTestnetAccount`-related failures (friendbot rate limiting under load) that don't reproduce when the same test is run alone — noted here rather than chased further, since retrying the same test in isolation is the practical mitigation and it isn't this code's bug to fix.

**A fourth occurrence, 5 Sept 2026, worth recording precisely**: while writing and verifying the two new oracle-staleness live tests, `fetch failed` errors surfaced with an unusually specific signature — `AggregateError` wrapping both `connect ENETUNREACH` on an IPv6 address and `connect ETIMEDOUT` on the IPv4 fallback, both against `friendbot.stellar.org`'s Cloudflare-fronted IP. `NODE_OPTIONS=--dns-result-order=ipv4first` fixed it on one run (a full pass, both new tests genuinely green), but a same-command retry minutes later hit the identical failure again — inconsistent with a deterministic IPv6-routing bug a flag would reliably paper over, more consistent with this session having hammered `fundTestnetAccount` unusually hard in a short window (one manual end-to-end verification via raw `curl`, then several vitest re-runs) and tripping friendbot's own rate limiting, same root cause as the third occurrence above just manifesting as a connection failure instead of an RPC-level error this time. Deliberately **not** baked into `package.json`'s `test` script on this evidence — a single successful run isn't enough to call the flag a real fix rather than a coincidence, and this file's own convention is to only state what's actually confirmed. The oracle feature itself is verified independent of this: a full manual build → sign → submit → read-config → read-rate walk succeeded twice by hand (see "What's real" above) before any automated test was even written, and the one clean automated run confirmed the same path end to end.

## A real bug this caught, and why it matters for the next person

`scValToNative` resolves a Rust enum variant with no payload (e.g. `Status::Draft`) into a **one-element array** (`['Draft']`), not a bare string. `src/stellar/client.ts` originally cast the result straight to `string` with a comment claiming this was "verified empirically" — it wasn't; the comment was aspirational, not actually checked. `npm test` caught the mismatch on the first real run (`expected 'object' to be 'string'`). Fixed via `unwrapStatus()` in `client.ts`, applied to both `getStatus` and the `status` field inside `getCommitment`. Lesson: a comment claiming empirical verification is not itself verification — the test that ran against the live contract is what actually caught this, not the earlier `scratch-verify.ts` script whose output was eyeballed rather than asserted on.

## Next steps, in priority order

1. The appeals process's actual reinstatement path — today it's "email a human, they update `party_standing` by hand." Fine for zero real users; revisit once there's a first real appeal to learn from.
2. ~~Allocation-ledger schema + salt-scheme decision (blocks `allocation_members`, blocks a real off-chain identity map).~~ **Done** — `db/allocationMembers.ts`, migration `005_allocation_members.sql`. Per-*member* random salts (stronger than the per-contract floor the salt-scheme decision needed), `POST .../tx/set-allocation` + `GET .../allocation` + `DELETE /allocation-members/:memberHash` (NDPA s.34 erasure). See below and `HarvestLock-Contracts/HANDOFF.md`'s Deployment 7.
3. ~~A real write action in a frontend~~ — **done**: `coop-pwa` can claim an advance tranche, `buyer-app` can lock, settle, and create a commitment end to end, all via Freighter. Manual QA against a real, installed Freighter extension is still outstanding — see `coop-pwa/README.md`/`buyer-app/README.md`.
4. ~~A "Cancel this commitment" UI in `coop-pwa` and `buyer-app`~~ — **done**: `CancelSection.tsx` in both apps, propose/approve/finalize, `wallet.ts` gained `signAuthEntry`. See both apps' READMEs.
5. ~~The same staged-signing treatment for `reassign_buyer`~~ — **done, API side**: see above.
6. ~~A "Propose reassignment" UI in `coop-pwa` and `buyer-app`~~ — **done**: `ReassignBuyerSection.tsx` in both apps, same propose/approve/finalize shape as `CancelSection.tsx` generalized to a form (new buyer's address) and two pending signers. See both apps' READMEs.
7. ~~Real attestation-driven settlement (PRD §7 shortfall/grade adjustment)~~ — **done, API side**: `POST .../tx/confirm-delivery` (new route, `deliveredQuantity`/`gradeIndex`), `initialize` gained `contractedQuantity`/`gradePriceBps`. See the endpoints table above and `HarvestLock-Contracts/HANDOFF.md`'s Deployment 6.
8. A background cache-refresh job, once there's a real reason to care about `GET /commitments`/reputation freshness beyond what's already been read.
9. An "allocation ledger" UI in `coop-pwa` — the API side is done (item 2), nothing built for the frontend yet. Would need a form to collect member phone numbers + shares, plus surfacing the recorded ledger somewhere on the commitment detail view.
10. ~~Wire the contract's `oracle_config` into `initialize`~~ — **done**, 5 Sept 2026: see above. `settle` still doesn't consume it (that's a pilot-partner FX-risk decision, not an API gap — see `HarvestLock-Contracts/HANDOFF.md`), and no frontend collects an `oracleConfig` at commitment-creation time yet, but the API surface itself is complete and live-verified.

---
*Last updated: 5 Sept 2026 — wired the contract's new `oracle_config`
(PRD §16.3 oracle staleness bound, `HarvestLock-Contracts` Deployment 8)
into `initialize`, and added `GET .../oracle-config` /
`GET .../oracle-rate`. This closed a real gap `warehouse-app` surfaced:
the contract gained the parameter the same day it was built, but this
API was never updated to pass it at all until now (see "What's real"
above for the full writeup, including the alphabetical-map-key
encoding requirement and the live verification). Three new
network-free validation tests in `server.test.ts`, two new live tests
in `stellar.test.ts` (one clean automated pass confirmed; see "Known
testnet flakiness" for why the other didn't reproduce cleanly and why
that's not treated as evidence against the feature — a full manual
build → sign → submit → read-back walk succeeded by hand, twice,
independent of the automated suite).

Prior entry (4 Sept 2026): wired the contract's PRD §4.8/§16.1
allocation ledger (`HarvestLock-Contracts` Deployment 7) into the API,
and built the off-chain half of it that never existed on the contract
side at all: `db/allocationMembers.ts` (migration
`005_allocation_members.sql`) is the only place a member's phone number
and the random salt that hashed it ever meet. Per-*member* salts, not
just per-contract — stronger than the salt-scheme decision TASKS.md
flagged as compliance-load-bearing needed. `POST .../tx/set-allocation`
builds the unsigned XDR and stages (doesn't yet persist) the
phone-number mapping; the caller passes the staged members back to
`/transactions/submit` (`allocationContractId`/`allocationMembers`),
which only persists them once the on-chain call is actually confirmed
— so a proposal that's built but never submitted can't leave an
orphaned off-chain row referencing a hash nobody put on-chain.
`GET .../allocation` reads on-chain (source of truth, never returns a
phone number — this contract never stores one). `DELETE
/allocation-members/:memberHash` is the actual NDPA s.34 erasure
mechanism: nulls the phone number, leaves the hash/share intact, makes
the on-chain entry permanently unlinkable to a real person.

Also fixed a real bug found while building this: `set_allocation`
takes a `Vec<AllocationMember>` struct argument, and `nativeToScVal`'s
automatic object-to-map inference gets the numeric type wrong (defaults
a plain number to `u64`; the contract's `share_bps` is `u32`) — silently,
no error, just a type mismatch that would fail on-chain. Built the
struct's `ScMap` encoding by hand instead (`allocationMemberToScVal` in
`server.ts`) and verified it against a real deployed contract via
`simulateTransaction` before ever wiring it into a route. Separately,
`scValToNative` decodes a `BytesN` as a `Uint8Array`, not a Node
`Buffer` — `Uint8Array.prototype.toString("hex")` silently ignores the
argument and returns a comma-joined decimal list instead of throwing,
which the live end-to-end test caught immediately (a `toEqual` assertion
failure, not a crash) before it could reach anything real.

70/70 tests overall (new: 5 in `test/allocationMembers.test.ts` against
real Postgres, 8 network-free validation tests in `server.test.ts`, 1
live end-to-end scenario in `stellar.test.ts`), including
a full live scenario through the real HTTP layer: build → sign → submit
→ on-chain read confirms the exact hashes/shares landed → off-chain
Postgres read confirms the phone numbers were persisted → erasure via
the real `DELETE` endpoint → on-chain read afterward proves the hash
entry is completely unaffected by off-chain erasure, only the phone
number behind it is gone.

Prior entry (3 Sept 2026): wired the contract's PRD §7 shortfall/grade
adjustment schedule (`HarvestLock-Contracts` Deployment 6) into the API:
`initialize` gained `contractedQuantity`/`gradePriceBps` (mirrored
exactly from `lib.rs`'s own validation — positive quantity, non-empty
schedule, every entry <= 10_000, no extra API-level narrowing since
there's no business judgment call on top of what the contract already
enforces). `confirm_delivery` moved out of `NO_ARG_METHODS` into its own
route (`POST .../tx/confirm-delivery`, `deliveredQuantity`/`gradeIndex`)
— same reason `initialize`/`reassign_buyer` already have their own
routes, once a method takes arguments the generic no-arg builder can't
serve it. Single-signer (warehouse operator only), no multi-party
staging needed. `stellar.test.ts`'s existing two-phase-funding scenario
updated to pass real args through `confirm_delivery` instead of none;
6 new validation tests in `server.test.ts`. `ESCROW_WASM_HASH` bumped
to the new deployment's hash in both `.env` and the root `render.yaml`
blueprint.
Prior entry: generalized the staged multi-party
propose/sign/finalize mechanism from `cancel`-only to also cover
`reassign_buyer`'s three-party case (`src/db/pendingMultisigProposals.ts`,
migration `004_generalize_multisig_proposals.sql`, renaming
`pending_cancellations` → `pending_multisig_proposals` and adding a
`method` column — a clean rename, not a data migration, since this is a
testnet-only table). `multiParty.ts`'s propose/finalize functions turned
out to already be generic enough (just needed an `args` parameter added
for `reassign_buyer`'s `new_buyer` argument); the sign route is now
fully method-agnostic (`POST .../tx/propose/:id/sign`, no method in the
URL, since a proposal ID is already globally unique) while propose/read
stayed per-method (`.../tx/reassign-buyer/propose`) since each method
has different arguments and a different "who's allowed to propose" rule
— `reassign_buyer` restricts proposing to the *current* buyer
specifically, unlike `cancel`'s either-party rule, since PRD §4.8 frames
reassignment as the outgoing buyer's own decision to initiate. 50/50
tests, including a full live three-party walk through the real HTTP
layer proving both the propose-rejection rule (cooperative's own
attempt rejected, not just an unrelated party's) and the end-to-end
propose → cooperative signs → incoming buyer signs → finalize → submit
→ buyer-actually-changed loop on real testnet.
*Addendum, later same day: frontend UI followed* — `ReassignBuyerSection.tsx`
in both `coop-pwa` and `buyer-app` (identical, same convention as
`CancelSection.tsx`), reusing `signAuthEntry`/`signTransactionXdr` from
`wallet.ts`. Two real differences from `CancelSection.tsx`'s shape: the
propose step is a form (collects the new buyer's address, since only the
current buyer may propose) rather than a bare button, and there are two
pending signers instead of one. `justApproved` local component state
covers a real gap — the API's `pending_entries` stops naming a signer
once they've signed, so without it a signer who'd just approved would
appear to drop out of the flow entirely; not solved for page-reload
recovery, a deliberate, documented gap. 7 new component tests each app;
both apps' `App.test.tsx` fetch-mock chains updated for the new
component's background poll, same fix shape `CancelSection`'s rollout
needed. See both apps' READMEs and `TASKS.md`.
Prior entry: staged
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
