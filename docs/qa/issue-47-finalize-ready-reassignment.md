# Manual Freighter QA runbook: finalize a ready reassignment (buyer-app)

> **Status: prepared, not executed.** This runbook was written in a headless environment with no installed Freighter browser extension, no funded testnet keypairs, and no ability to approve wallet popups. Every “Actual observation” field is left for a human tester to complete during a real run. This document is intended to support verification on **#47** once executed.

**Issue:** #47 — Manual Freighter QA: finalize a ready reassignment (buyer-app)  
**Flow:** `ReassignBuyerSection.tsx` → `handleFinalize` (staged multi-party `reassign_buyer`)  
**App:** `buyer-app` (React + Vite, testnet)  
**Date prepared:** 2026-11-20

## Scope

Verify end to end, against a real installed Freighter extension and real Stellar testnet:

1. Finalize a `reassign_buyer` proposal that is already `ready` (all required approvals collected).
2. Confirm what Freighter actually shows when signing the finalize transaction envelope.
3. Confirm the `buyer-app` UI and commitment/proposal state reflect successful reassignment after submit.
4. Capture any real bugs (open separate issues and link them from #47).

## Code trace (what the app actually does)

- **Component:** `buyer-app/src/components/ReassignBuyerSection.tsx`
  - Reassignable statuses: `Draft`, `Locked`, `Advance1Released`, `CheckpointPassed`, `Advance2Released`, `ReadyForDelivery`.
  - Polls `getReassignBuyerProposal(contractId)` on mount and every 10s while `proposal.status === "pending"` (best-effort; errors swallowed). Proposal becomes visible/refreshable when connected wallet is current buyer, a pending signer, or `justApproved`.
  - **Finalize UI:** shown only when `proposal.status === "ready"` **and** `proposal.proposer_address === walletAddress` (the current/outgoing buyer who proposed). Other parties see: “Approved — waiting for the current buyer to finalize.”
  - **Finalize path (`handleFinalize`):**
    1. Requires `proposal.ready_xdr` to be present.
    2. `refreshReadyProposalXdr(contractId, proposal.id)` — `POST /commitments/:contractId/tx/propose/:proposalId/refresh-ready` to rebuild/return a fresh finalize XDR (addresses stale-ready finalization risk tracked in **#443**).
    3. `signTransactionXdr(xdr, walletAddress)` — Freighter signs a **transaction envelope** (not an auth entry). Wallet sign timeout: **60,000 ms** with message `No response from Freighter — is the extension installed and unlocked?` on timeout (`buyer-app/src/wallet.ts`).
    4. `submitTx(signedXdr, contractId, proposal.id)` — submits, refreshes commitment cache, and marks the proposal completed.
    5. On success: clears local proposal and calls `onReassigned()` (parent refreshes commitment detail/list as applicable).
- **Wallet/network:** `NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"` (testnet). `connectWallet()` 10s timeout.
- **API/contract context:** `reassign_buyer` is staged multi-party (outgoing buyer, cooperative, incoming buyer). Proposal becomes `ready` once required non-source approvals are recorded; only the proposer finalizes/submits. See also **#441** for separate 202-PENDING submit UX gap (not this specific refresh/finalize fix).

## Prerequisites

| Item | Details |
|---|---|
| Browser | Desktop browser with **Freighter** extension installed and unlocked |
| Freighter network | **Testnet** (“Test SDF Network ; September 2015”). Record behavior if mis-set |
| Keypairs (funded on testnet) | **(1) Outgoing/current buyer** `G...` — proposer and **finalizer under test for #47**. **(2) Cooperative** `G...` — approved. **(3) Incoming/new buyer** `G...` — approved. Fund via friendbot as needed. |
| Commitment/proposal state | Commitment in a reassignable status with buyer = keypair (1). A `reassign_buyer` proposal for the intended `newBuyer` must be **active and `ready`** (`ready_xdr` present), with approvals from keypairs (2) and (3) already recorded. |
| Apps/services | `api/` running/reachable at `VITE_API_URL` (default `http://localhost:3000`); `buyer-app/` running; correct CORS if cross-origin. |
| Optional cross-check | Horizon/Stellar Expert (testnet) and/or `GET /commitments/:contractId` to confirm `buyer` changed to incoming buyer after success. |

## Step-by-step procedure

1. **Prepare a ready proposal (setup)**
   - As keypair (1), propose reassignment to keypair (3) from the target commitment.
   - As keypair (2) (cooperative) and keypair (3) (incoming buyer), approve per #46 flow until `GET /commitments/:id/tx/reassign-buyer/propose` reports `status: "ready"` and `ready_xdr` is non-null.
   - *Optional staleness exercise:* leave the proposal ready for a while before finalizing to validate refresh-before-sign behavior (related to #443). Record elapsed time.

2. **Connect as the proposer/finalizer (signer under test)**
   - In Freighter, select keypair (1). Connect wallet in buyer-app and open the target commitment.

3. **Verify preconditions in UI**
   - Section shows a **“Finalize reassignment”** button (enabled when not busy) for the proposer on a `ready` proposal.
   - Non-proposer parties should see “Approved — waiting for the current buyer to finalize.” (sanity check if available).

4. **Trigger finalize (observe Freighter popup)**
   - Click **“Finalize reassignment”**. Button label changes to “Finalizing…” and is disabled while busy.
   - **Observe Freighter:** this is a `signTransaction` request for the refreshed finalize XDR. Record exactly what Freighter displays (origin/site, action type, network, source account, fee/time bounds if shown, contract/invocation details, warnings).

5. **Rejection path (recommended)**
   - Repeat step 4 but **Reject/Cancel** in Freighter.
   - **Expected (code-level):** error surfaced in section banner; UI remains usable; proposal still `ready`; commitment unchanged.

6. **Approve/sign path (happy path)**
   - Click **“Finalize reassignment”** and **Approve/Sign** in Freighter.
   - App submits signed XDR via `/transactions/submit` with `completeProposalId`.
   - **Expected (code-level):** on success, local proposal cleared and `onReassigned()` triggers a refresh; UI should reflect new buyer/state.

7. **Post-action verification**
   - **UI:** reassignment section/proposal no longer pending/ready for this action; commitment view reflects updated buyer (incoming buyer) after refresh.
   - **API/chain-adjacent:** `GET /commitments/:id` shows `buyer` = keypair (3) (and expected status unchanged except reassignment effect). `GET /commitments/:id/tx/reassign-buyer/propose` should report no active pending/ready proposal (or completed, per API behavior). Capture tx hash from network tab/submit response if visible.
   - **Explorer:** confirm transaction success and invoked operation on testnet.

8. **Negative/edge checks (optional but valuable)**
   - Attempt finalize while connected as non-proposer: finalize button must not be available.
   - Freighter locked/unresponsive: expect timeout/error after ~60s.
   - Network mismatch (Freighter on Mainnet): record actual behavior.
   - If refresh-ready endpoint unavailable/errored: record how UI surfaces failure (cannot finalize with fresh XDR).

## Observation log (fill during execution)

| Step | Action | Freighter showed (exact text/fields) | UI result | On-chain/proposal result (hash/state/buyer/proposal status) | Match? | Notes |
|---|---|---|---|---|---|---|
| 2 | Connect wallet (proposer/finalizer) | | | n/a | | |
| 4 | Finalize — popup contents | | | n/a | | |
| 5 | Reject in Freighter | n/a | | | | |
| 6 | Approve/sign in Freighter | n/a | | | | |
| 7 | Post-submit / refresh | n/a | | | | |
| 1* | Delayed finalize (if tested) | n/a | | | | elapsed time / refresh-ready observed? |

## Known limitations / related issues (context)

- **#443 (stale ready XDR):** finalize previously built/saved XDR at mark-ready time with a short time bound/sequence context; late finalization could fail. Current flow refreshes ready XDR before signing (`refreshReadyProposalXdr`) when this fix is present; this runbook should verify that behavior in the tested build.
- **#441 (separate):** 202 PENDING/slow submit UX handling is tracked separately and may affect perceived finalize behavior.
- **Visibility/polling:** ready-proposal finalize action is only rendered for the proposer; pending-proposal polling stops once status is no longer `pending` (component polls on `pending`).
- **Environment constraint:** this document records a prepared procedure only; no real Freighter popup/signing was executed here.

## Outcome (to be completed by tester)

- **Result:** ☐ Pass ☐ Fail ☐ Blocked
- **Tester / date / environment / build-commit:** 
- **Commitment ID(s) / proposal ID(s) / tx hash(es):** 
- **Bugs found:** (open separate issues and link them from #47)
