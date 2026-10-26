# api

HarvestLock API (TypeScript/Node, Fastify). Talks to the deployed Soroban
escrow contract via `@stellar/stellar-sdk`, mirrors on-chain state into
Postgres for fast/listable reads, and will eventually own the allocation
ledger's off-chain identity map, voucher issuance/redemption tracking, and
warehouse receipt attestation intake, plus SDP integration (deployed, not
forked — PRD §17.1). None of that last group is built yet — see `HANDOFF.md`
for what's real today versus still ahead.

Every contract `Status` and `Error` variant a caller can see — a `status`
field's value, or an `Error(Contract, #N)` rejection — is decoded into
plain English in [`../docs/contract-glossary.md`](../docs/contract-glossary.md).

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

A Mermaid sequence diagram of the full three-party `reassign_buyer` walk
(propose → each other party signs → finalize → submit), with per-step
file/line references and the enforced edge cases, is in
[`docs/reassign-buyer-sequence.md`](./docs/reassign-buyer-sequence.md).
The two-party `cancel` walk is in
[`docs/cancel-sequence.md`](./docs/cancel-sequence.md), and the
`flag_dispute` → `resolve_dispute` / `expire_dispute_window` flow is in
[`docs/dispute-sequence.md`](./docs/dispute-sequence.md).

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

The OpenAPI 3.1 description is in [`openapi.yaml`](./openapi.yaml). It is
checked against the route registrations in `src/server.ts`; update it in
the same change whenever an endpoint or request/response shape changes.

A Postman/Insomnia collection with a request for every route lives in
[`postman/`](./postman/README.md); `test/postmanCollection.test.ts` fails if it
drifts from `src/server.ts`.

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Liveness check. |
| GET | `/version` | Build-time commit SHA and UTC build timestamp. Does not depend on Postgres. |
| POST | `/commitments/deploy` | Deploys a fresh, uninitialized escrow contract instance. Deployer-paid, no party auth. |
| POST | `/commitments/:contractId/tx/initialize` | Builds unsigned `initialize` XDR. Must be signed by the intended buyer. Address fields are validated (`StrKey`) before building. Optionally takes `oracleConfig` (PRD §16.3 oracle staleness bound — see below); omit or pass `null` for a plain deal that needs no conversion. |
| POST | `/commitments/:contractId/tx/reassign-buyer` | Builds unsigned `reassign_buyer` XDR. Needs three-party auth — see above. |
| POST | `/commitments/:contractId/tx/confirm-delivery` | Builds unsigned `confirm_delivery` XDR. Takes `deliveredQuantity`/`gradeIndex` (PRD §7 shortfall/grade adjustment — see below). Single-signer (warehouse operator). |
| POST | `/commitments/:contractId/tx/:method` | Builds unsigned XDR for any no-argument lifecycle method (`lock`, `release_advance_1/2`, `claim_advance_1/2`, `reclaim_advance_1/2`, `mark_checkpoint`, `settle`, `cancel`, `ready_for_delivery`, `fund_remainder`, `expire_remainder_window`, `reclaim_on_nondelivery`, `resolve_dispute`, `expire_dispute_window`). `cancel`/`resolve_dispute` need two- and three-party auth respectively — see above, not just extra signatures on the same XDR. Everything else here is single-signer or fully permissionless, so needs nothing extra. |
| POST | `/commitments/:contractId/tx/flag-dispute` | Builds unsigned `flag_dispute` XDR. Takes `flagger` (must be the commitment's buyer, cooperative, or warehouse operator — enforced on-chain, not re-checked here). Single-signer. See below. |
| POST | `/commitments/:contractId/tx/cancel/propose` | Proposes (or, idempotently, returns the already-active) staged multi-party cancellation. Buyer or cooperative may propose. See above. |
| GET | `/commitments/:contractId/tx/cancel/propose` | The active cancel proposal for a contract, if any — what a viewer's UI polls. |
| POST | `/commitments/:contractId/tx/reassign-buyer/propose` | Proposes (or, idempotently, returns the already-active) staged multi-party reassignment. Only the *current* buyer may propose. Takes `newBuyer`. See above. |
| GET | `/commitments/:contractId/tx/reassign-buyer/propose` | The active reassignment proposal for a contract, if any. |
| POST | `/commitments/:contractId/tx/resolve-dispute/propose` | Proposes (or, idempotently, returns the already-active) staged multi-party dispute resolution. Buyer, cooperative, or warehouse operator may propose — needs the other two's signatures. See below. |
| GET | `/commitments/:contractId/tx/resolve-dispute/propose` | The active dispute-resolution proposal for a contract, if any. |
| POST | `/commitments/:contractId/tx/propose/:proposalId/sign` | Records one party's signed auth entry against any proposal (method-agnostic — the proposal ID is already unique); flips to `ready` once every pending entry across every method is signed. |
| POST | `/commitments/:contractId/tx/set-allocation` | Builds unsigned `set_allocation` XDR and stages (doesn't yet persist) the phone-number mapping — see below. Cooperative-gated on-chain, callable only pre-`lock`. |
| GET | `/commitments/:contractId/allocation` | Live on-chain read of the recorded allocation ledger (member hashes + shares). Never returns a phone number — this contract never stores one. |
| DELETE | `/allocation-members/:memberHash` | NDPA s.34 erasure: nulls the phone number behind an on-chain hash. Idempotent. See below. |
| GET | `/commitments/:contractId/oracle-config` | Live on-chain read of the configured oracle (address, price asset, max quote age). `{"config": null}` if `initialize` never set one — a valid state, not an error. See below. |
| GET | `/commitments/:contractId/oracle-rate` | A genuinely live cross-contract call to the configured Reflector oracle on every request, never cached. Fails (500, contract error propagated) if no oracle is configured, the oracle doesn't quote that asset, or the quote is older than the configured bound. See below. |
| POST | `/transactions/submit` | Submits a signed envelope, polls for confirmation, optionally refreshes the Postgres cache (`refreshContractId`), marks a multisig proposal completed (`completeProposalId`), and/or persists a staged allocation ledger's phone numbers (`allocationContractId`/`allocationMembers`) now that the on-chain call is confirmed. |
| GET | `/commitments/:contractId` | Live read straight from chain (source of truth), refreshes the cache as a side effect. Also applies any reputation consequence from a fresh transition into `Defaulted`/`Forfeited` — see above. |
| GET | `/commitments` | Lists the Postgres-cached mirror — the only way to list commitments at all, since the chain has no such query. Paginated: `?limit=&offset=`, default page size 20, limit clamped to 100 (`DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE` in `src/db/commitments.ts`); unusable values fall back to the defaults rather than erroring. Response is a bare array — clients treat a full page as "maybe more", not "done". Ordered `created_at DESC, id`, so pages partition the set with no skipped or duplicated rows across page edges. |
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

### Allocation ledger (PRD §4.8/§16.1)

The contract only ever sees a per-member **salted hash** plus a share —
never a phone number. This API is the only place a phone number and the
salt that hashed it ever meet, in `db/allocationMembers.ts`
(migration `005_allocation_members.sql`). Salts are generated **per
member**, not just per contract — stronger than the compliance-load-
bearing salt-scheme requirement (`TASKS.md`) asked for, since even two
members appearing in two different contracts (or twice in the same one)
never share a salt.

The write flow is staged, same shape as the multi-party propose/sign/
finalize mechanism but simpler (single-signer, no other party needs to
sign anything): `POST .../tx/set-allocation` computes each member's
salt+hash and returns them *unpersisted* alongside the unsigned XDR;
the caller signs, then passes the same staged members back to
`/transactions/submit` (`allocationContractId`/`allocationMembers`),
which only writes the phone-number mapping to Postgres once the
on-chain call is confirmed. This is deliberate: persisting at build
time would leave an orphaned off-chain row (with a real phone number in
it) referencing a hash that was never actually put on-chain, if the
caller built the transaction but never signed or submitted it.

`GET .../allocation` reads the ledger live from chain — hashes and
shares only, never a phone number (this API doesn't expose phone
numbers over any read endpoint at all; write-only by design, since
there's no auth/session model yet to gate who'd be allowed to see one).
`DELETE /allocation-members/:memberHash` is the actual NDPA s.34
erasure mechanism: nulls the phone number for that hash, leaves the
share and the hash itself intact. After erasure the on-chain entry is
permanently unlinkable to a real person — the salt is gone, and
brute-forcing a random salt is infeasible regardless of how small the
phone-number keyspace is.

Record-only in v1, not a `settle` behavior change — PRD §4.9 already
states the v1 default explicitly ("payment settles to the cooperative
wallet, each member's entitlement is on chain and readable"); pro-rated
on-chain payout across members is a real, separate piece of future
work, not something this ledger silently promises.

### Oracle staleness bound and FX settlement (PRD §16.3, §4.2 option (b))

`initialize`'s optional `oracleConfig` (`{ oracleContract, priceAsset,
maxAgeSecs, denominatedAmount }`) tells the contract which
[Reflector](https://reflector.network) SEP-40 oracle instance and asset
symbol to read at settlement time, how old a quote it's willing to
accept, and the deal's true value in `priceAsset` (7-decimal "stroop"
units, same convention as `totalAmount`) to convert into the settlement
token. Omit it, or pass `null`, for a plain deal that needs no
conversion — this is genuinely optional per commitment, not every deal
is NGN-denominated.

The 13th `initialize` argument is `Option<OracleConfig>` on the
contract side, a Soroban struct — same reason `set_allocation`'s struct
argument needed hand-built `ScVal` encoding rather than trusting
`nativeToScVal`'s object inference (`oracleConfigToScVal` in
`stellar/deploy.ts`), **and** the map's keys have to be in ascending
Symbol order (`denominated_amount`, `max_age_secs`, `oracle_contract`,
`price_asset` — not the struct's declaration order), since Soroban's
host rejects an out-of-order `ScVal::Map` as malformed. Verified
against the real deployed Deployment 9 contract via
`simulateTransaction` before ever wiring it into this route.

`GET .../oracle-config` reads back whatever was set (or `null`).
`GET .../oracle-rate` makes a genuine cross-contract call to the
configured oracle on every single request — it is never cached, since
serving a stale rate from this API's own cache would defeat the entire
point of the staleness bound the contract itself enforces. A missing
oracle, an asset the oracle doesn't quote, or a quote older than
`maxAgeSecs` all surface as a 500 with the contract's own error
propagated through, not a quietly-wrong number.

**`settle`'s payout math genuinely consumes this now.** PRD §4.2 names
three different options for who bears FX risk between lock-in and
settlement; option (b) — buyer tops up or is refunded at settlement —
was decided explicitly, not assumed, and wired into the contract's
`resolve_fx_shortfall`/`fund_fx_shortfall`/`expire_fx_shortfall_window`
(no new API surface needed — these are permissionless or buyer-gated
no-arg methods, so they go through the existing generic `/tx/:method`
route same as any other lifecycle call). A missed `fund_fx_shortfall`
deadline reuses `Status::Defaulted`, so the existing reputation
machinery (`applyReputationConsequences`) bars the buyer automatically
with zero API changes. See `HarvestLock-Contracts/HANDOFF.md`'s
Deployment 9 for the contract-level detail and a genuine live cross-rate
top-up. Also worth knowing: Reflector's real testnet fiat-rate oracle
doesn't quote NGN at all as of this writing (confirmed via its own
`assets()` call, not assumed) — GBP is what this API's own live tests
use to prove the mechanism, not the production symbol.

### Dispute flagging (PRD's must-have "dispute flagging with defined escalation")

`POST .../tx/flag-dispute { flagger, sourcePublicKey }` lets any one of
the commitment's buyer, cooperative, or warehouse operator freeze it —
`flagger` must be one of those three (enforced on-chain; the contract's
`NotAParty` error is the actual check, this route only validates the
address is well-formed). Once flagged, the contract's `status` is
`Disputed`, which blocks every other lifecycle call by construction —
see `HarvestLock-Contracts`' module doc for why no extra gating was
needed anywhere else for that.

Getting out of `Disputed` needs **all three** parties' auth, same shape
as `cancel`/`reassign_buyer`: `resolve_dispute` is in the generic
no-arg method set (sign the same envelope three times) and also has
its own staged `propose`/`sign` route pair
(`POST .../tx/resolve-dispute/propose`) for the separate-wallets case —
any of the three may propose, unlike `reassign_buyer`'s
current-buyer-only rule. If the three parties can't agree,
`expire_dispute_window` (permissionless, no args, in the no-arg set)
restores the same pre-dispute status once the contract's own deadline
passes, so the freeze can't become permanent from one party simply
refusing to consent.

**This still isn't arbitration.** Nothing here decides who was right
about anything — consistent with the PRD's own explicit framing that
grade/quantity disputes are the warehouse operator's own appeals
process, not a HarvestLock dispute. What this buys is only that a
contested situation can pause the state machine instead of letting some
other deadline-triggered function (`settle`, `expire_remainder_window`,
...) run to a conclusion while it's being sorted out off-chain. See
`HarvestLock-Contracts/HANDOFF.md`'s Deployment 10 for the contract-level
detail, including a documented, deliberate limitation: freezing `status`
doesn't pause any other deadline already ticking on the commitment.

## CORS

The API does not reflect arbitrary browser `Origin` headers. Set
`CORS_ORIGINS` to a comma-separated list of exact origins (scheme, host,
and optional port; no paths or wildcards) when the frontend deployment
domains are known. Until then, cross-origin browser access is disabled;
same-origin requests and non-browser clients are unaffected. Local Vite
development can opt in with an origin such as `http://localhost:5173`.

CORS only controls whether browsers expose responses to scripts. It is not
authentication or a substitute for the contract's signature checks.

## Rate limiting — and what a 429 actually looks like (for frontends/backoff)

Every route is rate-limited globally, per client IP: **100 requests per
rolling minute** (`@fastify/rate-limit`, registered in `src/server.ts`;
skipped under `NODE_ENV=test` so test suites' rapid-fire requests don't
trip it). This section documents the *observed* wire behavior — verified
by running the server and bursting past the limit with `curl`, not read
off the plugin's docs — because three frontends poll this API and need to
back off correctly instead of hammering it.

The 100/minute value is an explicit initial budget for the current
transaction flow. A single-signer transaction normally spends two API
requests: build the unsigned XDR, then submit the wallet-signed XDR;
wallet signing itself is local. A staged three-party transaction spends
at most four: propose, collect two other parties' signatures, then submit.
That leaves capacity for up to 25 staged transactions per minute before
polling. Each active proposal's 10-second waiting-state poll costs six
requests per minute, so the theoretical ceiling is lower when several
flows are waiting at once. All callers sharing one egress IP (for example,
users behind the same NAT) share this budget. This is a starting abuse
control setting, not a measured production capacity claim; review it
against pilot traffic before launch, and use a shared limiter store if
multiple API instances need a coordinated per-IP limit.

**Yes, a 429 carries `Retry-After`.** A request past the limit gets:

```
HTTP/1.1 429 Too Many Requests
x-ratelimit-limit: 100
x-ratelimit-remaining: 0
x-ratelimit-reset: 60
retry-after: 60
content-type: application/json; charset=utf-8

{"statusCode":429,"error":"Too Many Requests","message":"Rate limit exceeded, retry in 1 minute"}
```

What a client should key off:

- **`retry-after`** — whole **seconds remaining in the current window**,
  recomputed per response and observed counting down in real time (e.g.
  8, then 3 five seconds later). It is not a fixed constant and not a
  "cooldown from now" — it's time until this client's window resets, so
  sleep that long and then retry. Once the window expires, the very next
  request succeeds with a fresh budget (observed: 200 with
  `x-ratelimit-remaining: 99` immediately after expiry).
- **`x-ratelimit-remaining` / `x-ratelimit-reset`** — also present on
  *successful* responses (`x-ratelimit-remaining` counts down from 99),
  so a well-behaved client can throttle proactively *before* ever
  hitting a 429 rather than discovering the limit the hard way.
- **The 429 body** is the same `{statusCode, error, message}` shape as
  every other error in this API (see `setErrorHandler` in
  `src/server.ts`) — no special-casing needed on the parse path.
- **The limit is per client IP, shared across all routes** — it is not
  per endpoint and not per frontend. Budget for transaction requests
  and 10-second proposal polls together; multiple frontends from the
  same NAT'd egress IP share one budget. Don't retry a 429 immediately or on a fixed
  short interval — wait the advertised `retry-after` (jitter optional
  but harmless).

One historical footnote worth knowing, since it's why this section
exists: the limiter registration in `src/server.ts` used **not** to be
awaited, and `@fastify/rate-limit` attaches itself via an `onRoute`
hook, which Fastify only fires for routes defined *after* the plugin
body runs — an un-awaited `app.register()` defers that body until boot,
i.e. after every route was already defined. The practical result was
that the limiter silently never engaged on any route: bursts well past
100 requests produced no 429 and not a single `x-ratelimit-*` header.
Registration is now awaited (`await app.register(rateLimit, ...)`), and
`test/server.test.ts` carries a regression test that builds an instance
with the limiter enabled and asserts the 429 + `retry-after` behavior
above, so this can't quietly break again.

## Setup

Requires Node.js 20.19+ (or 22.12+) and PostgreSQL. To run a local
PostgreSQL 16 instance with the credentials used by `.env.example`:

```sh
docker run --name harvestlock-postgres \
  -e POSTGRES_PASSWORD=harvestlock \
  -e POSTGRES_DB=harvestlock \
  -p 5432:5432 -d postgres:16
```

Wait for PostgreSQL to accept connections before running the migration:
`docker exec harvestlock-postgres pg_isready -U postgres -d harvestlock`.
The container's default user is `postgres`, matching the example
`DATABASE_URL`. If you already have PostgreSQL, create the `harvestlock`
database and set `DATABASE_URL` in `.env` to match your local credentials.

From the repository root:

```
cd api
npm install
cp .env.example .env
npm run migrate
npm run dev
```

`DATABASE_URL` is required for the migration and normal API reads. The
server can start without `ESCROW_WASM_HASH` and `DEPLOYER_SECRET_KEY`, but
both are required by `POST /commitments/deploy`.

`ESCROW_WASM_HASH` is the SHA-256 of the built escrow WASM — get it via
`sha256sum` on `HarvestLock-Contracts/target/wasm32v1-none/release/harvestlock_escrow.wasm`,
or cross-check against a deployed instance with
`stellar contract fetch --id <CONTRACT_ID> --network testnet`.

## Curl-only cookbook (nothing but curl, plus `stellar-cli` to sign)

For an integrator who doesn't have Node tooling installed. Every **read**
here is plain `curl`. Every **write** is: `curl` builds the unsigned
transaction → the party's own key signs it → `curl` submits it. Signing uses
[`stellar-cli`](https://developers.stellar.org/docs/tools/cli) — a
standalone binary, not Node tooling — which is fine for the single-signer
paths below. The one thing curl + `stellar-cli` alone *cannot* complete is a
staged multi-party call (`cancel`, `reassign_buyer`, `resolve_dispute`),
because each other party has to sign a single Soroban **auth entry**, not a
whole envelope — that needs a wallet exposing `signAuthEntry` (Freighter) or
the SDK; the per-step curl shapes are still shown in §7. Any rejection that
comes back as `Error(Contract, #N)` is decoded in
[`../docs/contract-glossary.md`](../docs/contract-glossary.md).

Shell variables used throughout:

```sh
API=http://localhost:3000   # or wherever the API you're calling runs
TOKEN=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC  # testnet native XLM (Stellar Asset Contract)
```

`jq` is used below to pull fields out of responses; any JSON tool works — or
just read the output by eye.

### 1. Liveness

```sh
curl -s "$API/health"
# {"ok":true,"checks":{"api":"ok","database":"ok"}}   (503 if the DB is down)
```

### 2. Three funded testnet identities

```sh
stellar keys generate buyer        --network testnet --fund
stellar keys generate cooperative  --network testnet --fund
stellar keys generate warehouse    --network testnet --fund

BUYER=$(stellar keys address buyer)
COOPERATIVE=$(stellar keys address cooperative)
WAREHOUSE=$(stellar keys address warehouse)

# for §7
stellar keys generate incoming-buyer --network testnet --fund
NEW_BUYER=$(stellar keys address incoming-buyer)
```

The `--fund` flag hits friendbot; the raw equivalent, if you already have
G-addresses, is `curl -s "https://friendbot.stellar.org/?addr=$BUYER"`.
Addresses must be *funded/created* accounts — an unfunded key fails
on-chain with a storage error, not a signature error.

### 3. Deploy a fresh escrow instance

One contract instance = one commitment. Deployer-paid; no party auth.

```sh
CID=$(curl -s -X POST "$API/commitments/deploy" | jq -r .contractId)
echo "$CID"
```

### 4. Initialize it (buyer signs)

```sh
curl -s -X POST "$API/commitments/$CID/tx/initialize" \
  -H 'content-type: application/json' \
  -d "{
    \"buyer\": \"$BUYER\",
    \"cooperative\": \"$COOPERATIVE\",
    \"warehouseOperator\": \"$WAREHOUSE\",
    \"token\": \"$TOKEN\",
    \"totalAmount\": \"1000000000\",
    \"advance1Bps\": 1500,
    \"advance2Bps\": 2000,
    \"claimWindowSecs\": \"86400\",
    \"remainderWindowSecs\": \"604800\",
    \"deliveryWindowSecs\": \"10368000\",
    \"contractedQuantity\": 1000,
    \"gradePriceBps\": [10000],
    \"sourcePublicKey\": \"$BUYER\"
  }" | jq -r .xdr > /tmp/init.xdr

stellar tx sign --network testnet --sign-with-key buyer < /tmp/init.xdr > /tmp/init.signed.xdr

curl -s -X POST "$API/transactions/submit" \
  -H 'content-type: application/json' \
  -d "{\"xdr\": \"$(cat /tmp/init.signed.xdr)\", \"refreshContractId\": \"$CID\"}"
# {"status":"SUCCESS","hash":"..."}
```

Window bounds are enforced API-side before anything is built: `claimWindowSecs`
1 h–90 d, `remainderWindowSecs` 1 h–30 d, `deliveryWindowSecs` 1 d–365 d.
`oracleConfig` is optional — omit it for a plain deal (see the oracle
section above).

Built transactions carry a short time bound (60 s; 300 s for a finalized
proposal), so sign and submit promptly, or rebuild the XDR.

### 5. Lock the deposit (buyer signs)

`lock` is one of the no-argument lifecycle methods, so it uses the generic
`/tx/:method` route. Only the deposit (`advance1Bps + advance2Bps`) is
escrowed here; the remainder is funded later via `fund_remainder`.

```sh
curl -s -X POST "$API/commitments/$CID/tx/lock" \
  -H 'content-type: application/json' \
  -d "{\"sourcePublicKey\": \"$BUYER\"}" | jq -r .xdr > /tmp/lock.xdr

stellar tx sign --network testnet --sign-with-key buyer < /tmp/lock.xdr > /tmp/lock.signed.xdr

curl -s -X POST "$API/transactions/submit" \
  -H 'content-type: application/json' \
  -d "{\"xdr\": \"$(cat /tmp/lock.signed.xdr)\", \"refreshContractId\": \"$CID\"}"
```

Other no-arg methods work the same way, e.g.
`/tx/claim_advance_1` (sign with the cooperative key),
`/tx/fund_remainder`, `/tx/settle` (permissionless). Argument-taking
methods have their own routes: `/tx/confirm-delivery`,
`/tx/flag-dispute`, `/tx/set-allocation`, `/tx/reassign-buyer`. Optional
`oracleConfig` on `initialize` (for FX settlement) takes
`{oracleContract, priceAsset, maxAgeSecs, denominatedAmount}` — see §6's
read routes and the oracle section above.

### 6. Read state (pure curl)

```sh
curl -s "$API/commitments/$CID" | jq          # live chain read (source of truth)
curl -s "$API/commitments?limit=10" | jq      # Postgres-cached list
curl -s "$API/commitments/$CID/allocation" | jq
curl -s "$API/commitments/$CID/oracle-config" | jq
curl -s "$API/parties/$BUYER/standing" | jq
```

After a successful lock, the live read's `status` is `Locked` (glossary:
[`../docs/contract-glossary.md`](../docs/contract-glossary.md)).

### 7. Staged multi-party calls — curl can start and finish, not sign the middle

`reassign_buyer` (three parties), `cancel` (two), and `resolve_dispute`
(three) are staged: a proposal row is created, each other party signs their
own auth entry from their own wallet, then the proposer finalizes through
the **existing** `/transactions/submit`. curl does the propose, the polling,
and the finalize; the one `<signed entry XDR>` placeholder has to come from
an auth-entry-capable wallet. Full diagram:
[`docs/reassign-buyer-sequence.md`](./docs/reassign-buyer-sequence.md).

```sh
# Propose (only the current buyer may propose a reassignment)
curl -s -X POST "$API/commitments/$CID/tx/reassign-buyer/propose" \
  -H 'content-type: application/json' \
  -d "{\"proposerPublicKey\": \"$BUYER\", \"newBuyer\": \"$NEW_BUYER\"}" > /tmp/proposal.json

PROPOSAL_ID=$(jq -r .id /tmp/proposal.json)
jq -r '.pending_entries[] | .address + " " + .entry_xdr' /tmp/proposal.json

# Poll from any viewer (poll every ~10 s while waiting)
curl -s "$API/commitments/$CID/tx/reassign-buyer/propose" | jq

# Each pending signer: wallet signs ITS OWN entry_xdr (Freighter signAuthEntry,
# not signTransaction), then posts it back
curl -s -X POST "$API/commitments/$CID/tx/propose/$PROPOSAL_ID/sign" \
  -H 'content-type: application/json' \
  -d "{\"signerPublicKey\": \"$COOPERATIVE\", \"signedEntryXdr\": \"<signed entry XDR>\"}" | jq

# Repeat for the incoming buyer. Once all entries are signed, status flips to
# "ready" and ready_xdr appears:
curl -s "$API/commitments/$CID/tx/reassign-buyer/propose" \
  | jq -r .proposal.ready_xdr > /tmp/ready.xdr

# The proposer signs ready_xdr classically and submits with
# completeProposalId so the proposal stops showing as active:
stellar tx sign --network testnet --sign-with-key buyer < /tmp/ready.xdr > /tmp/ready.signed.xdr
curl -s -X POST "$API/transactions/submit" \
  -H 'content-type: application/json' \
  -d "{\"xdr\": \"$(cat /tmp/ready.signed.xdr)\", \"refreshContractId\": \"$CID\", \"completeProposalId\": \"$PROPOSAL_ID\"}"
```

### 8. What the common failures mean

| Response | Meaning |
|---|---|
| `400` | Malformed contract ID / address, out-of-range window, unknown method — rejected before any network call. |
| `403` | A business rule: wrong party proposing, or a barred buyer/cooperative on `initialize`. |
| `429` | Rate limit (100 req/min per IP, global). Sleep the `retry-after` seconds — it's the time left in the current window, not a fixed cooldown. See the rate-limiting section above. |
| `500` with `Error(Contract, #N)` | The contract rejected it (e.g. wrong status for that method). Find `N` in [`../docs/contract-glossary.md`](../docs/contract-glossary.md). |

CORS is a browser concern only — curl doesn't enforce it, so a curl call
succeeding says nothing about whether a browser frontend's origin is
allow-listed (see the CORS section above).

## Testing

`npm test` runs five suites, all against real infrastructure: `stellar.test.ts`
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
completed. One more scenario proves the allocation ledger end to end
through the same real HTTP layer: build `set_allocation` via
`/tx/set-allocation`, sign, submit with the staged members, read the
result back **on-chain** (`GET .../allocation`) to confirm the exact
hashes/shares landed, read the **off-chain** Postgres side directly to
confirm the phone-number mapping was actually persisted (not just
staged), then erase one member through the real `DELETE
/allocation-members/:memberHash` endpoint and confirm the on-chain read
afterward is completely unaffected — only the phone number behind that
hash is gone. `retry.test.ts` covers the retry
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

A fifth suite, `test/allocationMembers.test.ts`, is the same
real-Postgres discipline applied to the allocation ledger's off-chain
half: `stageAllocationMembers` produces a genuinely distinct salt+hash
per member (even for the same phone number staged twice — the whole
point of salting per member, not per contract), `recordAllocationMembers`/
`getAllocationMembers` round-trip correctly and never surface a phone
number, and `eraseAllocationMember` is idempotent and leaves
`share_bps`/`member_hash` untouched.

Two real bugs worth knowing about, found while building the allocation
ledger, both now fixed: `nativeToScVal`'s automatic object-to-map
inference picks the wrong numeric type for a plain JS number
(`share_bps` became `u64` instead of the contract's `u32`) — the
struct's `ScMap` is now built by hand instead of trusted to inference.
And `scValToNative` decodes a `BytesN` as a `Uint8Array`, not a Node
`Buffer` — `Uint8Array.prototype.toString("hex")` silently ignores the
argument and returns a comma-joined decimal list instead of throwing,
which the live end-to-end test caught as a failed assertion, not a crash.

## What's not built yet

- The voucher/SDP pieces mentioned above — nothing exists for these yet.
- Auth/sessions for the frontends — out of scope for MVP per PRD, but the
  data model shouldn't assume a single user (see `TASKS.md`).
- No endpoint refreshes the Postgres cache for a contract nobody has
  called `GET /commitments/:contractId` on recently — there's no
  background poller yet, so the list view can go stale for commitments no
  one has viewed. Acceptable for now, worth revisiting once there's real
  usage. The reputation consequences above inherit the exact same gap,
  for the exact same reason. Revisited 18 Oct 2026 (#186) and kept as-is;
  see `../docs/audits/2026-10-18-commitments-cache-refresh-revisit.md`
  for the evidence, revisit triggers, and the pre-scoped smallest version
  of the job.
- The appeals process behind reputation's bar: the contact
  (`samuelojetunde898@gmail.com`) is documented on `site/roles.html`;
  there's no inbox automation or reinstatement workflow here yet,
  deliberately — matches this project's bias against over-building ahead
  of real usage.
See `../TASKS.md` for the full, current backlog and `../HANDOFF.md` for
project-wide state.
