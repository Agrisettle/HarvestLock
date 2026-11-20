# Staging environment

> **Status:** Proposal and setup guide. Nothing here is provisioned yet.

Today a change is verified on a contributor's laptop, then merged to `main`,
which is what the hosted testnet deployment serves. This doc describes a
staging environment: a second, always-on copy of the stack where a branch can
be checked against real hosted infrastructure before it reaches `main`.

## What is deployed today

Everything below was checked against the files named, not written from memory.

| Piece | Where it runs | Config |
| --- | --- | --- |
| API (`api/`) | Render web service `harvestlock-api`, free plan | `render.yaml` |
| Database | External Neon Postgres (`DATABASE_URL`, set in the Render dashboard) | `render.yaml` comments |
| Migrations | `npm run migrate:prod` as Render's pre-deploy command | `render.yaml`, `api/src/db/migrate.ts` |
| buyer-app, coop-pwa, warehouse-app | One Vercel project serving `/buyer`, `/coop` and `/warehouse` | `vercel.json`, `vercel-build.sh` |
| Contract | One escrow WASM on Stellar testnet; the API deploys a new instance per commitment | `ESCROW_WASM_HASH` in `render.yaml` |
| Marketing site (`site/`) | GitHub Pages | `.github/workflows/gh-pages.yml` |

The frontends find the API through `VITE_API_URL`, read at build time in each
app's `src/api.ts` (falling back to `http://localhost:3000`). The API reads
`DATABASE_URL`, `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`,
`ESCROW_WASM_HASH`, `DEPLOYER_SECRET_KEY`, `PORT`, `CORS_ORIGINS` and
`NODE_ENV` (see `api/.env.example`).

None of the GitHub Actions workflows deploy anything except the GitHub Pages
site. They build and test, so a staging environment is a hosting setup rather
than a new workflow.

## Recommended setup

Staging stays on Stellar **testnet**, the same network as the current hosted
deployment. What it isolates is the API, the database and the deployer
account, so a staging run never writes to the database the hosted frontends
read.

### 1. A `staging` branch

Create a long-lived `staging` branch. To verify a change, merge or push the PR
branch into `staging`. Staging redeploys from it, and `main` is untouched until
the PR itself merges. Reset `staging` to `main` whenever it drifts.

### 2. A separate database

Create a separate Neon database for staging: either a new Neon project or a
branch of the existing one. Never point staging at the production
`DATABASE_URL`. Migrations run on every deploy, so an unmerged migration would
otherwise be applied to the shared database before review.

Starting from a Neon branch of the current database gives staging realistic
data. Note that `allocation_members` holds real phone numbers (see the
allocation ledger section of `api/README.md`), so prefer a schema-only branch,
or a fresh project, if production ever holds real members' data.

### 3. A second Render service

Add a second web service, for example `harvestlock-api-staging`, that is
identical to `harvestlock-api` except that it:

- deploys from the `staging` branch;
- uses the staging `DATABASE_URL`;
- uses its **own** `DEPLOYER_SECRET_KEY`: a separate funded testnet account,
  so staging deploys can't drain the production deployer's balance or collide
  with its sequence numbers;
- sets `CORS_ORIGINS` to the staging frontend origin (see step 4). The API
  never reflects arbitrary origins, so browser calls fail without this.

Keep `ESCROW_WASM_HASH` equal to production's unless the change being verified
is a new contract version. In that case, upload the new WASM to testnet and set
its hash on staging only.

You can add the service in the Render dashboard, or as a second entry under
`services:` in `render.yaml` with `branch: staging`. If you add it to
`render.yaml`, keep `DATABASE_URL` and `DEPLOYER_SECRET_KEY` as `sync: false`
there, the same as production.

### 4. Frontends on a stable preview URL

Vercel builds a preview deployment for every branch. For the `staging` branch:

- In the Vercel project's environment variables, set `VITE_API_URL` for the
  **Preview** environment (scoped to the `staging` branch) to the staging API's
  URL. Leave Production pointing at `harvestlock-api`.
- Use the branch's stable preview URL, or assign a domain to the branch, so
  `CORS_ORIGINS` on the staging API can list one exact origin. Per-commit
  preview URLs change on every deploy and would need `CORS_ORIGINS` updated
  each time.

**Required code change before this works:** `vercel.json` sets a
Content-Security-Policy on `/buyer` and `/coop` whose `connect-src` allows only
`'self'` and `https://harvestlock-api.onrender.com`. A browser will block a
preview build from calling any other API host. Either add the staging API's
origin to both `connect-src` lists, or drive the CSP from the deployment
environment. Until then, a staging frontend can only talk to the production
API.

## Verifying a change on staging

1. Merge the PR branch into `staging` and push.
2. Wait for both the Render staging service and the Vercel preview to finish
   deploying.
3. Check the API: `curl -s "$STAGING_API/health"` should return
   `{"ok":true,...}` with `"database":"ok"`.
4. Run the flow the change touches, either through the staging frontends or
   with the request collection in `api/postman/` with `baseUrl` set to the
   staging API.
5. Note in the PR what was verified on staging.

## Costs and limits

- Render's free plan spins an idle service down, so the first request after a
  quiet period is slow. That is acceptable for staging.
- Testnet is periodically reset by the Stellar Development Foundation. After a
  reset, both environments need the WASM re-uploaded, and their deployer and
  party accounts re-funded with Friendbot.
- Staging adds one Render service, one Neon database and one funded testnet
  account. Nothing here needs a paid plan.

## Open questions for maintainers

- Should the staging service be declared in `render.yaml` (reviewable in PRs)
  or kept dashboard-only?
- Who resets `staging` to `main`, and how often?
- Should the CSP change be a hard-coded second origin or environment-driven?
