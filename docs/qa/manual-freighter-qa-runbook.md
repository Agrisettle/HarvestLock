# Manual Freighter QA Runbook: Stellar Testnet Verification

> Comprehensive manual QA runbook and audit report for end-to-end Freighter wallet interactions across **#61**, **#62**, **#63**, and **#64** in `Agrisettle/HarvestLock`.

---

## 1. Codebase Inspection & Prerequisite Mapping

### 1.1 "Freighter Caveat" Analysis Across Readmes
Both `warehouse-app/README.md` and `coop-pwa/README.md` explicitly flag the current testing boundaries regarding browser extension wallets:

- **`warehouse-app/README.md` (lines 87–96):**
  > *"Same honesty note as every write action across these three apps: no real, installed Freighter extension exists in this environment, so actual on-extension signing hasn't been manually verified — what's verified here is this app's own build/sign/submit wiring against a mocked wallet. The two routes themselves (`mark_checkpoint` since the original state machine, `confirm-delivery` since the shortfall/grade work) were already live-verified against real testnet in earlier sessions — see `api/HANDOFF.md` and `HarvestLock-Contracts/HANDOFF.md` — so this app isn't re-proving routes that were already proven, only the frontend wiring to them."*

- **`coop-pwa/README.md` (lines 68–76 & 96–100):**
  > *"Freighter is explicitly a testnet/MVP stand-in, not the real auth model — PRD §4.6 rules out seed-phrase wallets for cooperative users. ... What's not independently verified in this session: signing against a real, installed Freighter extension — this sandboxed environment has no way to install and drive a real browser extension with a real funded account. A genuinely real finding did come from a real browser, though: with no Freighter extension present at all (the exact case a first-time visitor hits), `requestAccess()` neither resolves nor rejects, it hangs forever — fixed with a timeout wrapper around every Freighter call, see `wallet.ts`. Manual QA with a real Freighter install is still a real gap before calling this fully proven."*

---

### 1.2 Network Configuration & Freighter API Architecture

#### Network Configuration
- **Network Passphrase:** `"Test SDF Network ; September 2015"` (Hardcoded via `NETWORK_PASSPHRASE` in `coop-pwa/src/wallet.ts` and `warehouse-app/src/wallet.ts`, matching `@stellar/stellar-sdk`'s `Networks.TESTNET`).
- **Soroban Testnet RPC URL:** `https://soroban-testnet.stellar.org` (Configured in `api/.env` as `STELLAR_RPC_URL`).
- **Horizon Testnet URL:** `https://horizon-testnet.stellar.org`.
- **Friendbot URL:** `https://friendbot.stellar.org/?addr={publicKey}`.

#### Freighter API Methods & Timeout Protection
Because `@stellar/freighter-api` calls hang indefinitely when the extension is missing or unresponsive, both apps implement `withTimeout<T>(promise, timeoutMs)`:

1. **`requestAccess()`** (`connectWallet()`):
   - Timeout: **10,000 ms** (10 seconds).
   - Prompts the user to grant origin access and select an active account.
   - Returns `{ address: string, error?: { message: string } }`.
2. **`signTransaction(xdr, { address, networkPassphrase })`** (`signTransactionXdr()`):
   - Timeout: **60,000 ms** (60 seconds to allow human review in popup).
   - Signs a complete transaction envelope. Used for single-signer calls (`mark_checkpoint`, `confirm_delivery`) and multisig finalization (`handleFinalize`).
   - Returns `{ signedTxXdr: string, signerAddress: string, error?: ... }`.
3. **`signAuthEntry(entryXdr, { address, networkPassphrase })`** (`signAuthEntry()`):
   - Timeout: **60,000 ms** (60 seconds).
   - Signs a single `SorobanAuthorizationEntry` XDR rather than an entire envelope. Crucial for non-source multi-party approvals (`handleApprove` in dispute resolution) without triggering `tx_bad_auth_extra`.
   - Returns `{ signedAuthEntry: string, signerAddress: string, error?: ... }`.
4. **`isConnected()`** (`isFreighterAvailable()` in `coop-pwa`):
   - Timeout: **3,000 ms** (3 seconds).
   - Non-blocking check for extension availability.

#### Error and Rejection Handling
Both applications utilize `throwIfError(result.error)`:
```ts
function throwIfError(error: FreighterError | undefined): void {
  if (error) {
    throw new Error(typeof error.message === "string" ? error.message : JSON.stringify(error));
  }
}
```
When a user clicks **"Reject"** or **"Cancel"** in the Freighter popup:
- Freighter resolves with `{ error: { message: "User declined access" } }` or rejects.
- `throwIfError` throws `Error("User declined access")`.
- The UI catches the rejection:
  ```ts
  .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  .finally(() => setBusy(false)); // or setActionInFlight(false)
  ```
- The loading/submitting spinner resets cleanly, the action button is re-enabled, and the message is displayed in an `.error-banner` without application crash or corrupted state.

---

### 1.3 Keypair Roles Required
Executing all four flows requires **3 distinct funded keypairs** plus a deployer:

| Role | Keypair Alias | Primary Responsibilities Across Flows |
|---|---|---|
| **Warehouse Operator** | `GWH...` | Signs `mark_checkpoint` (#63) & `confirm_delivery` (#64). Can flag dispute or propose dispute resolution (#61/#62). |
| **Cooperative** | `GCOOP...` | Co-op staff. In #61, approves pending dispute resolution via `signAuthEntry`. In #62, can finalize ready resolution via `signTransaction`. Releases/claims advances. |
| **Buyer** | `GBUYER...` | Contracts & locks escrow, funds remainder (prerequisite for #64), signs auth entry for dispute resolution. |
| **Deployer** | `GDEPLOYER...` | Pays gas fees for contract WASM deployment and contract initialization via API. |

---

### 1.4 On-Chain Preconditions & UI Button Gating

#### Issue #61: Approve a Dispute Resolution (`coop-pwa` → `DisputeSection.tsx`)
- **Preconditions:**
  - `commitment.status === "Disputed"`.
  - Active multisig proposal exists in API DB with `method === "resolve_dispute"` and `status === "pending"`.
  - Proposal was initiated by another party (e.g. Warehouse Operator `GWH...`).
  - Connected wallet matches an address in `proposal.pending_entries` (e.g. Cooperative `GCOOP...`).
- **Actionable UI Element:** Button `"Approve resolution"` (`dispute.approve`).
- **Invocation:** Calls `signAuthEntry(myEntry.entry_xdr, walletAddress)` and submits signed entry to `POST /commitments/:id/tx/propose/:proposalId/sign`.

#### Issue #62: Finalize a Ready Dispute Resolution (`coop-pwa` → `DisputeSection.tsx`)
- **Preconditions:**
  - `commitment.status === "Disputed"`.
  - Active multisig proposal has `status === "ready"`.
  - All non-proposer parties (e.g., Buyer and Cooperative) have signed their auth entries.
  - `ready_xdr` is present on the proposal.
  - Connected wallet matches `proposal.proposer_address`.
- **Actionable UI Element:** Button `"Finalize resolution"` (`dispute.finalize`).
- **Invocation:** Calls `signTransactionXdr(proposal.ready_xdr, walletAddress)` and submits envelope to `POST /transactions/submit` with `completeProposalId`. Transitions on-chain status back to pre-dispute status.

#### Issue #63: Mark Mid-Season Checkpoint (`warehouse-app` → `CommitmentDetail.tsx` & `App.tsx`)
- **Preconditions:**
  - `commitment.status === "Advance1Released"`.
  - Connected wallet matches `commitment.warehouse_operator`.
- **Actionable UI Element:** Button `"Mark mid-season checkpoint"`.
- **Invocation:** Calls `buildTx(contractId, "mark_checkpoint", walletAddress)` → `signTransactionXdr(xdr, walletAddress)` → `submitTx(signedXdr, contractId)`. Transitions status to `CheckpointPassed`.

#### Issue #64: Confirm Delivery (`warehouse-app` → `ConfirmDeliveryForm.tsx` & `App.tsx`)
- **Preconditions:**
  - `commitment.status === "ReadyForDelivery"`.
  - `commitment.remainder_funded === true` (Buyer has funded the remaining balance).
  - Connected wallet matches `commitment.warehouse_operator`.
- **Actionable UI Element:** Form inputs for `delivered-quantity` and `grade-index` + Button `"Confirm delivery"`.
- **Invocation:** Calls `buildConfirmDeliveryTx(contractId, deliveredQuantity, gradeIndex, walletAddress)` → `signTransactionXdr(xdr, walletAddress)` → `submitTx(signedXdr, contractId)`. Transitions status to `Delivered`.

---

## 2. Testnet Environment & Execution Runbook

### 2.1 Keypair Generation & Freighter Setup
1. **Generate Testnet Keypairs:**
   Generate 3 keypairs using `stellar-cli` or Node:
   ```bash
   # Warehouse Operator
   stellar keys generate warehouse --network testnet
   # Cooperative
   stellar keys generate coop --network testnet
   # Buyer
   stellar keys generate buyer --network testnet
   ```
2. **Fund via Friendbot:**
   Fund each generated public address via Friendbot:
   ```bash
   curl "https://friendbot.stellar.org/?addr=$(stellar keys address warehouse)"
   curl "https://friendbot.stellar.org/?addr=$(stellar keys address coop)"
   curl "https://friendbot.stellar.org/?addr=$(stellar keys address buyer)"
   ```
3. **Configure Freighter Browser Extension:**
   - Install Freighter from the Chrome Web Store / Firefox Add-ons.
   - Open Freighter Settings → **Network** → Select **Test Net** (`Test SDF Network ; September 2015`).
   - Import all three accounts by selecting **Import Account** → **Secret Key** (`S...`), labeling them:
     - `HarvestLock Warehouse`
     - `HarvestLock Coop`
     - `HarvestLock Buyer`

---

### 2.2 Backend & Contract Infrastructure Setup
1. **Configure `api/.env`:**
   ```ini
   DATABASE_URL=postgres://postgres:harvestlock@localhost:5432/harvestlock
   STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
   DEPLOYER_SECRET_KEY=<DEPLOYER_SECRET_KEY>
   ESCROW_WASM_HASH=<ESCROW_WASM_HASH>
   PORT=3000
   CORS_ORIGINS=http://localhost:5173,http://localhost:5174
   ```
2. **Initialize Database & Run API:**
   ```bash
   cd api
   npm install
   npm run migrate
   npm run dev
   ```
3. **Start Frontends:**
   ```bash
   # Terminal 1: coop-pwa (runs on port 5173)
   cd coop-pwa && npm run dev

   # Terminal 2: warehouse-app (runs on port 5174)
   cd warehouse-app && npm run dev -- --port 5174
   ```

---

### 2.3 State Seeding Procedures

#### Seeding Flow Group A (`warehouse-app` → #63 & #64)
To reach `#63` (`Advance1Released`) and then `#64` (`ReadyForDelivery` with `remainder_funded = true`):
1. **Deploy & Initialize Commitment:**
   Call `POST /commitments/deploy` and `POST /commitments/:id/tx/initialize` configuring:
   - `buyer`: `GBUYER...`
   - `cooperative`: `GCOOP...`
   - `warehouseOperator`: `GWH...`
   - `advance1Bps`: `1500` (15%)
   - `advance2Bps`: `2000` (20%)
   - `contractedQuantity`: `1000`
   - `gradePriceBps`: `[10000, 9000, 7500]`
2. **Advance to #63:**
   - Buyer executes `lock` (`POST /commitments/:id/tx/lock`). Status becomes `Locked`.
   - Warehouse Operator executes `release_advance_1`. Status becomes `Advance1Released`.
   - **Target State for #63 Reached.**
3. **Advance from #63 to #64:**
   - [Execute #63 via `warehouse-app` UI]. Status transitions to `CheckpointPassed`.
   - Cooperative executes `claim_advance_1`.
   - Warehouse Operator executes `release_advance_2`. Status becomes `Advance2Released`.
   - Cooperative executes `claim_advance_2`.
   - Cooperative executes `ready_for_delivery`. Status becomes `ReadyForDelivery`.
   - Buyer executes `fund_remainder` (`POST /commitments/:id/tx/fund_remainder`). `remainder_funded` becomes `true`.
   - **Target State for #64 Reached.**

#### Seeding Flow Group B (`coop-pwa` → #61 & #62)
To reach `#61` (Pending proposal) and then `#62` (Ready proposal):
1. **Deploy & Lock Commitment:**
   - Deploy commitment and lock via Buyer. Status is `Locked`.
2. **Flag Dispute:**
   - Warehouse Operator flags dispute:
     `POST /commitments/:id/tx/flag-dispute` with `flagger: GWH...`. Status transitions to `Disputed` (`dispute_pre_status = "Locked"`).
3. **Propose Dispute Resolution (Creates #61 precondition):**
   - Warehouse Operator calls `POST /commitments/:id/tx/resolve-dispute/propose` with `{ proposerPublicKey: GWH... }`.
   - API creates proposal with `status: "pending"`, and `pending_entries` for `GCOOP...` and `GBUYER...`.
   - **Target State for #61 Reached.**
4. **Advance from #61 to #62:**
   - [Execute #61 via `coop-pwa` UI: Cooperative signs auth entry].
   - Buyer signs auth entry via API `POST /commitments/:id/tx/propose/:id/sign`.
   - API rebuilds transaction and marks proposal `status: "ready"` with `ready_xdr`.
   - **Target State for #62 Reached.**

---

## 3. End-to-End Execution & Verification Matrix

### Verification Matrix

| Flow | Action / Step | Rejection Check | Happy Path Review (Popup Inspection) | Chain State Reconciliation |
|---|---|---|---|---|
| **#61** (`coop-pwa`) | **Approve Dispute Resolution** (`handleApprove`) | User clicks **"Reject"** in Freighter popup. Button resets from `"Approving…"` to `"Approve resolution"`. Error banner shows `"User declined access"`. | Popup displays: Type: **Authorization Entry**, Origin: `http://localhost:5173`, Network: **Test Net**, Contract: `C...`, Function: `resolve_dispute()`, Valid Until: Ledger +17280. | Auth entry recorded in Postgres staging DB. Proposal pending list reduces. UI switches to `"Approved — waiting for remaining party"`. |
| **#62** (`coop-pwa`) | **Finalize Dispute Resolution** (`handleFinalize`) | User clicks **"Reject"** in Freighter popup. Button resets from `"Finalizing…"` to `"Finalize resolution"`. Error banner displays cleanly. | Popup displays: Type: **Transaction Signing**, Network: **Test Net**, Operation: `InvokeHostFunction`, Contract: `C...`, Function: `resolve_dispute()`, 3 Auth Signatures present, Base Fee: 100 stroops. | Tx hash confirmed on Stellar Testnet Horizon/RPC. Proposal marked completed. UI refreshes to show status un-frozen back to `Locked`. |
| **#63** (`warehouse-app`) | **Mark Mid-Season Checkpoint** (`handleMarkCheckpoint`) | User clicks **"Reject"** in Freighter popup. Button resets from `"Marking checkpoint…"` to `"Mark mid-season checkpoint"`. Error banner displays rejection error. | Popup displays: Network: **Test Net**, Origin: `http://localhost:5174`, Operation: `InvokeHostFunction`, Contract: `C...`, Function: `mark_checkpoint()`, Args: None (`()`), Signer: `GWH...`. | Tx confirmed on Stellar Testnet. On-chain status transitions from `Advance1Released` to `CheckpointPassed`. Button disappears from UI. |
| **#64** (`warehouse-app`) | **Confirm Delivery** (`handleConfirmDelivery`) | User clicks **"Reject"** in Freighter popup. Button resets from `"Confirming…"` to `"Confirm delivery"`. Error banner shows error without form loss. | Popup displays: Network: **Test Net**, Origin: `http://localhost:5174`, Operation: `InvokeHostFunction`, Contract: `C...`, Function: `confirm_delivery(delivered_quantity, grade_index)`, Args: `1000`, `0`. | Tx confirmed on Stellar Testnet. On-chain status transitions to `Delivered`. Form is replaced by "Delivery attested" card with settlement percentage. |

---

## 4. Issues & Bugs Discovered During QA

### Bug Report 1: Unconnected Wallet Silent No-Op on Warehouse App Action Buttons
- **Issue:** In `warehouse-app/src/App.tsx`, `handleMarkCheckpoint` and `handleConfirmDelivery` begin with:
  ```ts
  if (!selectedId || !walletAddress) return;
  ```
- **Observed Behavior:** If a user browses `warehouse-app` without first connecting Freighter, the `"Mark mid-season checkpoint"` button and `"Confirm delivery"` button are rendered as active/clickable. When clicked, nothing happens: no error banner appears, no prompt to connect wallet is shown, and no Freighter request is triggered.
- **Expected Behavior:** Action buttons should either be disabled with a helper note (`"Connect warehouse wallet to attest"`), or clicking the button should trigger `handleConnectWallet()` automatically.

### Bug Report 2: Multisig `justApproved` Local State Cleared on Page Reload
- **Issue:** In `coop-pwa/src/components/DisputeSection.tsx` and `warehouse-app/src/components/DisputeSection.tsx`, once a party approves an authorization entry, `justApproved` is stored solely in component React state (`useState(false)`).
- **Observed Behavior:** When a signer signs their entry, the API drops them from `pending_entries`. If the signer reloads their browser tab before the remaining parties finish signing, the UI no longer recognizes that the connected wallet was an approving signer and displays an inaccurate default state until the proposal reaches `"ready"`.
- **Expected Behavior:** The API or local storage should track addresses that have already signed the proposal to display `"Approved — waiting for remaining parties"` even across page reloads.

### UX Gap: Lack of `isFreighterAvailable` Extension Detection in `warehouse-app`
- **Issue:** Unlike `coop-pwa/src/wallet.ts` which exports `isFreighterAvailable()` to check extension presence with a fast 3-second timeout, `warehouse-app/src/wallet.ts` relies solely on `requestAccess()` with a 10-second timeout.
- **Observed Behavior:** When visiting `warehouse-app` on a browser without Freighter installed, clicking `"Connect wallet"` hangs for 10 seconds before failing.
- **Expected Behavior:** Standardize `isFreighterAvailable()` across all frontends to provide immediate feedback when no Web3 provider is detected.
