# API load-test finding (#244)

## Scope

The local run measures two distinct limits without signing, spending testnet fees, or submitting transactions:

- `GET /parties/{address}/standing` exercises Fastify and a real Postgres query through the API's default connection pool. Run with `NODE_ENV=test` to disable the production rate limiter while measuring database-backed request capacity.
- `GET /health` exercises Fastify with the production rate limiter enabled. This establishes the hard request budget, not the number of complete commitment or claim flows it permits.

The results below are **not** a measurement of Soroban simulation, signature verification, transaction submission, or confirmation polling. Those steps need funded Stellar accounts and usable escrow contract fixtures. This environment has neither; the endpoints are intentionally not pointed at testnet without those inputs.

## Reproduce

Start a throwaway local Postgres instance and run migrations:

```sh
docker run --rm --name harvestlock-load-postgres \
  -e POSTGRES_PASSWORD=harvestlock -e POSTGRES_DB=harvestlock \
  -p 5432:5432 -d postgres:16-alpine
cd api
npm ci
DATABASE_URL=postgres://postgres:harvestlock@127.0.0.1:5432/harvestlock npm run migrate
```

Start the API in test mode for the database profile:

```sh
NODE_ENV=test DATABASE_URL=postgres://postgres:harvestlock@127.0.0.1:5432/harvestlock \
  STELLAR_RPC_URL=https://soroban-testnet.stellar.org npm run dev
```

In another terminal, run `npm run load-test` from `api/`. It defaults to 10 concurrent workers for 15 seconds against the database-backed standing route. Set `LOAD_TEST_CONCURRENCY` (1-500), `LOAD_TEST_DURATION_SECONDS` (up to 300), and `LOAD_TEST_PATH` to change the profile. The target is restricted to loopback hosts unless `LOAD_TEST_ALLOW_REMOTE=1` is explicitly set.

To observe the production limiter, restart the API with `NODE_ENV=production`, then run the health profile for five seconds:

```sh
LOAD_TEST_PATH=/health LOAD_TEST_CONCURRENCY=10 LOAD_TEST_DURATION_SECONDS=5 npm run load-test
```

## Results

Measured locally on 18 Oct 2026 in the Ubuntu 24.04 dev container, Node v24.21.0, API process on loopback, and PostgreSQL 16 (`postgres:16-alpine`). Each profile ran for five seconds with a fresh generated address per request. The database profile used `NODE_ENV=test`; the limiter profile used `NODE_ENV=production` and ten workers.

| Profile | Concurrency | Requests/s | p50 / p95 | Successful / rejected |
| --- | ---: | ---: | ---: | ---: |
| Party standing (Postgres) | 1 | 712 | 0.93 / 3.20 ms | 3,564 / 0 |
| Party standing (Postgres) | 10 | 1,363 | 5.16 / 19.01 ms | 6,818 / 0 |
| Party standing (Postgres) | 50 | 1,619 | 23.06 / 67.61 ms | 8,113 / 0 |
| Party standing (Postgres) | 100 | 1,666 | 47.52 / 130.75 ms | 8,359 / 0 |
| Production `/health` limiter burst | 10 | 2,323 attempts/s | 2.81 / 11.12 ms | 100 / 11,519 |

The database route returned 200 for every request through 100 concurrent workers. Throughput nearly flattened between 50 and 100 workers while p95 latency almost doubled; this is evidence of contention under this local profile, not enough to identify whether the pool, process, or host is responsible. The pool is using node-postgres's default maximum of 10 connections. No pool queue instrumentation was added, so the exact pool saturation point was not observed.

## Finding

The configured 100 requests per rolling minute is a per-IP request ceiling shared by all routes, not a concurrency limit or a transaction-flow allowance. At most, it permits 33 complete create flows per minute (deploy, initialize-build, submit) or 50 claim flows per minute (claim-build, submit), assuming no reads, retries, polling, or other clients share that IP. These are arithmetic ceilings, not measured flow throughput.

This run does not establish a concurrent create/claim flow capacity or a Soroban RPC bottleneck: no deployment, transaction build, wallet signing, submission, or confirmation was included. That transaction-flow result remains open until a signer-aware harness is exercised with unique funded test accounts and live escrow fixtures against Soroban testnet. Avoid concurrent submissions from one account: Stellar sequence numbers serialize that signer and would confound the API/RPC capacity result.