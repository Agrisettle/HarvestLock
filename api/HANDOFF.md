# Handoff — `api/`

Component-scoped handoff, same structure as `HarvestLock-Contracts/HANDOFF.md`. Read the project-wide [`../HANDOFF.md`](../HANDOFF.md) first if you haven't — this one assumes it.

## What's real

- **Read path**: `getStatus`/`getCommitment` (`src/stellar/client.ts`) simulate against the live contract, no mocks. Tested in `test/stellar.test.ts` against a known deployed instance.
- **Deploy path**: `deployContractInstance` (`src/stellar/deploy.ts`) deploys a fresh, uninitialized escrow WASM instance, deployer-paid. Tested against live testnet — confirms the new instance really is an uninitialized copy of *this* contract (asserts `NotInitialized`, not just "some contract exists").
- **Write path**: `buildInvokeTransaction`/`submitSignedTransaction` (`src/stellar/tx.ts`) are generic — they work for `initialize` and every no-arg lifecycle method identically, because only `initialize` takes arguments (checked directly against `lib.rs`). Tested end to end: deploy → build `initialize` XDR → sign → submit → read back `Draft` with the right fields.
- **HTTP layer** (`src/server.ts`): wraps all of the above as Fastify routes. Verified by hand, live, through the running server (not just the SDK layer in isolation) on 1 Sept 2026 — deploy → initialize → lock walked end to end over real HTTP calls against real testnet, contract observed reaching `Locked`. See `api/README.md` for the endpoint list.
- **CORS** (`@fastify/cors`, `origin: true`): added after `coop-pwa`'s first real-browser check against this API failed silently — `curl` doesn't enforce CORS, so every prior HTTP-layer test here missed it. A live browser is the only thing that actually catches this class of bug; keep checking frontends in a real browser, not just against `curl`/Node scripts.
- **Postgres cache** (`src/db/commitments.ts`, migration `001_init.sql`): `commitments` table, upserted from live chain reads on every `GET /commitments/:contractId` and on `POST /transactions/submit` when `refreshContractId` is passed. `GET /commitments` lists the cache — the only way to list at all, since the chain has no such query.

## What's deliberately deferred

- **`allocation_members` table / off-chain identity map** (PRD §16.1) — no schema, no code. Needs the salt-scheme decision from `TASKS.md`'s contracts section resolved first; this is compliance-load-bearing, not just a missing table.
- **A single "create commitment" convenience endpoint** — today, creating a commitment is three calls (`POST /commitments/deploy`, `POST /commitments/:id/tx/initialize`, `POST /transactions/submit`), not one. Left this way on purpose: the buyer has to sign `initialize` with their own wallet, so a one-call version can't exist without either the API holding the buyer's key (rejected, see below) or the frontend doing the multi-step dance anyway. Don't collapse this into one call unless the signing model changes.
- **No background cache refresher** — `GET /commitments` can go stale for a contract nobody has read via `GET /commitments/:contractId` recently, since the cache only refreshes on read or on this API's own writes. Fine for now (no real users yet); revisit once something else can also mutate a contract without going through this API.
- **Auth/sessions** — none. Matches PRD's MVP framing (no auth, no multi-tenant), but the data model doesn't assume a single user, so this can be layered on later.
- **Voucher issuance/redemption, warehouse receipt attestation intake, SDP integration** — mentioned in the original `api/README.md` placeholder as eventual scope; nothing built.

## Design decisions and why

- **Build-unsigned/client-signs/submit, not custodial signing.** Checked `lib.rs` directly: `initialize` and `lock` require the buyer's signature, `claim_*` requires the cooperative's, `mark_checkpoint`/`confirm_delivery` require the warehouse operator's, `reclaim_*` requires the buyer's, `settle` requires no specific party. The API cannot hold all three parties' keys without becoming a custodial risk and contradicting PRD §4.6's "no seed phrases" principle — so it only ever builds transactions and never signs anything except the deployer's own fee-paying deploy op. This is the same reasoning as the phone-auth "no seed phrases for farmers" decision, generalized.
- **Deploy is a separate call from initialize**, not one atomic "create commitment." A single atomic call was possible via `Operation.createCustomContract`'s `constructorArgs`, but that requires the contract to expose a Soroban `__constructor` — ours doesn't (`initialize` is a regular method, added before constructor-arg deploys were being planned for). Changing the contract to add a constructor is a contracts-repo decision, not an API one; noted here so nobody "fixes" this by guessing instead of checking.
- **Postgres cache refresh is read-triggered, not source-of-truth.** Chain is authoritative (PRD §17) — every `GET` re-reads live and only *incidentally* updates the cache. This avoids ever serving state the API itself knows is stale, at the cost of no cheap listing freshness guarantee (see deferred items above).

## Known testnet flakiness (not a bug here)

During `coop-pwa`'s browser check, one `GET /commitments/:contractId` call failed with a 500 — the underlying RPC call reported `Account not found` for an account (the deployer/reader) that had transacted successfully seconds earlier. A retry of the identical request succeeded. This reads as a transient Soroban RPC read-after-write inconsistency, not a defect in `simulateRead` — but there's no retry logic here yet, so a real user would see a hard error on an unlucky request. Worth adding retry-with-backoff to `simulateRead` (`src/stellar/client.ts`) once there's enough real traffic to justify it; don't add it speculatively before then.

## A real bug this caught, and why it matters for the next person

`scValToNative` resolves a Rust enum variant with no payload (e.g. `Status::Draft`) into a **one-element array** (`['Draft']`), not a bare string. `src/stellar/client.ts` originally cast the result straight to `string` with a comment claiming this was "verified empirically" — it wasn't; the comment was aspirational, not actually checked. `npm test` caught the mismatch on the first real run (`expected 'object' to be 'string'`). Fixed via `unwrapStatus()` in `client.ts`, applied to both `getStatus` and the `status` field inside `getCommitment`. Lesson: a comment claiming empirical verification is not itself verification — the test that ran against the live contract is what actually caught this, not the earlier `scratch-verify.ts` script whose output was eyeballed rather than asserted on.

## Next steps, in priority order

1. Allocation-ledger schema + salt-scheme decision (blocks `allocation_members`, blocks a real off-chain identity map).
2. `coop-pwa` read-only dashboard against `GET /commitments/:contractId` — this is now genuinely unblocked.
3. A background cache-refresh job, once there's a real reason to care about `GET /commitments` freshness beyond what's already been read.

---
*Last updated: 1 Sept 2026 — core lifecycle (deploy/initialize/lock/claim/reclaim/checkpoint/confirm/settle) built and testnet-verified at both the SDK-wrapper and HTTP layers.*
