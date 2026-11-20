# Manual Freighter QA — create a commitment (deploy → initialize) (buyer-app) — issue #39

**Status: runbook, code-traced expectations, and one code-confirmed
finding. The manual Freighter run has NOT been performed yet.**

This was prepared in a headless dev container with no Freighter extension
and nobody to approve a signing popup, so nothing below reports what
Freighter "showed". Every Freighter observation is `TODO (tester)`. Issue
#39 needs a person to do the real run and fill those in (a comment on the
issue is fine, per the issue). The sister runbook for **lock**
(issue #40) is `docs/qa/issue-40-lock-draft-commitment.md` (PR #440). It
uses the same setup, so the two runs fit in one sitting.

---

## 1. The flow under test

`handleCreateCommitment` in `buyer-app/src/App.tsx`:

```
deployCommitment()                          POST /commitments/deploy        deployer-paid, NO wallet involved
  -> buildInitializeTx(contractId, fields)  POST /commitments/:id/tx/initialize
  -> signTransactionXdr(xdr, buyer)         Freighter signTransaction popup (60 s timeout)
  -> submitTx(signedXdr, contractId)        POST /transactions/submit (API waits up to 30 s)
  -> refreshList(); loadDetail(contractId)  form closes, new commitment opens as Draft
```

- **The buyer is always the connected wallet**, never a form field.
  `initialize` sets `buyer: walletAddress` and requires the buyer's auth.
- **Deploy happens before the buyer signs anything.** The API's deployer
  key pays for it. It is rate-limited to 5 per 10 minutes per client IP
  (`DEPLOY_RATE_LIMIT_MAX` / `DEPLOY_RATE_LIMIT_WINDOW_MS`) and refused if
  the deployer balance is below `DEPLOYER_MIN_BALANCE_XLM`.
- **The create form only shows with a connected wallet.** Client-side
  validation (windows, advance %, grade schedule, oracle fields, consent
  checkbox) runs before any network call.

## 2. Keypairs and addresses

| Role | In Freighter? | Notes |
|---|---|---|
| Buyer | **Yes**, it signs `initialize` | Fund with Friendbot |
| Cooperative | No, an address is enough | A second funded account, so later QA (claim, cancel) can use it |
| Warehouse operator | No | Can reuse a third address, or the cooperative's |
| API deployer | No, it lives in `api/.env` | `DEPLOYER_SECRET_KEY`; must hold > `DEPLOYER_MIN_BALANCE_XLM` (10) XLM |

**Token:** testnet native-XLM SAC
`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (same as
`api/test/stellar.test.ts`).

**Optional FX run:** Reflector's testnet fiat oracle
`CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W` with price
asset `GBP`. It does not quote NGN, per `api/README.md`. With FX on, the
new commitment page shows the live FX estimate range added for issue #8.

## 3. Environment setup

1. API: `cd api && cp .env.example .env`, fill `DATABASE_URL`,
   `ESCROW_WASM_HASH`, `DEPLOYER_SECRET_KEY`, **and
   `CORS_ORIGINS=http://localhost:5173`**. When that's unset, every
   cross-origin request fails. Then `npm ci && npm run dev`.
2. buyer-app: `cd buyer-app && npm ci && cp .env.example .env && npm run dev`.
3. Freighter: install it, import the buyer key, **switch to Testnet**, and
   note the extension version.

## 4. Steps, expected behaviour, observations

| # | Action | Expected (from code) | Freighter showed | UI showed | Match? |
|---|---|---|---|---|---|
| 1 | Connect wallet | `requestAccess` popup; buyer address shown in header; **Create commitment** button appears | TODO (tester) | TODO (tester) | TODO |
| 2 | Open the form and submit it empty | Client-side validation error banner (`role="alert"`). **No** network call: check DevTools → Network for no `/commitments/deploy` | n/a | TODO (tester) | TODO |
| 3 | Fill a valid plain deal (FX off): coop/warehouse addresses, XLM SAC, total `10`, advances 15% / 20%, claim window 1 hour, quantity `1000`, tick consent. Submit | Button shows "Creating…" and is disabled. `POST /commitments/deploy` → 201 `{contractId}`, then `/tx/initialize`, then the Freighter popup | TODO (tester): what does the popup show? Contract ID, function `initialize`, how the 13 args render (does a buyer see amounts/addresses they can check?), fee, network | TODO (tester) | TODO |
| 4 | **Reject** in Freighter | Error banner with Freighter's message; form stays open with values kept; nothing submitted. **The deployed contract from step 3 is now orphaned** (see C1) | TODO (tester): exact text | TODO (tester): exact text | TODO |
| 5 | Submit again and **approve** | A **new** `/commitments/deploy` call (new contract ID, see C1) → sign → submit → form closes, list refreshes, new commitment opens as **Draft** with buyer = you | TODO (tester) | TODO (tester): contract ID, tx hash | TODO |
| 6 | Cross-check chain state | `GET /commitments/<id>` shows `"status":"Draft"`, every field as entered (amount in 7-decimal units: 10 XLM = `100000000`). Explorer shows the `initialize` invocation signed by the buyer | n/a | TODO (tester) | TODO |
| 7 | Reload the page | New commitment is still in "What you've locked" (Postgres cache, refreshed by `refreshContractId` on submit) | n/a | TODO (tester) | TODO |
| 8 | Check the orphan from step 3/4 | `GET /commitments/<first id>` answers 404 (contract never initialized, per `api/README.md`). It never appears in the list | n/a | TODO (tester) | TODO |
| 9 | (Optional) FX deal: tick FX conversion, oracle above, asset `GBP`, deal value e.g. `5000000000` | Same as 3–6, plus the new commitment page shows **FX estimate** with a ± range and "Estimate, not a quote". `GET .../oracle-config` round-trips all 4 fields | TODO (tester): how does the popup render the `Option<OracleConfig>` struct? | TODO (tester) | TODO |
| 10 | (Optional) Rate limit: reject 5 times in a row within 10 minutes, then try a 6th | The 6th attempt fails at `/commitments/deploy` with 429 before any popup (see C1) | n/a | TODO (tester): exact banner text | TODO |

### Observations

- Freighter version / browser: TODO (tester)
- Date of run: TODO (tester)
- Created contract ID / `initialize` tx hash: TODO (tester)
- Orphaned contract ID(s) from rejected attempts: TODO (tester)
- Anything in Freighter's popup a buyer could misread: TODO (tester)

## 5. Findings

**C1: every retry deploys a new contract (code-confirmed).**
`handleCreateCommitment` calls `deployCommitment()` on every submit, before
the buyer signs. If the buyer rejects in Freighter, or the 60 s signing
timeout fires, that contract is left deployed but uninitialized. The
next click deploys another one. A throwaway component test (not committed)
confirmed it: after one rejected signature, retrying made **two**
`/commitments/deploy` calls and pointed `initialize` at the second contract.
Consequences:
- Each abandoned attempt spends deployer XLM on a contract nobody will use.
- A buyer who rejects or times out 5 times within 10 minutes hits the deploy
  rate limit (429) and can't create anything until the window passes. The
  banner will be a raw `/commitments/deploy -> 429: …` message.

A natural fix is to keep the deployed-but-uninitialized contract ID for
the life of the form and retry only build → sign → submit against it.
This needs the real run (steps 4, 5, 8 and 10) to show what a buyer actually
experiences before it's filed as its own issue.

**F1 (shared with #40): slow confirmation looks like nothing happened.**
If `initialize` takes over 30 s to confirm, the API answers 202 PENDING.
Without the fix in PR #442 (issue #441), the form closes and loads a
contract that may not be initialized yet, which reads as an error. With
#442 merged, the app waits for confirmation instead.

**F2 (shared with #40): 60 s signing timeout.** Reviewing 13 `initialize`
arguments in Freighter can take longer than reviewing a no-argument
`lock`. If the buyer is still reading at 60 s, the UI reports "No response
from Freighter — is the extension installed and unlocked?" and C1 then
applies on retry. Worth timing step 3 during the real run.
