# api

HarvestLock API (TypeScript/Node, Fastify). Talks to the deployed Soroban
escrow contract via `@stellar/stellar-sdk`, mirrors on-chain state into
Postgres for fast/listable reads, and will eventually own the allocation
ledger's off-chain identity map, voucher issuance/redemption tracking, and
warehouse receipt attestation intake, plus SDP integration (deployed, not
forked — PRD §17.1). None of that last group is built yet — see `HANDOFF.md`
for what's real today versus still ahead.

## Architecture: the API never holds a party's private key

Every write (`lock`, `claim_advance_1`, `settle`, ...) is split into two
calls:

1. `POST /commitments/:contractId/tx/:method` — the API builds and
   simulates the transaction, returns unsigned XDR.
2. The caller's own wallet signs it — buyer, cooperative, or warehouse
   operator, whichever `require_auth()` the contract method actually
   needs (see `HarvestLock-Contracts/contracts/escrow/src/lib.rs`).
3. `POST /transactions/submit` — the API submits the signed envelope,
   polls until it lands, and (optionally, via `refreshContractId`)
   refreshes the Postgres cache from a fresh chain read.

The only private key the API itself holds is `DEPLOYER_SECRET_KEY`, used
solely to pay the network fee for deploying a fresh contract instance per
commitment (`POST /commitments/deploy`) — it is not a party to any
commitment and never signs a lifecycle action. This mirrors PRD §4.6's
rule against surfacing seed phrases to cooperative users, generalized to
every party.

**Two exceptions to the two-step flow above: `cancel` and `reassign_buyer`.**
Both need more than one party's auth on the same call — `cancel` needs
the buyer's and the cooperative's (contracts `HANDOFF.md`, PRD §7);
`reassign_buyer` needs the outgoing buyer's, the cooperative's, *and* the
incoming buyer's (PRD §4.8, plus one signer the PRD line alone wouldn't
require — see the contract's doc comment for why). A single `sign()`
from each party's wallet on the XDR this API returns is **not** enough
for either; naively signing the envelope multiple times fails on
submission (`tx_bad_auth_extra`). Each non-source party has to authorize
their own `SorobanAuthorizationEntry` specifically (`authorizeEntry()` in
`@stellar/stellar-sdk`, or a wallet's equivalent — Freighter and others
expose this for exactly this case), not just sign the envelope.
`test/helpers.ts`'s `submitMultiPartyCall` is a worked, live-tested
example of the correct mechanism for both — sufficient when one script
(a test) holds both keys, but not when the parties are on genuinely
separate devices. **Both `cancel` and `reassign_buyer` now have a real
staged multi-party UX for that case** — see the next section.

### Staged multi-party signing — propose / sign / finalize

One party proposes; every *other* required party signs their own auth
entry from their own wallet, on their own device, in a separate request,
at a separate time — no script or process ever holds more than one key.
Generalized (migration `004_generalize_multisig_proposals.sql`,
`db/pendingMultisigProposals.ts`) to cover both `cancel` (two parties,
one pending entry) and `reassign_buyer` (three parties, two pending
entries) with the same table and the same sign/finalize logic — neither
`src/stellar/multiParty.ts`'s propose/finalize functions nor the sign
route care how many pending entries a proposal has, they just iterate
the array.

1. **Propose** — `POST /commitments/:contractId/tx/cancel/propose { proposerPublicKey }`
   or `POST /commitments/:contractId/tx/reassign-buyer/propose { proposerPublicKey, newBuyer }`.
   Simulates the call sourced from the proposer, sets a ~24-hour
   `signatureExpirationLedger` on each non-source auth entry (simulation
   doesn't set one sensibly on its own — see `src/stellar/multiParty.ts`'s
   doc comment for why that has to happen server-side, before any entry's
   XDR ever reaches a wallet), and stages it in Postgres. Idempotent:
   proposing again while one's already active *for that method* on that
   contract returns the existing one, not a duplicate — `cancel` and
   `reassign_buyer` proposals don't block each other, only proposals of
   the *same* method do. Who's allowed to propose differs by method and
   is checked server-side (403 otherwise): `cancel` accepts the buyer or
   the cooperative; `reassign_buyer` accepts only the *current* buyer
   specifically — reassignment is fundamentally their own decision to
   initiate (PRD §4.8: "with cooperative consent," not
   cooperative-initiated), not something the cooperative or the incoming
   buyer can kick off on someone else's behalf.
2. **Sign** — each other party's wallet signs their own returned entry
   XDR directly, Freighter's `signAuthEntry(entryXdr)`, **not**
   `signTransaction` (this is one auth entry, not a whole transaction) —
   and `POST /commitments/:contractId/tx/propose/:proposalId/sign { signerPublicKey, signedEntryXdr }`
   sends it back. This route is fully method-agnostic (a `proposalId` is
   already a globally unique key, so it doesn't need a method in the
   URL). Once every pending entry across every required party is signed,
   the API rebuilds the final transaction (reusing the original
   simulation's resource footprint, same reasoning `submitMultiPartyCall`
   documents for why re-simulating would mint fresh, unsigned nonces and
   undo the signing already done) and the proposal flips to `ready`.
3. **Finalize** — the proposer signs the `ready_xdr` classically — an
   ordinary signature, no different from any other write in this API —
   and submits it through the **existing** `POST /transactions/submit`,
   passing `completeProposalId` so the proposal gets marked finished
   rather than lingering as "ready" for a future viewer to trip over.
4. **Read** — `GET /commitments/:contractId/tx/cancel/propose` or
   `GET /commitments/:contractId/tx/reassign-buyer/propose` is what a
   viewer's UI polls to render the right state: no active proposal, "X
   wants to [cancel this / reassign this to Y], approve?", "waiting on
   the other party," or "ready to finalize."

Verified live end to end (`test/stellar.test.ts`), through the real HTTP
layer (`app.inject`, not the SDK functions called directly), for both:
`cancel` with two genuinely different signers (propose, an unrelated
third party rejected, sign, a double-sign rejected, finalize, submit,
confirmed `Cancelled` on chain); `reassign_buyer` with three (propose
rejected from an unrelated third party *and* from the cooperative —
proving the "only the current buyer may propose" rule — then a full
propose → cooperative signs → incoming buyer signs → finalize → submit
walk, confirmed the buyer field genuinely changed on a fresh chain read,
not just that submission returned success). Both confirm the proposal no
longer shows as active once completed.

**Two-phase funding, and the default/forfeiture paths built on top of it**
(contracts `HANDOFF.md` has the full detail): `initialize` now also takes
`remainderWindowSecs` and `deliveryWindowSecs`, both validated with their
own floor/ceiling the same way `claimWindowSecs` already was. `lock`
escrows only the deposit now, not the full `totalAmount` — the remainder
is escrowed separately via `fund_remainder` once the cooperative calls
`ready_for_delivery`. `expire_remainder_window` (buyer default — sweeps
escrow to the cooperative) is genuinely permissionless, callable by any
address, not just the two parties to the commitment; `reclaim_on_nondelivery`
(seller non-delivery — returns escrow to the buyer) is buyer-gated. Both
are plain no-arg calls through the generic route above, same as `lock` —
neither needed the multi-party signing path.

**Off-chain reputation/strikes** (`src/reputation.ts`, `src/db/reputation.ts`):
the contract only ever emits a clean terminal status
(`Status::Defaulted`/`Status::Forfeited`) — it has no visibility into a
party's history across other commitments, so consequences live here. A
buyer default bars the buyer's address immediately, on the first
occurrence (`party_standing.barred`); a cooperative forfeiture increments
a strike counter and only bars at three. This is **observation-triggered,
not backed by a chain indexer or background watcher** — the same caveat
already documented below for the commitments cache: a
default/forfeiture nobody ever calls `GET` or
`/transactions/submit?refreshContractId` on won't be recorded until
someone does. `initialize` now rejects (403) if the intended buyer or
cooperative is barred, via `requireNotBarred` — the enforcement half of
the system. `GET /parties/:address/standing` exposes the read side.

## Endpoints, as of this writing

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Liveness check. |
| POST | `/commitments/deploy` | Deploys a fresh, uninitialized escrow contract instance. Deployer-paid, no party auth. |
| POST | `/commitments/:contractId/tx/initialize` | Builds unsigned `initialize` XDR. Must be signed by the intended buyer. Address fields are validated (`StrKey`) before building. |
| POST | `/commitments/:contractId/tx/reassign-buyer` | Builds unsigned `reassign_buyer` XDR. Needs three-party auth — see above. |
| POST | `/commitments/:contractId/tx/confirm-delivery` | Builds unsigned `confirm_delivery` XDR. Takes `deliveredQuantity`/`gradeIndex` (PRD §7 shortfall/grade adjustment — see below). Single-signer (warehouse operator). |
| POST | `/commitments/:contractId/tx/:method` | Builds unsigned XDR for any no-argument lifecycle method (`lock`, `release_advance_1/2`, `claim_advance_1/2`, `reclaim_advance_1/2`, `mark_checkpoint`, `settle`, `cancel`, `ready_for_delivery`, `fund_remainder`, `expire_remainder_window`, `reclaim_on_nondelivery`). `cancel` needs two-party auth — see above, not just a second signature on the same XDR. The four two-phase-funding/forfeiture additions are all single-signer or fully permissionless, so they need nothing extra — see below. |
| POST | `/commitments/:contractId/tx/cancel/propose` | Proposes (or, idempotently, returns the already-active) staged multi-party cancellation. Buyer or cooperative may propose. See above. |
| GET | `/commitments/:contractId/tx/cancel/propose` | The active cancel proposal for a contract, if any — what a viewer's UI polls. |
| POST | `/commitments/:contractId/tx/reassign-buyer/propose` | Proposes (or, idempotently, returns the already-active) staged multi-party reassignment. Only the *current* buyer may propose. Takes `newBuyer`. See above. |
| GET | `/commitments/:contractId/tx/reassign-buyer/propose` | The active reassignment proposal for a contract, if any. |
| POST | `/commitments/:contractId/tx/propose/:proposalId/sign` | Records one party's signed auth entry against any proposal (method-agnostic — the proposal ID is already unique); flips to `ready` once every pending entry across every method is signed. |
| POST | `/transactions/submit` | Submits a signed envelope, polls for confirmation, optionally refreshes the Postgres cache (`refreshContractId`) and/or marks a multisig proposal completed (`completeProposalId`). |
| GET | `/commitments/:contractId` | Live read straight from chain (source of truth), refreshes the cache as a side effect. Also applies any reputation consequence from a fresh transition into `Defaulted`/`Forfeited` — see above. |
| GET | `/commitments` | Lists the Postgres-cached mirror — the only way to list commitments at all, since the chain has no such query. |
| GET | `/parties/:address/standing` | A party's current reputation: strike count, whether they're barred, and why. Returns a clean default (not 404) for an address with no history. |

### Shortfall/grade adjustment (PRD §7)

`initialize` now also takes `contractedQuantity` (a plain number — kg,
or whatever unit the parties agree on off-chain) and `gradePriceBps`
(a pre-agreed grade -> price-multiplier table, in basis points of the
full unit price; index 0 is the top grade). Both are mirrored exactly
from `lib.rs`'s own validation (positive quantity, non-empty schedule,
every entry <= 10_000) — no extra API-level narrowing the way the
three window values get, since there's no business judgment call on
top of what the contract itself already enforces.

`confirm-delivery` takes `deliveredQuantity`/`gradeIndex`; the contract
computes `settlement_bps` (the combined quantity x grade multiplier)
and `settle` pays the cooperative only what's still owed against it —
already-claimed advances are never clawed back, and the buyer gets
back whatever of the funded remainder isn't owed as a shortfall
refund. See `HarvestLock-Contracts/HANDOFF.md`'s Deployment 6 entry for
the exact math, live-verified on testnet.

## Setup

```
npm install
cp .env.example .env   # fill in DATABASE_URL, ESCROW_WASM_HASH, DEPLOYER_SECRET_KEY
npm run migrate
npm run dev
```

`ESCROW_WASM_HASH` is the SHA-256 of the built escrow WASM — get it via
`sha256sum` on `HarvestLock-Contracts/target/wasm32v1-none/release/harvestlock_escrow.wasm`,
or cross-check against a deployed instance with
`stellar contract fetch --id <CONTRACT_ID> --network testnet`.

## Testing

`npm test` runs three suites, all against real infrastructure: `stellar.test.ts`
(**live Stellar testnet**, no mocks, same discipline as the contracts
repo) deploys real throwaway contract instances and builds/submits real
`initialize`/`lock`/`cancel`/`reassign_buyer` transactions — `cancel`
with two genuinely different signers, `reassign_buyer` with three, both
via `test/helpers.ts`'s `submitMultiPartyCall` — asserting on the
resulting on-chain state each time. Same file also covers the two-phase-
funding/forfeiture additions: a full `lock` → `ready_for_delivery` →
`fund_remainder` → `confirm_delivery` → `settle` walk proving `lock` only
escrows the deposit; `expire_remainder_window` triggered by a genuinely
unrelated third-party signer (proving it's really permissionless, not
just "works when I'm also a party"), waited out over a deliberately short
`remainderWindowSecs` in real time; and `reclaim_on_nondelivery` after a
deliberately short `deliveryWindowSecs` lapses with the cooperative never
having acted. Two more scenarios prove the staged multi-party propose/
sign/finalize flow end to end **through the real HTTP layer** (its own
`buildServer()` instance, `app.inject()` — not the SDK functions called
directly, the way every other live scenario in this file works): for
`cancel` — propose, an unrelated third party rejected,
`test/helpers.ts`'s `simulateFreighterSignAuthEntry` (a stand-in for a
real Freighter extension, which doesn't exist in this environment — same
honesty caveat every frontend's `wallet.ts` carries) signs the
cooperative's entry, a double-sign rejected, the proposer finalizes and
submits, confirmed `Cancelled` on chain; for `reassign_buyer` — propose
rejected from an unrelated third party *and* from the cooperative
(proving only the current buyer may propose), then the full three-party
walk (propose → cooperative signs → incoming buyer signs → finalize →
submit), confirmed the buyer field genuinely changed on a fresh chain
read. Both confirm the proposal no longer shows as active once
completed. `retry.test.ts` covers the retry
helper's own logic with deterministic fakes, no network needed;
`server.test.ts` exercises the HTTP layer via Fastify's `.inject()`,
covering validation paths that reject before ever reaching the
network — including dedicated boundary tests for
`remainderWindowSecs`/`deliveryWindowSecs` mirroring `claimWindowSecs`'s
existing ones, and the propose/sign routes' input validation (the
"proposer must actually be a party" business-rule check needs a live
commitment read, so that one case lives in `stellar.test.ts` instead —
see above). This costs real (testnet) transaction submissions and
friendbot funding calls each run — that's the point, it's the only way
to know the SDK usage is actually correct.

A fourth suite, `test/reputation.test.ts`, is **real-Postgres, not live
testnet** — no chain calls, no mocks, hits the same local database the
running server does. Covers the core reputation logic directly: immediate
buyer bar and its idempotency (calling it twice doesn't clobber the
original `barred_at`), the graduated cooperative strike count and the
exact threshold where it bars, and `applyReputationConsequences`'s
no-op cases (status unchanged, or changed but not to a terminal one).
`stellar.test.ts`'s `expire_remainder_window`/`reclaim_on_nondelivery`
tests each end with the same `upsertCommitment` →
`applyReputationConsequences` → `getStanding` sequence the HTTP routes
run, against a real chain read — the integration proof that
`reputation.test.ts`'s narrower, hand-built-`Commitment` coverage
doesn't give on its own.

## What's not built yet

- The allocation-ledger and voucher/SDP pieces mentioned above — nothing
  exists for these yet.
- Auth/sessions for the frontends — out of scope for MVP per PRD, but the
  data model shouldn't assume a single user (see `TASKS.md`).
- No endpoint refreshes the Postgres cache for a contract nobody has
  called `GET /commitments/:contractId` on recently — there's no
  background poller yet, so the list view can go stale for commitments no
  one has viewed. Acceptable for now, worth revisiting once there's real
  usage. The reputation consequences above inherit the exact same gap,
  for the exact same reason.
- The appeals process behind reputation's bar: the contact
  (`samuelojetunde898@gmail.com`) is documented on `site/roles.html`;
  there's no inbox automation or reinstatement workflow here yet,
  deliberately — matches this project's bias against over-building ahead
  of real usage.
See `../TASKS.md` for the full, current backlog and `../HANDOFF.md` for
project-wide state.
