# HarvestLock end-to-end tests

Real browser, real API, real Stellar testnet. Three Playwright specs, one
per frontend, each walking the app's defining user journey end to end:

| Spec | Journey | What it proves |
| --- | --- | --- |
| `tests/buyer-app.spec.ts` | Buyer creates a commitment (#198), proposes reassignment (#45), settles a Delivered commitment (#41), and proposes/approves/finalizes cancellation (#42–44) | The create/settle flows complete against the real API and chain; cancellation proposals stage the right parties, auth-entry rejection is recoverable, and a refreshed ready envelope finalizes to the on-chain state |
| `tests/coop-pwa.spec.ts` | Cooperative claims advance tranche 1 (#199); records an allocation ledger (#54); flags a dispute (#59); proposes resolving one (#60) | The claim loop against a real Locked-and-released commitment; `set_allocation` persists hashes/shares with no phone number; `flag_dispute` flips the chain status; a resolution proposal stages the other two parties and their approval signs |
| `tests/warehouse-app.spec.ts` | Warehouse operator confirms a delivery | The confirm form's submit lands a real partial delivery with the entered quantity and settlement maths |

The QA issues (#45, #54, #59, #60) each exercise a rejection path before
the happy path — the injected wallet answers with Freighter's own declined
error, the UI must surface it and reset, and the chain must stay unchanged.
`docs/qa/manual-freighter-qa-45-54-59-60.md` is the accompanying write-up,
including what a real extension popup is expected to show and the manual
checklist that remains.

Buyer-app settlement and cancellation coverage for issues #41–44 is described
in `docs/qa/issue-41-44-buyer-freighter-workflows.md`. The cooperative's
cancellation proposal is approved by the buyer and finalized by the proposer;
the test also rejects the buyer's first auth-entry signing request before
retrying it.

## Why these exist when the apps already have test suites

Each frontend's vitest suite mocks `fetch` and the wallet completely, so it
structurally cannot catch the class of break where the pieces individually
pass but the integration between them is wrong: a CORS regression, an API
route or response-shape drift, a Freighter postMessage protocol change, an
SDK signing mismatch. These tests run the actual browser bundles against the
actual API against actual testnet. They are deliberately thin — one journey
per app — because their value is in the realness of the wiring, not in
covering every branch. Branch coverage stays in the apps' own suites.

## What is real and what is stubbed

Real: the browser, the app bundles, the API, Postgres, Soroban RPC, Horizon,
the escrow contract, the testnet XLM moving through the native token SAC.

Stubbed: only the wallet extension. No Freighter exists in a headless
environment (a long-documented limitation of this project), so
`tests/helpers/freighter.ts` speaks Freighter's real postMessage protocol
(`FREIGHTER_EXTERNAL_MSG_REQUEST` / `..._RESPONSE`, including the upstream
`messagedId` typo) backed by a throwaway testnet keypair. Everything the app
does with the returned public key/signature/networks is the real code path.

Setup state that no single app UI can reach (a commitment that is Locked with
advance 1 released, for example) is built by `tests/helpers/api.ts` from Node
through the same real HTTP routes and testnet transactions — not mocked, just
expressed as direct API calls instead of clicks.

## Prerequisites

- Node 24+ and a running Postgres 16 (the API needs it; anything you use for
  local API development works)
- A funded testnet deployer key: `DEPLOYER_SECRET_KEY` in `api/.env`, funded
  via https://friendbot.stellar.org (free testnet XLM)
- `api/.env` configured as for normal local development, with in particular:
  - `DATABASE_URL`
  - `ESCROW_WASM_HASH` — the hex hash of the currently deployed escrow
    contract WASM. `render.yaml` carries the deployment the hosted API uses;
    use the same value locally unless you know you have a newer deployment.
  - `CORS_ORIGINS` must include all three app origins, comma-separated:
    `http://localhost:5173,http://localhost:5174,http://localhost:5175`
    (global-setup fails fast with this exact value in the message if it
    doesn't.)
- The three apps' dependencies installed (`npm install` in `buyer-app/`,
  `coop-pwa/`, `warehouse-app/`) — Playwright starts their dev servers itself.
- This package's dependencies and browser: `npm install` here, then
  `npm run install-browsers`.

## Running

```sh
# terminal 1: Postgres, then the API
cd api
npm run migrate
npm run dev

# terminal 2: the tests
cd e2e
cp .env.example .env   # E2E_LIVE=1 is already set in the example
npm test
```

Without `E2E_LIVE=1` every spec skips with a pointer back to this file —
that's the mode CI sees, since a PR-triggered workflow can't hold a funded
deployer key (see the comment at the top of `.github/workflows/api.yml`).

Playwright starts the three dev servers for you in live mode (ports 5173,
5174, 5175, `--strictPort`) and fails fast if the API is unreachable, its
health check is unhappy, or its CORS headers don't cover the app origins.
Runs are serialized (`workers: 1`) because each test does real deploys and
several on-chain transactions; expect roughly a minute or two per test on
testnet.

## Environment

Everything is optional except `E2E_LIVE`; defaults match the local-dev setup
above. See `.env.example` for the full list. Two notes:

- `E2E_BUYER_SECRET` / `E2E_COOPERATIVE_SECRET` / `E2E_WAREHOUSE_SECRET`
  pin the throwaway keypairs used for the run. Tests fund them via friendbot,
  so leave these unset unless friendbot is rate-limiting you — they are
  still throwaway testnet keys, never real wallets.
- `E2E_API_URL`, the three `E2E_*_ORIGIN`s, `E2E_HORIZON_URL` and
  `E2E_FRIENDBOT_URL` exist so the tests can target a non-default local
  setup, nothing more.

## Troubleshooting

- **`global-setup` refuses to start with a CORS message**: set
  `CORS_ORIGINS` in `api/.env` to the value quoted in the error and restart
  the API.
- **Friendbot rate-limits a run**: set the three `E2E_*_SECRET` variables to
  keys you've funded once, or wait and rerun.
- **A test fails deep in a transaction**: testnet is occasionally flaky
  (documented in `api/HANDOFF.md`); check the trace in `test-results/`
  before assuming a real regression, then rerun.
- **Ports already in use**: the dev servers are started with `--strictPort`;
  stop whatever holds 5173–5175 or override the origins and run your own
  servers.
