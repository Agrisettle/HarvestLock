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

**One exception to the two-step flow above: `cancel`.** It's a mutual
unwind (contracts `HANDOFF.md`, PRD §7) that needs *both* the buyer's and
the cooperative's auth on the same call — a single `sign()` from each
party's wallet on the XDR this API returns is **not** enough; naively
signing the envelope twice fails on submission (`tx_bad_auth_extra`).
Each non-source party has to authorize their own `SorobanAuthorizationEntry`
specifically (`authorizeEntry()` in `@stellar/stellar-sdk`, or a wallet's
equivalent — Freighter and others expose this for exactly this case), not
just sign the envelope. `test/helpers.ts`'s `submitMultiPartyCall` is a
worked, live-tested example of the correct mechanism; no frontend UX for
this exists yet (see `HANDOFF.md`'s "Next steps").

## Endpoints, as of this writing

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Liveness check. |
| POST | `/commitments/deploy` | Deploys a fresh, uninitialized escrow contract instance. Deployer-paid, no party auth. |
| POST | `/commitments/:contractId/tx/initialize` | Builds unsigned `initialize` XDR. Must be signed by the intended buyer. |
| POST | `/commitments/:contractId/tx/:method` | Builds unsigned XDR for any no-argument lifecycle method (`lock`, `release_advance_1/2`, `claim_advance_1/2`, `reclaim_advance_1/2`, `mark_checkpoint`, `confirm_delivery`, `settle`, `cancel`). `cancel` needs two-party auth — see below, not just a second signature on the same XDR. |
| POST | `/transactions/submit` | Submits a signed envelope, polls for confirmation, optionally refreshes the Postgres cache. |
| GET | `/commitments/:contractId` | Live read straight from chain (source of truth), refreshes the cache as a side effect. |
| GET | `/commitments` | Lists the Postgres-cached mirror — the only way to list commitments at all, since the chain has no such query. |

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

`npm test` runs `test/stellar.test.ts` against **live Stellar testnet** —
no mocks, same discipline as the contracts repo. It deploys a real
throwaway contract instance, builds and submits real `initialize`/`lock`/
`cancel` transactions (the last with two genuinely different, freshly-
funded signers, via `test/helpers.ts`), and asserts on the resulting
on-chain state. This costs real (testnet) transaction submissions each
run, plus a friendbot funding call — that's the point, it's the only way
to know the SDK usage is actually correct.

## What's not built yet

- The allocation-ledger and voucher/SDP pieces mentioned above — nothing
  exists for these yet.
- Auth/sessions for the frontends — out of scope for MVP per PRD, but the
  data model shouldn't assume a single user (see `TASKS.md`).
- No endpoint refreshes the Postgres cache for a contract nobody has
  called `GET /commitments/:contractId` on recently — there's no
  background poller yet, so the list view can go stale for commitments no
  one has viewed. Acceptable for now, worth revisiting once there's real
  usage.

See `../TASKS.md` for the full, current backlog and `../HANDOFF.md` for
project-wide state.
