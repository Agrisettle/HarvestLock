# Runbook: Secrets Rotation (DEPLOYER_SECRET_KEY, API keys)

Use this when a HarvestLock secret needs to be rotated: a compromise is suspected, a team member with access leaves, or it's time for scheduled rotation.

The secret that matters most is `DEPLOYER_SECRET_KEY` — the Stellar/Soroban account secret key that pays network fees for deploying new commitment contracts. Other secrets include `DATABASE_URL` (Neon Postgres connection string) and any future API keys added as Render environment variables.

Never paste a real secret into chat, an issue, a PR, or a public log. Reference it by name only.

## What is a secret here

| Secret | Where it lives | What it does |
|---|---|---|
| `DEPLOYER_SECRET_KEY` | Render dashboard → `harvestlock-api` → Environment | Secret key of the Stellar account that funds commitment-contract deployment. Compromise means an attacker can deploy contracts at the deployer's expense. |
| `DATABASE_URL` | Render dashboard → `harvestlock-api` → Environment | Neon Postgres connection string, includes credentials. Compromise means read/write access to the commitment cache. |
| `ESCROW_WASM_HASH` | `.env.example`, Render config | Contract WASM hash, not a secret — but treat changes as configuration events. |
| `STELLAR_RPC_URL` | `.env.example`, Render config | Public RPC URL, not a secret. |

Check `api/.env.example` for the current list. Anything without a default value there and set in Render is a candidate secret.

## When to rotate

- `DEPLOYER_SECRET_KEY` or `DATABASE_URL` was accidentally committed, pasted in chat/issue/PR, or otherwise exposed.
- A person who knew the secret leaves the project or changes roles.
- Scheduled rotation (recommended every 90 days for `DEPLOYER_SECRET_KEY`).
- Any Render environment-variable change you did not initiate yourself.

## Before you start

1. Confirm you have access to the Render dashboard for the `harvestlock-api` service.
2. Have a fresh, funded Stellar testnet keypair ready for `DEPLOYER_SECRET_KEY` if rotating that key.
3. If rotating `DATABASE_URL`, have the new Neon connection string ready.
4. Tell the team in the normal operations channel that a rotation is starting. The API will briefly be unable to deploy new commitment contracts during `DEPLOYER_SECRET_KEY` rotation.

## Rotation procedure

### Step 1: Generate the new secret

**`DEPLOYER_SECRET_KEY`:**
```sh
stellar keys generate harvestlock-deployer-new
stellar keys address harvestlock-deployer-new
```
Fund the new public address on Stellar testnet (friendbot or faucet) so it can pay network fees.

**`DATABASE_URL`:**
Create a new Neon database or rotate the Neon password in the Neon console, then copy the new connection string.

Fund it above `DEPLOYER_MIN_BALANCE_XLM` (default 10 XLM): `POST /commitments/deploy` returns 503 while the deployer is below that floor, and logs a warning below `DEPLOYER_BALANCE_WARN_XLM` (default 25). The route is also limited per IP by `DEPLOY_RATE_LIMIT_MAX` / `DEPLOY_RATE_LIMIT_WINDOW_MS` (default 5 per 10 minutes). Tune all four in Render's environment.

### Step 2: Add the new secret to Render

1. Open the Render dashboard → `harvestlock-api` service → Environment.
2. Add the new value under a temporary name (e.g. `DEPLOYER_SECRET_KEY_NEW` or `DATABASE_URL_NEW`). Do not overwrite the current secret yet.
3. Save. Render will redeploy the API with the new variable available but unused.

### Step 3: Verify the new secret works

**`DEPLOYER_SECRET_KEY`:**
Deploy a test commitment contract through the API using the new key (point the API at the temporary variable first, or test locally with the new key in `.env`). Confirm the deployment transaction succeeds on testnet.

**`DATABASE_URL`:**
```sh
curl -i "$API_URL/health"
```
Both `api` and `database` checks should return `ok`.

### Step 4: Swap to the new secret

1. In the Render dashboard, replace the current secret value with the new one (same variable name, new value).
2. Save. Render redeploys the API.

### Step 5: Verify after swap

1. `GET /health` returns HTTP `200` with both checks `ok`.
2. For `DEPLOYER_SECRET_KEY`: create a test commitment through the API and confirm it deploys on-chain.
3. For `DATABASE_URL`: `GET /commitments` returns a JSON array.

### Step 6: Revoke the old secret

**`DEPLOYER_SECRET_KEY`:**
Do not delete the old Stellar account from the ledger (impossible on-chain). Instead, stop funding it and stop using it. If you suspect compromise, move any remaining balance from the old address to the new one immediately.

**`DATABASE_URL`:**
Revoke the old Neon password or delete the old database in the Neon console once the new one is confirmed working.

### Step 7: Tell the team

Post in the operations channel: what was rotated, when, who did it, and that verification passed.

## Rollback

If the new secret fails verification:

1. Revert the Render environment variable to the previous value and redeploy.
2. Confirm `GET /health` is green again.
3. Investigate the failure before retrying rotation.

Do not leave both old and new secrets valid longer than necessary. If the new secret was ever exposed, treat it as compromised too and rotate again.

## After recovery

Record the rotation time, the secret rotated, the verifier, and any issues in the operations channel. Update `HANDOFF.md` if the rotation changed any documented procedure (e.g. a new deployer address is now referenced elsewhere).

## Prevention

- Never commit `.env`, `.env.local`, or any file containing real secrets.
- Never paste secrets into GitHub issues, PRs, comments, or chat.
- Use Render's secret masking (environment variables are masked in Render logs by default).
- Review `SECURITY.md` before reporting any suspected secret exposure.