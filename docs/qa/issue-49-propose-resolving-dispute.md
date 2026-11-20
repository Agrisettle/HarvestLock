# Manual Freighter QA runbook: propose resolving a dispute (buyer-app)

> **Status: prepared, not executed.** This runbook was written in a headless environment with no installed Freighter browser extension, no funded testnet keypairs, and no ability to approve wallet popups. Every “Actual observation” field is left for a human tester to complete during a real run. This document is intended to support verification on **#49** once executed.

**Issue:** #49 — Manual Freighter QA: propose resolving a dispute (buyer-app)  
**Flow:** `DisputeSection.tsx` → `handlePropose` (and subsequent staged approve/finalize for end-to-end resolution context)  
**App:** `buyer-app` (React + Vite, testnet)  
**Date prepared:** 2026-11-20

## Scope

Verify, against a real installed Freighter extension and real Stellar testnet:

1. Propose `resolve_dispute` for a commitment currently in `Disputed` status as an authorized party.
2. Confirm what the UI shows immediately after proposing and what Freighter interaction (if any) occurs at the propose step.
3. (Context/extension) Exercise approve/finalize of the staged resolution so the proposal can reach completion, and record observations — especially relevant because finalize now depends on fresh ready XDR behavior (#443).
4. Capture any real bugs (open separate issues and link them from #49).

## Code trace (what the app actually does)

- **Component:** `buyer-app/src/components/DisputeSection.tsx`
  - Renders for connected party (`buyer`, `cooperative`, or `warehouse_operator`) when commitment is disputable or `Disputed`.
  - When `status === "Disputed"`, fetches `getResolveDisputeProposal(contractId)` on mount and polls every 10s while proposal `status === "pending"` (best-effort).
  - **Propose path (`handlePropose`):** no wallet signing.
    1. `proposeResolveDispute(contractId, walletAddress)` — `POST /commitments/:contractId/tx/resolve-dispute/propose`.
    2. Stores returned proposal in state. UI shows: for proposer, “Resolution proposed — waiting for the other two parties to approve.”; if no active proposal, shows frozen message and **“Propose resolving this dispute”** button.
  - **Approve path (`handleApprove`, pending signer):** `signAuthEntry` (single Soroban auth entry, 60s timeout) → `signMultisigProposal(...)`; sets local `justApproved` for session.
  - **Finalize path (`handleFinalize`, proposer when `ready`):** `refreshReadyProposalXdr(contractId, proposal.id)` → `signTransactionXdr(...)` (transaction envelope) → `submitTx(signedXdr, contractId, proposal.id)` → clears proposal and calls `onDisputeChanged()`.
  - All three parties must ultimately authorize resolution; proposer finalizes after proposal becomes `ready`.

- **API:** `POST /commitments/:contractId/tx/resolve-dispute/propose` requires `proposerPublicKey` (any of the three parties may propose). Staged multi-party proposal shared shape with cancel/reassign flows.
- **Wallet/network:** testnet passphrase hardcoded; connect 10s, sign 60s timeouts.

## Prerequisites

| Item | Details |
|---|---|
| Browser | Desktop browser with **Freighter** extension installed and unlocked |
| Freighter network | **Testnet** (“Test SDF Network ; September 2015”). Record behavior if mis-set |
| Keypairs (funded on testnet) | **Three party wallets** for the commitment: buyer, cooperative, warehouse operator `G...` addresses. **Proposer under test for #49** is any one of these; the other two must be available to approve/finalize for end-to-end completion. |
| Commitment state | Commitment **already `Disputed`** (e.g. flagged via #48). No conflicting active resolve proposal unless intentionally testing idempotency/active-proposal behavior. |
| Apps/services | `api/` running/reachable at `VITE_API_URL` (default `http://localhost:3000`); `buyer-app/` running; correct CORS if cross-origin. |
| Optional cross-check | Horizon/Stellar Expert (testnet) and `GET /commitments/:contractId/tx/resolve-dispute/propose` / `GET /commitments/:contractId`. |

## Step-by-step procedure

1. **Prepare a disputed commitment**
   - Ensure target commitment status is `Disputed` and test party wallets are known/funded.

2. **Connect as proposer (signer/actor under test for propose)**
   - In Freighter, select one party keypair (buyer/cooperative/warehouse). Connect wallet in buyer-app and open the commitment.

3. **Verify preconditions in UI**
   - Dispute section shows: “This commitment is disputed — every other action is frozen until it's resolved.” and **“Propose resolving this dispute”** button when no active proposal.
   - If absent, confirm wallet is a party and no blocking UI/error state.

4. **Propose resolution (primary #49 action)**
   - Click **“Propose resolving this dispute”**. Button changes to “Proposing…” while busy.
   - **Observe Freighter:** **no signing is expected** for propose itself (API call only). Record whether any popup appears (it should not, per code trace).
   - **Expected (code-level):** proposal stored; proposer sees “Resolution proposed — waiting for the other two parties to approve.”; errors shown in banner on failure.

5. **Verify proposal state after propose**
   - **UI:** pending/proposed state visible to proposer; other connected parties (if checked) should see approve prompt when they are in `pending_entries`.
   - **API:** `GET /commitments/:id/tx/resolve-dispute/propose` returns active proposal with `status: "pending"` and two `pending_entries` (the non-proposing parties).

6. **Approve by other parties (staged follow-up, recommended for complete verification)**
   - As each pending party, connect and click **“Approve resolution”**.
   - **Observe Freighter:** `signAuthEntry` popup (auth entry). Record exact popup contents for at least one approval.
   - Reject once (optional) to confirm error handling; then approve. Confirm `justApproved`/waiting messaging and proposal becomes `ready` when all required approvals collected.

7. **Finalize as proposer (staged follow-up, recommended)**
   - Reconnect as proposer when proposal is `ready`; click **“Finalize resolution”**.
   - **Observe Freighter:** `signTransaction` popup for refreshed ready XDR. Record contents.
   - Approve/sign and submit; confirm `onDisputeChanged()` refresh.

8. **Post-action verification (end-to-end)**
   - **UI:** disputed frozen state cleared after successful resolution; proposal no longer active; commitment returns to its expected post-resolution status per contract/API behavior.
   - **API/chain-adjacent:** `GET /commitments/:id` reflects resolved/non-disputed processing state as defined by contract; resolve proposal no longer active. Capture tx hashes/ids from network responses where available.
   - **Explorer:** confirm finalize transaction success on testnet.

9. **Negative/edge checks (optional but valuable)**
   - Non-party cannot see/trigger dispute actions.
   - Propose when not `Disputed`: UI should not offer propose-resolution path.
   - Double-propose/idempotent active proposal behavior: record actual API/UI response.
   - Freighter locked/unresponsive during approve/finalize signing: expect timeout/error after ~60s.
   - Network mismatch: record behavior.

## Observation log (fill during execution)

| Step | Action | Freighter showed (exact text/fields) | UI result | Proposal/commitment result (id/status/entries/hash) | Match? | Notes |
|---|---|---|---|---|---|---|
| 2 | Connect (proposer role: ___) | | | n/a | | |
| 4 | Propose resolution | (expect none) | | | | |
| 5 | Post-propose check | n/a | | | | |
| 6a | Approve (party ___) popup | | | | | |
| 6b | Approve (party ___) popup | | | | | |
| 7 | Finalize — popup | | | | | |
| 8 | Post-finalize / refresh | n/a | | | | |

## Known limitations / related issues (context)

- **#443 relevance:** resolve-dispute finalize uses the same staged ready-XDR finalize path; stale ready XDR could break late finalization. Where the refresh-before-sign fix is present, finalize should request fresh ready XDR before signing — verify in tested build.
- **#441 (separate):** 202 PENDING/slow submit UX handling is tracked separately and may affect finalize submit perception.
- **Session-local approval state:** `justApproved` does not survive reload; once a signer’s entry is recorded they disappear from `pending_entries`, so post-reload attribution can be ambiguous until `ready` (same limitation noted in component).
- **Environment constraint:** this document records a prepared procedure only; no real Freighter popup/signing was executed here.

## Outcome (to be completed by tester)

- **Result:** ☐ Pass ☐ Fail ☐ Blocked
- **Tester / date / environment / build-commit:** 
- **Commitment ID(s) / proposal ID(s) / tx hash(es):** 
- **Bugs found:** (open separate issues and link them from #49)
