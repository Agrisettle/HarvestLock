# Manual Freighter QA — lock a Draft commitment (buyer-app) — issue #40

**Status: runbook + code-traced expectations only. The manual Freighter
run has NOT been performed yet.**

The PR that adds this file was prepared in a headless dev container: no
browser, no Freighter extension, nobody to approve a popup. Nothing below
reports what Freighter "showed". Every Freighter observation field is
blank and marked `TODO (tester)`. Issue #40 stays open until a person
fills those in after a real run. What this file does contain:

1. The exact steps for that run, with the setup gaps that would otherwise
   cost a tester time (CORS, token funding, which key must be connected).
2. What the code says *should* happen at each step, traced from source,
   so the tester can compare against it instead of only noting "it worked".
3. Three code-level findings to confirm or rule out during the run.

---

## 1. The flow under test

`buyer-app/src/App.tsx` `handleAction("lock")`:

```
buildTx(contractId, "lock", walletAddress)        POST /commitments/:id/tx/lock
  -> signTransactionXdr(xdr, walletAddress)       Freighter signTransaction popup (60 s timeout)
  -> submitTx(signedXdr, contractId)              POST /transactions/submit (API polls up to 30 s)
  -> getCommitment(contractId)                    GET /commitments/:id (live chain read)
  -> setDetail(...)                               UI re-renders
```

The "Lock deposit" button only renders when
`primaryAction()` (`buyer-app/src/components/CommitmentDetail.tsx`) sees
`status === "Draft"` **and** the connected address is exactly
`commitment.buyer`. Any other connected account gets no button.

On-chain, `lock()` calls `buyer.require_auth()` and escrows only the
**deposit** (`advance1_bps + advance2_bps` of `total_amount`), not the full
amount; the rest comes later via `fund_remainder`. This is covered by the
"two-phase funding" case in `api/test/stellar.test.ts`.

## 2. Keypairs needed

`lock` is single-signer, so the tester needs **two** funded testnet
accounts. A third is optional:

| Role | Needs to be in Freighter? | Why |
|---|---|---|
| Buyer | **Yes**, it is the account that signs `lock` | `require_auth(buyer)`; also the envelope source |
| Cooperative | No, an address is enough | Required `initialize` field; must differ from buyer for a realistic run |
| Warehouse operator | No | Required `initialize` field; can reuse the cooperative's address |
| Non-buyer (optional) | Yes, as a second Freighter account | Negative check: confirm no "Lock deposit" button |

Fund each with Friendbot (`https://friendbot.stellar.org/?addr=G...`). See
`docs/runbooks/friendbot-rate-limiting.md` if that gets throttled.

**Token:** use the native-XLM Stellar Asset Contract on testnet,
`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (the same one
`api/test/stellar.test.ts` uses). Friendbot's 10,000 XLM already covers
it, so no trustline or minting is needed. Keep `totalAmount` small (for
example `100000000` stroops = 10 XLM) so the deposit is well within the
buyer's balance after fees.

## 3. Environment setup

1. API: `cd api && cp .env.example .env`, then fill `DATABASE_URL`,
   `ESCROW_WASM_HASH`, `DEPLOYER_SECRET_KEY` (a funded testnet key).
   **Also set `CORS_ORIGINS=http://localhost:5173`**, or whatever port Vite
   prints. It is unset by default, and unset means *no* cross-origin
   access, so every buyer-app request fails. `npm ci && npm run dev`.
2. buyer-app: `cd buyer-app && npm ci && cp .env.example .env && npm run dev`.
3. Freighter: install from the Chrome Web Store / Firefox Add-ons, import
   the buyer secret key, then **switch the network to Testnet** (Settings →
   Network). Note the extension version under **Observations**.

## 4. Steps, expected behaviour, and observations

Fill in every `TODO (tester)` cell during the real run. "Expected" is
traced from the code, not observed.

| # | Action | Expected (from code) | Freighter showed | UI showed | Match? |
|---|---|---|---|---|---|
| 1 | Click **Connect wallet** | `requestAccess()` popup; on approve the buyer `G...` address appears. If the extension is missing, the error appears after 10 s instead of hanging. | TODO (tester) | TODO (tester) | TODO |
| 2 | Create a commitment with the form (buyer = connected wallet, coop/warehouse = other address, token = XLM SAC). Signs `initialize`. | Deploy → `initialize` sign popup → submit → detail loads with status **Draft**. | TODO (tester) | TODO (tester) | TODO |
| 3 | On the Draft detail, check the button | **"Lock deposit"** visible, enabled. | n/a | TODO (tester) | TODO |
| 4 | Click **Lock deposit** | Button shows "Locking…" and is disabled (`aria-busy`). Freighter `signTransaction` popup opens. | TODO (tester): record what the popup shows (contract ID, function `lock`, auth entries, fee, network label) | TODO (tester) | TODO |
| 5 | **Reject** in the popup (first attempt) | Freighter returns an error → red `role="alert"` banner with its message; button re-enables; status stays Draft; nothing submitted. | TODO (tester): exact rejection text | TODO (tester): exact banner text | TODO |
| 6 | Click **Lock deposit** again and **approve** | Submit → API waits for confirmation (up to 30 s) → live re-read → status **Locked**, button disappears. | TODO (tester) | TODO (tester) | TODO |
| 7 | Cross-check chain state independently | `stellar.expert/explorer/testnet/contract/<id>` shows the `lock` invocation, and buyer XLM drops by the deposit + fee. `GET /commitments/<id>` returns `"status":"Locked"`. | n/a | TODO (tester): tx hash, explorer link | TODO |
| 8 | Reload the page and reopen the commitment | Still **Locked** (from chain, not stale React state). The list row (Postgres cache, refreshed by `refreshContractId`) also says Locked. | n/a | TODO (tester) | TODO |
| 9 | (Optional) Switch Freighter to the non-buyer account, reconnect, open a different Draft commitment | No "Lock deposit" button. | n/a | TODO (tester) | TODO |
| 10 | (Optional) Click **Lock deposit**, leave the popup open > 60 s, then approve | See finding F2 below. | TODO (tester) | TODO (tester) | TODO |

### Observations

- Freighter version: TODO (tester)
- Browser + version: TODO (tester)
- Date of run: TODO (tester)
- Contract ID / lock tx hash: TODO (tester)
- Anything Freighter showed that a buyer could misread: TODO (tester)

## 5. Code-level findings to confirm during the run

These come from reading the code. None was observed in a real run, so
none has been filed as a bug yet. The tester should confirm or rule out
each one and file confirmed ones as their own issues, linked from #40.

**F1: a slow-confirming lock looks like a silent no-op.**
`POST /transactions/submit` answers **202 `{status: "PENDING"}`** when
confirmation outlives the API's 30 s poll (`api/src/server.ts`, and
`submitSignedTransaction` in `api/src/stellar/tx.ts`). buyer-app's
`SubmitResult` type (`buyer-app/src/api.ts`) only knows
`"SUCCESS" | "FAILED"`. `post()` treats any 2xx as success, so
`handleAction` goes straight to `getCommitment()`. That read can still
return **Draft**, and the UI shows no error and no pending notice. The
button reappears and the buyer may click it again; a second `lock` should
then fail on-chain because status is no longer Draft. Nothing in buyer-app
calls `GET /transactions/:hash`. Hard to trigger on demand, but testnet
congestion can do it.

**F2: approving after the 60 s timeout gives a misleading error.**
`signTransactionXdr` races Freighter against a 60 s timer
(`buyer-app/src/wallet.ts`). If the buyer takes longer, the UI shows
"No response from Freighter — is the extension installed and unlocked?"
even though the popup is open. Approving afterwards produces a signature
nobody submits (safe, since there is no double-submit), but the message
points the buyer at the wrong cause. Step 10 checks what really happens,
including whether Freighter closes or keeps the popup.

**F3: Freighter on the wrong network.**
The app hard-codes the testnet passphrase (`NETWORK_PASSPHRASE` in
`wallet.ts`) and passes it to `signTransaction`. What Freighter does when
it is set to Mainnet (refuses, prompts to switch, or signs anyway) is
decided by the extension, not by this code. Worth one try with Freighter
on Mainnet at step 4: note the exact message and whether the UI banner
makes sense to a buyer.
