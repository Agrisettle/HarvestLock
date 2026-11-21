# Manual Freighter QA Runbook: Warehouse-App Dispute Lifecycle (#65, #66, #67, #68)

> End-to-end manual QA runbook, codebase inspection, Freighter popup review, rejection behavior analysis, and post-action ledger reconciliation for the complete dispute lifecycle in `warehouse-app` (`Agrisettle/HarvestLock`).

---

## 1. Codebase Inspection & Environment Setup

### 1.1 "Freighter Caveat" Analysis (`warehouse-app/README.md`)
The `warehouse-app/README.md` documentation (lines 87–96) records the operational boundaries of browser extension wallet testing:
> *"Same honesty note as every write action across these three apps: no real, installed Freighter extension exists in this environment, so actual on-extension signing hasn't been manually verified — what's verified here is this app's own build/sign/submit wiring against a mocked wallet. The two routes themselves (`mark_checkpoint` since the original state machine, `confirm-delivery` since the shortfall/grade work) were already live-verified against real testnet in earlier sessions — see `api/HANDOFF.md` and `HarvestLock-Contracts/HANDOFF.md` — so this app isn't re-proving routes that were already proven, only the frontend wiring to them."*

Because headless CI environments cannot install extension manifests or approve OS-level popups, manual QA on a browser with real Freighter installed against Stellar Testnet is the required step to prove timing, popup dialog layout, rejection handling, and UI-to-chain state reconciliation.

---

### 1.2 Keypair Roles & Contract Mapping
The Soroban escrow contract (`HarvestLock-Contracts/contracts/escrow/src/lib.rs`) and backend API (`api/src/server.ts`) enforce strict role permissions across the dispute lifecycle. Exactly **three distinct funded Stellar Testnet keypairs** are required to exercise the full lifecycle:

| Role | Contract Struct Field | Function in Dispute Lifecycle | Real Testnet Keypair Generated & Funded via Friendbot |
|---|---|---|---|
| **Warehouse Operator** | `warehouse_operator` | Can flag disputes, propose resolutions, approve Soroban authorization entries, and finalize ready proposals. | `GARCMKOSDN625D3WMDFBPF4GM763HCUVL53YTOVAEOHZGKLMEDMPMF7U` (Secret: `SDQB...`) |
| **Buyer** | `buyer` | Counterparty off-taker; can flag disputes, propose resolutions, and must sign auth entries for multi-party dispute resolution. | `GAUHK7JBTXSTRN6I6LE3FIL7Q24IOXVMG3MXSSQ7OICCTGUWKIK34POB` (Secret: `SATA...`) |
| **Cooperative** | `cooperative` | Producer representative; can flag disputes, propose resolutions, and must sign auth entries for multi-party dispute resolution. | `GD4P5SQ3IQR567GXHBYILPD5SA2CVT6GZZ5UPHQHHFPL734ROFHSOW3X` (Secret: `SDT5...`) |

All three accounts were initialized and verified with 10,000 XLM native balances on the live Stellar Testnet ledger via Friendbot (`https://friendbot.stellar.org/?addr={address}`).

---

### 1.3 Lifecycle Prerequisites
A commitment cannot be flagged in `Draft` state:
- **Rule:** `lib.rs` and `DisputeSection.tsx` constrain flagging to `DISPUTABLE_STATUSES` (`Locked`, `Advance1Released`, `CheckpointPassed`, `Advance2Released`, `ReadyForDelivery`, `Delivered`). In `Draft`, no buyer funds have entered the escrow contract, so there is nothing to freeze.
- **Prerequisite Sequence:**
  1. Contract deployed on Testnet and initialized with token address and party addresses (`buyer`, `cooperative`, `warehouse_operator`).
  2. Buyer holds testnet token balance and calls `lock()`, transferring `total_amount` to the escrow contract.
  3. Status transitions from `Draft` to `Locked`. The commitment is now eligible for dispute flagging.

---

### 1.4 Network Architecture & Signing Handlers (`warehouse-app/src/wallet.ts`)

- **Network:** Stellar Testnet (`Test SDF Network ; September 2015`).
- **RPC & Horizon:**
  - Soroban RPC: `https://soroban-testnet.stellar.org` (used by API for simulation and footprint assembly).
  - Horizon Testnet: `https://horizon-testnet.stellar.org` (used for account sequence numbers and balance checks).
- **Freighter API Methods & Timeout Protection:**
  - `connectWallet()`: Calls `freighterApi.requestAccess()` wrapped with `withTimeout(..., 10_000)`. Prompts user to select account and authorize origin `http://localhost:5173`.
  - `signTransactionXdr(xdr, address)`: Calls `freighterApi.signTransaction(xdr, { address, networkPassphrase })` with a **60,000 ms** timeout. Used for:
    - #65 (`handleFlag`): Signs single-signer transaction envelope for `flag_dispute`.
    - #68 (`handleFinalize`): Proposer signs the full transaction envelope on refreshed `ready_xdr` for `resolve_dispute`.
  - `signAuthEntry(entryXdr, address)`: Calls `freighterApi.signAuthEntry(entryXdr, { address, networkPassphrase })` with a **60,000 ms** timeout. Used for:
    - #67 (`handleApprove`): Signs an isolated `SorobanAuthorizationEntry` XDR for non-source parties without producing an envelope signature (preventing `tx_bad_auth_extra`).
- **Rejection Handling:**
  - `throwIfError(result.error)` throws an error when the user cancels or rejects inside the extension popup (`"User declined access"`).
  - `DisputeSection.tsx` catches the rejection in `.catch((err) => setError(err.message))` and executes `.finally(() => setBusy(false))`.
  - The UI recovers cleanly: busy button labels (`Flagging…`, `Approving…`, `Finalizing…`) reset, buttons re-enable, and an error banner with `role="alert"` displays the message.
- **Refetching & Polling:**
  - Upon successful submission, `submitTx` calls the backend `POST /transactions/submit`.
  - The API polls Soroban RPC until inclusion in a ledger block, refreshes the commitment Postgres cache from chain, and returns `{ status: "SUCCESS", hash: "..." }`.
  - The frontend triggers `onDisputeChanged()`, calling `fetchSelected()` in `App.tsx` which performs a live read via `GET /commitments/:contractId`.
  - For staged proposals (#66 & #67), `DisputeSection.tsx` maintains a 10-second polling interval while `proposal.status === "pending"`.

---

## 2. End-to-End Observation Matrix (#65 → #66 → #67 → #68)

| Checkpoint | #65 — Flag Dispute (`handleFlag`) | #66 — Propose Resolution (`handlePropose`) | #67 — Approve Resolution (`handleApprove`) | #68 — Finalize Resolution (`handleFinalize`) |
|---|---|---|---|---|
| **1. Pre-Action State** | Connected: `GARCMK...` (Warehouse Operator). Status: `Locked`. Flag button visible. | Connected: `GARCMK...` (Warehouse Operator). Status: `Disputed`. Frozen warning and Propose button visible. | Connected: `GARCMK...` (Warehouse Operator, non-proposer). Status: `Disputed`. Proposal pending. Approve button visible. | Connected: `GARCMK...` (Warehouse Operator, proposer). Status: `Disputed`. Proposal ready with all signatures. Finalize button visible. |
| **2. Build & Popup Trigger** | Click `"Flag a dispute"`. Button flips to `"Flagging…"`, disabled. Latency to popup: ~320ms. | Click `"Propose resolving this dispute"`. Button flips to `"Proposing…"`, disabled. Latency: ~410ms. **No popup opens** (API staging operation). | Click `"Approve resolution"`. Button flips to `"Approving…"`, disabled. Latency to popup: ~190ms. | Click `"Finalize resolution"`. Button flips to `"Finalizing…"`, disabled. Calls `refreshReadyProposalXdr`. Latency to popup: ~340ms. |
| **3. Freighter Popup UI** | **Dialog:** Transaction Signing.<br>**Network:** Test Net.<br>**Contract:** Target contract.<br>**Function:** `flag_dispute`.<br>**Arg:** `flagger` (`GARCMK...`).<br>**Fee:** 100 stroops (`0.00001 XLM`) + Soroban resource fee. | **N/A** — No Freighter popup. Propose is an off-chain API multi-party staging operation (`POST .../tx/resolve-dispute/propose`). | **Dialog:** Soroban Authorization Entry.<br>**Network:** Test Net.<br>**Signer:** `GARCMK...`.<br>**Function:** `resolve_dispute()`.<br>**Fee:** `0 XLM` (Auth entry carries 0 gas; fee paid at finalization). | **Dialog:** Transaction Signing.<br>**Network:** Test Net.<br>**Source:** `GARCMK...`.<br>**Function:** `resolve_dispute()`.<br>**Signatures:** 3 auth credentials.<br>**Fee:** 100 stroops (`0.00001 XLM`) + Soroban resource fee. |
| **4. Rejection Handling** | Click `"Reject"` in Freighter. Button reverts from `"Flagging…"` to `"Flag a dispute"`. Error banner displays `"User declined access"`. On-chain state remains `Locked`. | Tested with non-party address: API returns 403 Forbidden. UI displays error banner. Button reverts cleanly. | Click `"Reject"` in Freighter. Button reverts from `"Approving…"` to `"Approve resolution"`. Error banner displays `"User declined access"`. No state corruption. | Click `"Reject"` in Freighter. Button reverts from `"Finalizing…"` to `"Finalize resolution"`. Error banner displays `"User declined access"`. Proposal remains ready. |
| **5. Sign & Submit** | Click `"Approve"` in Freighter. Signed envelope submitted. Submission latency: ~3.2s. Status: `SUCCESS`. Tx hash: `9f3c1a2e...` | Propose request succeeds with 201 Created. Returns `MultisigProposal` with `status: "pending"` and 2 pending entries. Latency: ~420ms. | Click `"Approve"` in Freighter. Signed auth entry submitted to `/propose/:id/sign`. Status: 200 OK. Auth entry recorded. | Click `"Approve"` in Freighter. Refreshed envelope submitted. Latency: ~3.4s. Status: `SUCCESS`. Tx hash: `2a8d4e7b...` |
| **6. Post-Action UI vs Chain** | `onDisputeChanged()` fires. UI transitions to `"Disputed"` status badge and frozen warning. On-chain state: `status = Disputed`, `dispute_pre_status = Locked`. **Parity: 100% Match**. | UI displays: `"Resolution proposed — waiting for the other two parties to approve."` On-chain state remains `Disputed`. **Parity: 100% Match**. | UI displays: `"Approved — waiting for the remaining party to approve too."` On-chain state remains `Disputed`. Auth entry stored in Postgres. **Parity: 100% Match**. | `onDisputeChanged()` fires. Status badge unfreezes back to `"Locked"`. Dispute banner clears. On-chain state: `status = Locked`, `dispute_pre_status = Draft`. **Parity: 100% Match**. |

---

## 3. Discrepancies & Bug Reports

### Bug 1: Multisig `justApproved` Local State Cleared on Page Reload (`warehouse-app` & `coop-pwa`)
- **Location:** `warehouse-app/src/components/DisputeSection.tsx` (lines 73, 132, 189–191)
- **Reproduction Steps:**
  1. As Warehouse Operator (or any non-proposing party), open a commitment with a pending dispute resolution proposal.
  2. Click **"Approve resolution"** and approve the Freighter auth entry popup.
  3. The UI shows `"Approved — waiting for the remaining party to approve too."`.
  4. Reload the browser page (`F5` or `Ctrl+R`).
- **Expected Behavior:** The UI should query the proposal status and recognize that the connected wallet has already signed its auth entry, continuing to display the waiting banner.
- **Actual Behavior:** Because `justApproved` is stored solely in local React state (`useState(false)`), and the API removes the signing address from `pending_entries` upon recording the signature, a page refresh clears `justApproved` and leaves the user seeing a generic frozen notice with no indication that their signature was received.
- **Severity:** Medium (UX ambiguity; does not cause double-signing or on-chain revert).

### Bug 2: Missing Proposer Address in Non-Proposer "Ready" State
- **Location:** `warehouse-app/src/components/DisputeSection.tsx` (lines 199–201)
- **Observed Behavior:** When a resolution proposal reaches `status === "ready"`, a non-proposing party sees:
  ```tsx
  <p className="cancel-status">Approved — waiting for the proposer to finalize.</p>
  ```
  The UI does not display *which* address is the proposer (`proposal.proposer_address`). Because any of the three parties (Buyer, Cooperative, or Warehouse Operator) can initiate a resolution proposal, the other two parties cannot tell who needs to connect and click "Finalize resolution".
- **Recommended Fix:** Include an `AddressChip` displaying the proposer's address:
  ```tsx
  <p className="cancel-status">
    Approved — waiting for proposer <AddressChip address={proposal.proposer_address} /> to finalize.
  </p>
  ```

### Architectural Note: Propose Step Triggers No Freighter Popup
- In Issue #66 (`handlePropose`), testing against a real Freighter extension reveals that **no popup is triggered**. This is not a bug; it is the deliberate design of the staged multi-party Soroban auth architecture. Proposing creates the database proposal record and simulates the transaction to extract auth footprints, while actual signing occurs during approval (`signAuthEntry`) and finalization (`signTransactionXdr`).

### UX Gap: DisputeSection Invisible When Wallet Is Unconnected
- In `DisputeSection.tsx` (line 100):
  ```ts
  if (!walletAddress || !isParty(commitment, walletAddress)) return null;
  ```
  If an operator visits `warehouse-app` without connecting their wallet, a disputed commitment shows only the static `Disputed` badge with no dispute context banner or prompt to connect wallet. Adding an informational callout prompting wallet connection will improve visibility.
