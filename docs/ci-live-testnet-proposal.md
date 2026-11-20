# Running the live-testnet API suite in CI — proposal

**Status:** proposal for #10, for maintainer decision. **No workflow file is changed by this proposal.** CI is maintainer-managed (see `.github/PULL_REQUEST_TEMPLATE.md`), so the YAML below is ready to apply, but a maintainer has to apply it.
**Date:** 2026-11-20
**Scope:** how to run `api/test/stellar.test.ts` (16 tests that deploy, build, sign and submit against real Stellar testnet) in GitHub Actions without exposing a key to untrusted code.

---

## 0. TL;DR

**Recommendation: do not use a secret at all.** Generate a throwaway deployer keypair at the start of every run, fund it from testnet friendbot, and use it only for that run. With nothing secret in the job, the fork-PR attack in #10 has nothing to steal, so the suite can safely run on `pull_request`, fork PRs included, with read-only permissions.

| #10 question | Answer |
|---|---|
| 1. Trigger scope | Use plain `pull_request` + `push: main` + `workflow_dispatch` + a weekly `schedule`. **Never `pull_request_target`.** That is only needed when a job needs secrets, and this one doesn't. |
| 2. A dedicated CI key, funded and rotated | **Generated fresh every run**: one keypair per run, funded by friendbot, discarded afterwards. Nothing to rotate, nothing that can leak, and it is never the key used for manual local verification. |
| 3. Same `api.yml` or separate? | **A separate workflow** (`api-live-testnet.yml`), **not a required check** at first. A testnet or friendbot outage must not block merges, and keeping `api.yml`'s required job unchanged keeps its check name stable for branch protection. |
| Fallback | If friendbot proves unreliable in CI: a dedicated CI-only key as an **environment secret** restricted to `main`, run on `push: main` + `workflow_dispatch` only, never on PRs. That is §4's Option C. |

---

## 1. What the suite actually needs

Checked in `api/test/stellar.test.ts` and `api/test/helpers.ts`, not assumed:

| Need | Secret? | Notes |
|---|---|---|
| `DEPLOYER_SECRET_KEY` | **This is the only secret-shaped input.** | Pays fees for `POST /commitments/deploy` and is the source account for chain-read simulations. It is not a party to any commitment and never signs a lifecycle action (`api/README.md`). On testnet it holds only friendbot XLM, which has no value. |
| `ESCROW_WASM_HASH` | No | The hash of escrow WASM already installed on testnet. It is public on-chain data. Any account can deploy an instance from an installed hash, so it does not need to be the uploader's key. |
| `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE` | No | Public testnet values, already in `api.yml`. |
| Other signers (buyer, cooperative, warehouse) | No | **The suite already generates these as fresh keypairs and funds them via friendbot** (`helpers.ts`, `fundTestAccount`). So it already depends on friendbot being up. Doing the same for the deployer adds no new external dependency. |
| A known settled contract (`KNOWN_SETTLED_CONTRACT_ID`) | No | Read-only fixture, see the testnet-reset note in §6. |
| Postgres | No | The same service container `api.yml` already runs. |

The deployer key only matters because it is long-lived and reused. Make it per-run and the secret disappears.

---

## 2. The threat model #10 describes, applied to each option

The concrete attack: a pull request (from a fork, or from a compromised collaborator branch) changes test code or `package.json` scripts so that they print or upload the environment. Any secret in a job that runs that code is exposed. On top of that, `pull_request_target` runs with base-repo secrets **and a write-scoped token** by default. Checking out PR code into that context is the classic "pwn request" ([GitHub Security Lab write-up](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)), and is how most real Actions secret leaks have happened.

Two more facts that shape the options:

- **Repository secrets are available to every workflow on every branch** that someone with write access pushes. "Only runs on push to main" is a property of one workflow file, not of the secret. **Environment secrets** with a deployment-branch policy of `main` only are the GitHub mechanism that ties a secret to a branch.
- `pull_request` from a fork never receives secrets, and its token is read-only. That is safe by construction, but useless when the job needs a secret, which is why the ephemeral key matters.

---

## 3. Options considered

| | A. Ephemeral friendbot key (**recommended**) | B. `pull_request_target` + collaborator/label gate | C. Env-scoped CI key, `main` only (fallback) | D. Env with required reviewers on PRs |
|---|---|---|---|---|
| Secret in job | **none** | CI key | CI key (env-scoped) | CI key (env-scoped) |
| Runs on PRs (incl. forks) | **yes** | yes, after a gate | no | yes, after a manual approval each run |
| Catches regressions before merge | **yes** | yes | no, after merge only | yes, if someone approves |
| Pwn-request exposure | **none: nothing to steal, read-only token** | high: one mis-gated run leaks the key and runs with a write token | low: limited to code already merged to `main` | medium: an approver must read the diff every time |
| Maintenance | none, except testnet resets (§6) | gate logic that has to stay correct | key funding/rotation | approval on every run |
| New external dependency | friendbot (already depended on) | — | — | — |

**B is rejected.** It is the riskiest pattern GitHub offers, and it is only needed when a job needs secrets. **D** works but puts a manual security review in front of every API PR, and reviews done for the sake of CI tend to get rubber-stamped. **C** is the fallback if friendbot cannot be relied on. **A** removes the question.

---

## 4. Ready-to-apply YAML

### 4.1 Option A: `.github/workflows/api-live-testnet.yml` (recommended)

```yaml
name: api-live-testnet

# Live Stellar testnet integration tests (api/test/stellar.test.ts).
# Holds NO secrets: the deployer is a throwaway keypair generated and
# funded from friendbot on every run, so a malicious PR (fork or not) has
# nothing to exfiltrate. See docs/ci-live-testnet-proposal.md (#10).
# Deliberately NOT a required check: testnet/friendbot outages must not
# block merges.

on:
  pull_request:
    paths: ["api/**", ".github/workflows/api-live-testnet.yml"]
  push:
    branches: [main]
    paths: ["api/**", ".github/workflows/api-live-testnet.yml"]
  workflow_dispatch:
  schedule:
    # Weekly, to notice a testnet reset (wiped WASM / fixture contract)
    # before the next PR does.
    - cron: "17 6 * * 1"

permissions:
  contents: read

concurrency:
  group: api-live-testnet-${{ github.ref }}
  cancel-in-progress: true

jobs:
  live:
    name: API / live testnet suite
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: api
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: harvestlock
          POSTGRES_DB: harvestlock
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgres://postgres:harvestlock@localhost:5432/harvestlock
      STELLAR_RPC_URL: https://soroban-testnet.stellar.org
      STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015"
      # Public on-chain data, kept as a repo *variable* (not a secret) so a
      # testnet reset only needs a variable update, not a code change.
      ESCROW_WASM_HASH: ${{ vars.ESCROW_WASM_HASH }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: api/package-lock.json
      - run: npm ci
      - run: npm run migrate

      - name: Ephemeral deployer (generated + friendbot-funded, this run only)
        run: |
          KEYS="$(node -e 'const {Keypair}=require("@stellar/stellar-sdk");const k=Keypair.random();console.log(k.publicKey()+" "+k.secret())')"
          PUB="${KEYS% *}"; SECRET="${KEYS#* }"
          echo "::add-mask::${SECRET}"
          for attempt in 1 2 3; do
            curl -fsS "https://friendbot.stellar.org/?addr=${PUB}" >/dev/null && break
            [ "$attempt" = 3 ] && { echo "friendbot unavailable"; exit 1; }
            sleep $((attempt * 10))
          done
          echo "DEPLOYER_SECRET_KEY=${SECRET}" >> "$GITHUB_ENV"
          echo "Deployer for this run: ${PUB}"

      - name: Preflight — escrow WASM still installed on testnet
        run: |
          test -n "$ESCROW_WASM_HASH" || { echo "::error::repo variable ESCROW_WASM_HASH is not set"; exit 1; }

      - name: Live testnet tests
        run: npx vitest run test/stellar.test.ts
```

The repo-variable preflight only checks that the hash is set. If testnet has been reset, the first deploy test fails with the RPC's own "missing WASM" error. That failure is the signal to re-upload (§6).

### 4.2 Option C (fallback): environment-scoped key, `main` only

Only if friendbot proves unreliable in CI. Replace the triggers and the ephemeral-key step:

```yaml
on:
  push:
    branches: [main]
    paths: ["api/**"]
  workflow_dispatch:   # the environment's branch policy still restricts this to main

jobs:
  live:
    environment: testnet-ci   # Settings → Environments: deployment branches = main only
    # ...same services/env/steps as 4.1, minus the ephemeral-key step, plus:
    env:
      DEPLOYER_SECRET_KEY: ${{ secrets.TESTNET_CI_DEPLOYER_SECRET_KEY }}
```

Maintainer setup for C: create the `testnet-ci` environment, restrict deployment branches to `main`, and store a **newly generated, CI-only** testnet key there (never a key used for manual verification). Top it up from friendbot when the API's own balance warning (`DEPLOYER_BALANCE_WARN_XLM`) shows in the logs. Rotate by replacing the secret. The old key's testnet XLM has no value.

### 4.3 Also worth applying to `api.yml` (unrelated to secrets)

`api.yml` lists its network-free test files explicitly (`server.test.ts reputation.test.ts retry.test.ts`), so new test files do not run in CI until someone adds them. These are all network-free and need only the Postgres service the job already has:

```yaml
      - name: test (network-free)
        run: npx vitest run --exclude test/stellar.test.ts
```

Using an exclude instead of a list means a new network-free test file runs automatically. The live suite stays out until §4.1 runs it. `allocationMembers.test.ts`, `errors.test.ts` and `postmanCollection.test.ts` are already in the repo today and do not currently run in CI. #7's `notifications.test.ts` and #11's `kyb.test.ts` are new.

---

## 5. Evidence: Option A, actually run (20 Nov 2026)

Option A's exact mechanism was run locally against live testnet. A fresh keypair was generated, funded by friendbot (HTTP 200), and used as `DEPLOYER_SECRET_KEY`, with `ESCROW_WASM_HASH` set to Deployment 10's hash from `render.yaml`. Then `npx vitest run test/stellar.test.ts`:

- **11 / 16 pass with the throwaway deployer**, including every deploy → initialize → sign → submit write path. A per-run key works and no long-lived secret is needed.
- **5 / 16 fail, and they fail identically on a clean `upstream/main` checkout**, run the same way. That baseline was checked separately and does not depend on this PR. Four fail consistently: the `KNOWN_SETTLED_CONTRACT_ID` struct read (`expected a Status enum value, got: undefined`, consistent with that fixture predating the current contract's struct), `cancel` (stays `Locked`), and both oracle-config tests (409 where 200/500 is expected). One more varies between runs (the dispute walk on one run, two-phase funding on another), which looks like testnet timing.

So **the live suite is red on `main` today, independent of any CI wiring.** That is the strongest argument for starting this workflow as a non-required check. Fixing those tests deserves its own issue; it was not attempted here.

## 6. Operational notes

- **Testnet resets** (roughly quarterly) wipe installed WASM and every contract, including `KNOWN_SETTLED_CONTRACT_ID`. After a reset: re-install the escrow WASM from `HarvestLock-Contracts` and update the `ESCROW_WASM_HASH` repo variable. Then either re-create a settled fixture contract and update the constant, or change those two read tests to deploy and settle their own fixture. The weekly scheduled run is there to surface a reset before a contributor's PR does.
- **Flakiness budget:** the suite already uses 30 s per-test timeouts for real RPC variance. Keep the workflow non-required until it has a few weeks of green history. Make it required only after that, if at all.
- **Cost:** none. Friendbot XLM is free, and Actions minutes on a public repo are free.
- **The live suite's own `buildServer()`** now also starts the SMS and KYB modules. Both default to inert settings (`SMS_PROVIDER=log`, `KYB_ENFORCEMENT=off`), so no extra configuration is needed. This workflow must **never** set `SMS_PROVIDER=termii`.

## 7. Decisions needed

1. Adopt Option A (ephemeral key, runs on PRs), or go straight to Option C?
2. Non-required check to start, as recommended?
3. Apply the §4.3 `api.yml` change so the network-free tests that already exist, plus the new ones, actually run?
4. Who owns re-uploading the escrow WASM after a testnet reset?
5. File a separate issue for the 4–5 live tests already failing on `main` (§5)?
