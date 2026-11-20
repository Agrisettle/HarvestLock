# Manual Freighter QA runbook: flag a dispute (buyer-app)

> **Status: prepared, not executed.** This runbook was written in a headless environment with no installed Freighter browser extension, no funded testnet keypairs, and no ability to approve wallet popups. Every “Actual observation” field is left for a human tester to complete during a real run. This document is intended to support verification on **#48** once executed.

**Issue:** #48 — Manual Freighter QA: flag a dispute (buyer-app)  
**Flow:** `DisputeSection.tsx` → `handleFlag` (single-signer `flag_dispute`)  
**App:** `buyer-app` (React + Vite, testnet)  
**Date prepared:** 2026-11-20

## Scope

Verify end to end, against a real installed Freighter extension and real Stellar testnet:

1. Build/sign/submit `flag_dispute` as an authorized party.
2. Confirm what Freighter actually shows in the popup for this transaction.
3. Confirm the `buyer-app` UI and commitment status reflect `Disputed` after success.
4. Capture any real bugs (open separate issues and link them from #48).

## Code trace (what the app actually does)

- **Component:** `buyer-app/src/components/DisputeSection.tsx`
  - Renders dispute UI only when connected wallet is a party (`buyer`, `cooperative`, or `warehouse_operator`) and commitment is disputable or already disputed.
  - **Disputable statuses for flagging:** `Locked`, `Advance1Released`, `CheckpointPassed`, `Advance2Released`, `ReadyForDelivery`, `Delivered` (`Draft` and terminal statuses excluded).
  - **Flag path (`handleFlag`, when not yet `Disputed`):**
    1. `buildFlagDisputeTx(contractId, walletAddress, walletAddress)` — builds unsigned `flag_dispute` XDR (`POST /commitments/:contractId/tx/flag-dispute`, flagged as retry-safe build).
    2. `signTransactionXdr(xdr, walletAddress)` — Freighter signs a **transaction envelope**. Wallet sign timeout: **60,000 ms** (`buyer-app/src/wallet.ts`).
    3. `submitTx(signedXdr, contractId)` — submits and refreshes commitment cache (no proposal id).
    4. On success: calls `onDisputeChanged()` (parent refreshes commitment).
  - **Not multi-party:** unlike cancel/reassign/resolve, flagging has no propose/sign/finalize staging and no auth-entry signing.
  - When already `Disputed`, the section shows frozen/disputed messaging and resolution actions instead (see #49).
- **Wallet/network:** `NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"` (testnet). Connect timeout 10s.

## Prerequisites

| Item | Details |
|---|---|
| Browser | Desktop browser with **Freighter** extension installed and unlocked |
| Freighter network | **Testnet** (“Test SDF Network ; September 2015”). Record behavior if mis-set |
| Keypair (funded on testnet) | A `G...` that is **buyer, cooperative, or warehouse operator** on the target commitment — **signer under test for #48**. (Any of these parties may flag per contract/API; test at least one, ideally note which.) |
| Commitment state | Commitment in a **disputable** status: `Locked`, `Advance1Released`, `CheckpointPassed`, `Advance2Released`, `ReadyForDelivery`, or `Delivered`, and **not** already `Disputed`. |
| Apps/services | `api/` running/reachable at `VITE_API_URL` (default `http://localhost:3000`); `buyer-app/` running; correct CORS if cross-origin. |
| Optional cross-check | Horizon/Stellar Expert (testnet) and/or `GET /commitments/:contractId` to confirm status becomes `Disputed`. |

## Step-by-step procedure

1. **Select/prepare a disputable commitment**
   - Identify a commitment in a disputable, non-disputed state where the test wallet is a named party.

2. **Connect as an authorized party**
   - In Freighter, select the party keypair. Connect wallet in buyer-app and open the target commitment.

3. **Verify preconditions in UI**
   - Dispute section is visible and shows **“Flag a dispute”** button (enabled when not busy).
   - If not visible, confirm connected address matches `buyer`/`cooperative`/`warehouse_operator` and status is disputable.

4. **Trigger flag (observe Freighter popup)**
   - Click **“Flag a dispute”**. Button label changes to “Flagging…” and is disabled while busy.
   - **Observe Freighter:** this is a `signTransaction` request for `flag_dispute`. Record exactly what Freighter displays (origin/site, action type, network, source account, fee/time bounds if shown, contract/function details, warnings).

5. **Rejection path (recommended)**
   - Repeat step 4 but **Reject/Cancel** in Freighter.
   - **Expected (code-level):** error surfaced in section banner; UI remains usable; commitment status unchanged.

6. **Approve/sign path (happy path)**
   - Click **“Flag a dispute”** and **Approve/Sign** in Freighter.
   - **Expected (code-level):** app submits signed XDR; on success calls `onDisputeChanged()` and refreshed UI should show disputed state.

7. **Post-action verification**
   - **UI:** commitment shows `Disputed`-related state/messaging (“This commitment is disputed — every other action is frozen until it's resolved.” once refreshed into disputed view) and flag button is no longer the primary action.
   - **API/chain-adjacent:** `GET /commitments/:id` reports `status` as `Disputed` (and any dispute metadata exposed by API). Capture tx hash from network tab/submit response if visible.
   - **Explorer:** confirm successful `flag_dispute` transaction on testnet.

8. **Negative/edge checks (optional but valuable)**
   - Connect as a non-party address: dispute section must not render actions.
   - Attempt on a non-disputable state (e.g. `Draft`, terminal, or already `Disputed`): flag action should not be available.
   - Freighter locked/unresponsive: expect timeout/error after ~60s.
   - Network mismatch (Freighter on Mainnet): record actual behavior.

## Observation log (fill during execution)

| Step | Action | Freighter showed (exact text/fields) | UI result | On-chain/commitment result (hash/status) | Match? | Notes |
|---|---|---|---|---|---|---|
| 2 | Connect wallet (party/role: ___) | | | n/a | | |
| 4 | Flag — popup contents | | | n/a | | |
| 5 | Reject in Freighter | n/a | | | | |
| 6 | Approve/sign in Freighter | n/a | | | | |
| 7 | Post-submit / refresh | n/a | | | | |

## Known limitations / related issues (context)

- **Single-signer flow:** no staged proposal/ready-XDR refresh involved; **#443** (stale ready finalize XDR) does not apply to flagging itself.
- **#441 (separate):** 202 PENDING/slow submit UX handling is tracked separately and may affect perceived submit behavior.
- **Environment constraint:** this document records a prepared procedure only; no real Freighter popup/signing was executed here.

## Outcome (to be completed by tester)

- **Result:** ☐ Pass ☐ Fail ☐ Blocked
- **Tester / date / environment / build-commit:** 
- **Commitment ID(s) / tx hash(es) / party role tested:** 
- **Bugs found:** (open separate issues and link them from #48)
