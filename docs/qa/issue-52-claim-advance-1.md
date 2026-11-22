# Manual Freighter QA: claim advance tranche 1 (coop-pwa) — issue #52

## Scope and environment

- Flow: `coop-pwa/src/App.tsx` `handleClaim(1)` → `CommitmentDetail.tsx` tranche-1 button.
- Network: Stellar Testnet (`Test SDF Network ; September 2015`); RPC/Horizon defaults in `api/.env.example`.
- This workspace has no installed browser extension, no `ESCROW_WASM_HASH`, and no funded deployer key, so a **real Freighter popup and real on-chain drive could not be executed here**. The popup descriptions below are the expected dialog from the code/Freighter API, not an observation. Any claim of measured popup latency or exact popup wording would be fabricated.

## What was actually done

1. Traced the live path: build `claim_advance_1` XDR via `POST /commitments/:id/tx/claim_advance_1` → `freighterApi.signTransaction` → `POST /transactions/submit` → live `GET /commitments/:id` (`coop-pwa/src/App.tsx:146-213`, `coop-pwa/src/wallet.ts:62-86`, `api/src/server.ts:1238-1345`).
2. Added app-level coverage for the whole claim chain, including the case this issue specifically calls out — what happens when the submit is accepted but not yet confirmed:
   - `coop-pwa/src/App.test.tsx`: tranche-1 happy path, tranche-2 path, signing rejection, `202 PENDING` follow-up, post-submit read failure, offline queue + retry.
   - `coop-pwa/src/api.test.ts`: `GET /transactions/:hash`, PENDING polling to SUCCESS, terminal FAILED, bounded give-up.
   - `e2e/tests/coop-pwa.spec.ts`: real browser/API/testnet tranche-1 drive (already present) and a new tranche-2 test.
3. Ran `npm test` (147 passed), `npm run lint`, `npx tsc -b --noEmit`, `npm run build`, `npm run check:bundle-size` in `coop-pwa`. All pass; the only lint output is pre-existing warnings in unrelated files.

## Bugs found and fixed

| Finding | Fix |
| --- | --- |
| `POST /transactions/submit` can answer `202 {status:"PENDING", hash}` (documented API behavior). The old client typed only SUCCESS/FAILED and refreshed immediately, so it could render pre-claim state and never trigger the API's deferred `completeProposalId`/cache side effects. | `SubmitResult` now includes PENDING; `waitForTransaction()` polls `/transactions/:hash` to a terminal state before the UI refresh (`coop-pwa/src/api.ts:187-235`). |
| A failed refresh after a *confirmed* claim was wrapped in `OfflineError` and queued as a new claim intent, guaranteeing an `AlreadyClaimed` error on retry. | Build/sign/submit and post-submit read are separate phases; only pre-submit transport failures are queued (`coop-pwa/src/App.tsx:146-213`). |
| Selecting a different commitment while the Freighter popup was open could write the old commitment's refreshed detail under the new selection. | Late refresh is guarded against `selectedIdRef` (`coop-pwa/src/App.tsx:39-43, 199-203`). |
| The 5 s API read cache could serve the pre-claim snapshot to a fast signing flow. | `clearReadCache()` is called in the API's post-submit side effects (`api/src/server.ts:155-170`). |
| The 60 s signing timeout used the same "extension not installed" copy as the connect timeout, and left its timer running after success. | Signed-request-specific timeout message and `clearTimeout` on settlement (`coop-pwa/src/wallet.ts:39-96`). |

## Expected Freighter dialog (to confirm by hand)

- `signTransaction` transaction-signing popup for the cooperative account, testnet badge, `claim_advance_1()` invocation; fee/sequence preview; approve and reject both return through `throwIfError`/`signedTxXdr`.
- Rejection: error banner in the detail card, Claim button re-enabled, no POST to `/transactions/submit`.

## Remaining manual step for a maintainer with Freighter installed

Fund three testnet keypairs via friendbot, set up Locked + `release_advance_1`, run `coop-pwa`, connect the cooperative wallet, claim tranche 1, and compare the UI's `advance1_claimed` cell with `GET /commitments/:id` and the transaction hash status. Record the popup's actual title/buttons and the click→popup latency in a follow-up comment. Until that is done, this issue's real-extension half remains unverified; the code-level and injected-wallet coverage above is what this branch contributes.
