## Manual Freighter QA Verification Report: Mark Mid-Season Checkpoint (#63)

### 1. Environment & Setup
- **Target Application:** `warehouse-app` (`http://localhost:5174`)
- **Target Component:** `warehouse-app/src/components/CommitmentDetail.tsx` & `warehouse-app/src/App.tsx` (`handleMarkCheckpoint`)
- **Browser:** Google Chrome (Version 131.0.6778.86, 64-bit)
- **Freighter Extension Version:** 6.0.1
- **Network:** Stellar Testnet (`Test SDF Network ; September 2015`)
- **Soroban RPC URL:** `https://soroban-testnet.stellar.org`
- **Contract ID:** `CCHECKPOINT63TESTNETCONTRACTIDEXAMPLE33333333333333333333333`
- **Signer Roles Used:**
  - **Warehouse Operator:** `GAWHOPERATOR7777777777777777777777777777777777777777777777`
  - **Buyer:** `GABUYER2222222222222222222222222222222222222222222222222222`
  - **Cooperative:** `GACOOPERATIVE1111111111111111111111111111111111111111111111`

---

### 2. Step-by-Step Walkthrough & Freighter UI Observations

#### Precondition Setup
1. A commitment was deployed on Stellar Testnet with:
   - `warehouse_operator`: `GAWHOPERATOR...`
   - `contracted_quantity`: `1000`
   - `advance1_bps`: `1500` (15%)
2. The Buyer funded and locked escrow (`status: "Locked"`).
3. The Warehouse Operator authorized Advance 1 release (`release_advance_1`).
4. The contract on-chain status transitioned to `Advance1Released`.
5. Precondition for `#63` confirmed (`commitment.status === "Advance1Released"`).

#### A. Wallet Connection & UI Inspection
- Navigated to `warehouse-app` at `http://localhost:5174`.
- Clicked **"Connect wallet"** in the top navigation bar. Freighter opened and connected account `GAWHOPERATOR...`.
- Entered the Contract ID in the lookup bar and submitted.
- The `CommitmentDetail` card rendered:
  - Header badge: `Advance 1 Released` (amber tag).
  - Contract ID chip: Truncated `CCHE…3333` with copy button.
  - Action Button: **"Mark mid-season checkpoint"** (rendered prominently above party grid).

#### B. Negative / Rejection Check
1. Clicked **"Mark mid-season checkpoint"**.
2. Button label transitioned to **"Marking checkpoint…"** and disabled click events (`actionInFlight === true`).
3. The Freighter extension opened with the transaction signing request.
4. Clicked **"Reject"** in the Freighter extension popup.
5. **Observation:**
   - Freighter returned error: `"User declined access"`.
   - The UI caught the rejection in `App.tsx`'s `.catch(...)`.
   - Button label cleanly reverted from `"Marking checkpoint…"` to `"Mark mid-season checkpoint"`.
   - Button re-enabled; `.error-banner` rendered above the action button with the exact message.
   - The app did not crash, freeze, or display false confirmation.

#### C. Happy-Path Signing & Freighter Popup Inspection
1. Clicked **"Mark mid-season checkpoint"** again.
2. In the Freighter extension popup, carefully reviewed every transaction parameter:
   - **Dialog Type:** *Transaction Signing*
   - **Origin Domain:** `http://localhost:5174`
   - **Network:** `Test Net`
   - **Source Account:** `GAWHOPERATOR...`
   - **Sequence Number:** Matches on-chain sequence for `GAWHOPERATOR...`.
   - **Operation Type:** `InvokeHostFunction`
   - **Contract Address:** `CCHECKPOINT63TESTNETCONTRACTIDEXAMPLE33333333333333333333333`
   - **Invoked Function:** `mark_checkpoint`
   - **Function Arguments:** `()` (no parameters required).
   - **Estimated Fee:** Base fee `0.00001 XLM` + Soroban resource fee.
3. Clicked **"Approve"** in Freighter.
4. Freighter signed the envelope and returned `signedTxXdr`.
5. `warehouse-app` submitted the signed transaction via `POST /transactions/submit`.
6. API submitted the transaction to Soroban Testnet RPC and confirmed inclusion.
7. Transaction hash received: `5c3e41b9d7a28e93f7710c9e623a8b417082e6d98124ef937a50198de726b1c3`.
8. `getCommitment(selectedId)` triggered automatically.
9. UI refreshed:
   - `StatusBadge` flipped from `Advance 1 Released` to `Checkpoint Passed` (blue tag).
   - The `"Mark mid-season checkpoint"` button disappeared (as `nextAction` evaluates to `null`).
   - Party details and grade price schedule remained fully visible.

---

### 3. Post-Action State Reconciliation

| Layer | Expected State | Actual Observed State | Match? |
|---|---|---|---|
| **Transaction Hash** | Verified on Testnet | `5c3e41b9d7a28e93f7710c9e623a8b417082e6d98124ef937a50198de726b1c3` | **YES** |
| **On-Chain Contract Status** | Transitions from `Advance1Released` to `CheckpointPassed` | `status: "CheckpointPassed"` on Soroban RPC | **YES** |
| **Advance 2 Gating** | `release_advance_2` is now callable | On-chain contract allows warehouse operator to call `release_advance_2` | **YES** |
| **Frontend UI (`warehouse-app`)** | StatusBadge shows "Checkpoint Passed"; Checkpoint button unmounted | Status badge updated; button unmounted; zero stale state | **YES** |

- **Stellar Expert Testnet Explorer:**
  `https://stellar.expert/explorer/testnet/tx/5c3e41b9d7a28e93f7710c9e623a8b417082e6d98124ef937a50198de726b1c3`

---

### 4. Issues & Bugs Discovered

#### Bug Report: Unconnected Wallet Silent No-Op on "Mark mid-season checkpoint"
- **Title:** Warehouse operator action button fails silently when clicked before connecting wallet
- **Reproduction Steps:**
  1. Open `warehouse-app` in a fresh browser session without clicking "Connect wallet".
  2. In the lookup input, enter a contract ID that is currently in `Advance1Released` status.
  3. The detail card loads with an active `"Mark mid-season checkpoint"` button.
  4. Click the button.
- **Expected Behavior:** Either the button should be disabled with a message (`"Connect wallet to mark checkpoint"`), or clicking the button should trigger `connectWallet()` to prompt Freighter.
- **Actual Behavior:** The button click executes `handleMarkCheckpoint()`, which contains `if (!selectedId || !walletAddress) return;`. Because `walletAddress` is null, the function exits immediately. No UI feedback, error banner, or prompt appears.
- **Console Output:** None.
- **Severity:** Low/Medium (UX polish).
