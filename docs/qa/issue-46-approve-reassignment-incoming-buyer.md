# Manual Freighter QA runbook: approve a reassignment as the incoming buyer (buyer-app)

> **Status: prepared, not executed.** This runbook was written in a headless environment with no installed Freighter browser extension, no funded testnet keypairs, and no ability to approve wallet popups. Every “Actual observation” field is left for a human tester to complete during a real run. This document is intended to be posted as (or adapted into) the verification comment on **#46** once executed.

**Issue:** #46 — Manual Freighter QA: approve a reassignment as the incoming buyer (buyer-app)  
**Flow:** `ReassignBuyerSection.tsx` → `handleApprove`  
**App:** `buyer-app` (React + Vite, testnet)  
**Date prepared:** 2026-11-20

## Scope

Verify end to end, against a real installed Freighter extension and real Stellar testnet:

1. Build/sign/submit the incoming buyer’s approval of a staged `reassign_buyer` proposal.
2. Confirm what Freighter actually shows in the popup at each step.
3. Confirm the `buyer-app` UI reflects the new on-chain/proposal state after the action.
4. Capture any real bugs (open separate issues and link them from #46).

## Code trace (what the app actually does)

- **Component:** `buyer-app/src/components/ReassignBuyerSection.tsx`
  - Renders for reassignable statuses: `Draft`, `Locked`, `Advance1Released`, `CheckpointPassed`, `Advance2Released`, `ReadyForDelivery`.
  - Visibility for a connected wallet: current buyer, a pending signer (`proposal.pending_entries` contains the address), or `justApproved` (local session state only).
  - Polls `getReassignBuyerProposal(contractId)` every 10s while `proposal.status === "pending"`; on mount; refresh is best-effort (errors swallowed).
  - **Approve path (`handleApprove`):**
    1. Finds `myEntry = proposal.pending_entries.find(e => e.address === walletAddress)`; returns if none.
    2. `signAuthEntry(myEntry.entry_xdr, walletAddress)` — Freighter signs a **single Soroban authorization entry** (not a transaction envelope). Wallet timeout: **60,000 ms** with message `No response from Freighter — is the extension installed and unlocked?` on timeout (`buyer-app/src/wallet.ts`).
    3. `signMultisigProposal(contractId, proposal.id, walletAddress, signedEntryXdr)` — POST to API, records signed entry; may flip proposal to `ready` when all non-source entries are signed.
    4. UI sets `proposal` to server response and `justApproved = true`. If the signer is no longer in `pending_entries`, UI shows: “Approved — waiting for the other party to approve too.” (Note: `justApproved` does **not** survive a page reload; see known limitations.)
- **Wallet/network:** `NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"` (testnet, hardcoded). `connectWallet()` uses `requestAccess()` with **10,000 ms** timeout.
- **API:** staged multi-party `reassign_buyer` requires auth from outgoing (current) buyer, cooperative, and incoming buyer (`HarvestLock-Contracts` `reassign_buyer` + `require_once_each`). Only the current buyer may propose; the other two approve by signing their auth entries.

## Prerequisites

| Item | Details |
|---|---|
| Browser | Desktop browser with **Freighter** extension installed and unlocked |
| Freighter network | **Testnet** (“Test SDF Network ; September 2015”). A network mismatch can cause signing to fail or behave unexpectedly — record what happens if mis-set |
| Keypairs (funded on testnet) | **(1) Outgoing/current buyer** `G...` — proposes reassignment and later finalizes (#47). **(2) Cooperative** `G...` — must approve. **(3) Incoming/new buyer** `G...` — **the signer under test for #46** (must appear in `pending_entries`). Fund via friendbot as needed. |
| Commitment state | A reassignable commitment (e.g. `Draft`/`Locked`/…) where `commitment.buyer` is keypair (1). A `reassign_buyer` proposal must be **active and pending** with the incoming buyer still in `pending_entries` (i.e. they have not signed yet). |
| Apps/services | `api/` running and reachable at `VITE_API_URL` (default `http://localhost:3000`); `buyer-app/` running (`npm run dev`); CORS configured to allow the buyer-app origin if served cross-origin. |
| Optional cross-check | Horizon/Stellar Expert (testnet) or contract state via `GET /commitments/:contractId` to confirm proposal/state changes independently of the UI. |

## Step-by-step procedure

1. **Prepare the commitment and proposal**
   - Create or select a commitment whose current buyer is keypair (1) and is in a reassignable status.
   - As keypair (1), connect in buyer-app and propose reassignment to keypair (3)’s address (enter `G...` in “Reassign to a new buyer”). Confirm a pending proposal exists (UI shows waiting for cooperative and new buyer, or via `GET /commitments/:id/tx/reassign-buyer/propose`).

2. **Connect as the incoming buyer (signer under test)**
   - In Freighter, select keypair (3). In buyer-app, click **Connect wallet** and approve access.
   - Open the commitment detail for the target contract.

3. **Verify preconditions in UI**
   - Section shows: “The current buyer wants to reassign this commitment to a new buyer.” and an **“Approve reassignment”** button (enabled when not busy).
   - If the button is absent, confirm the connected address matches a `pending_entries.address` for the active proposal.

4. **Trigger approve (observe Freighter popup)**
   - Click **“Approve reassignment”**. Button label changes to “Approving…” and is disabled while busy.
   - **Observe Freighter:** this is a `signAuthEntry` request (single auth entry). Record exactly what Freighter displays (origin/site, action type wording, network, account, any contract/function/entry details, warnings).

5. **Rejection path (recommended)**
   - Repeat step 4 but click **Reject/Cancel** in Freighter. 
   - **Expected (code-level):** error is surfaced in the section’s error banner; UI remains usable; proposal unchanged.

6. **Approve path (happy path)**
   - Click **“Approve reassignment”** and **Approve/Sign** in Freighter.
   - **Expected (code-level):** app POSTs signed entry to `/tx/propose/:id/sign`; on success shows “Approved — waiting for the other party to approve too.” (when still pending and this signer no longer listed) and clears busy state.

7. **Post-action verification**
   - **UI:** confirm waiting/approved state; no crash; button no longer offers approve for this signer.
   - **API/chain-adjacent:** poll `GET /commitments/:id/tx/reassign-buyer/propose` — `pending_entries` should no longer include keypair (3). If cooperative also signed, proposal may be `ready`.
   - **Refresh behavior:** reload the page while still pending — note whether the UI can still represent “you already approved” (known gap: `justApproved` is session-local and the API stops listing signed parties in `pending_entries`).

8. **Negative/edge checks (optional but valuable)**
   - Connect as an unrelated address: approve UI must not appear.
   - Attempt approve with Freighter locked/unresponsive: expect timeout/error after ~60s.
   - Network mismatch (Freighter on Mainnet): record actual behavior.

## Observation log (fill during execution)

| Step | Action | Freighter showed (exact text/fields) | UI result | On-chain/proposal result (hash/state/`pending_entries`/status) | Match? | Notes |
|---|---|---|---|---|---|---|
| 2 | Connect wallet (incoming buyer) | | | n/a | | |
| 4 | Approve — popup contents | | | n/a | | |
| 5 | Reject in Freighter | n/a | | | | |
| 6 | Approve in Freighter | n/a | | | | |
| 7 | Post-action / refresh | n/a | | | | |

## Known limitations / related issues (context)

- **Page-reload gap:** once a signer’s entry is recorded, `pending_entries` no longer names them and `justApproved` is local-only; after reload the UI may not be able to prove “this wallet already approved” until `ready` (documented in component).
- **Finalize staleness (separate step, #47):** ready proposals previously could fail to finalize after delay due to stale `ready_xdr`; addressed by `POST /tx/propose/:id/refresh-ready` + app changes (see #443 / PR for this work). Approve itself is unaffected, but end-to-end reassignment completion depends on finalize.
- **Slow submit UX:** 202 PENDING handling is tracked separately (#441) and may affect any submit-based step (not this approve POST, but relevant to surrounding flows).

## Outcome (to be completed by tester)

- **Result:** ☐ Pass ☐ Fail ☐ Blocked
- **Tester / date / environment:** 
- **Commitment ID(s) / proposal ID(s) / tx hashes:** 
- **Bugs found:** (open separate issues and link them from #46) 
