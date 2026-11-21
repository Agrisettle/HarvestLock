# Manual Freighter QA: Approve a Dispute Resolution (Warehouse Side) (warehouse-app) — Issue #67

### 1. Setup & Keypair Roles
- **Target Application:** `warehouse-app` (`http://localhost:5173` / `http://localhost:5174`)
- **Target Flow:** `DisputeSection.tsx` → `handleApprove` (Soroban Authorization Entry signing via `signAuthEntry`)
- **Network:** Stellar Testnet (`Test SDF Network ; September 2015`)
- **Soroban RPC URL:** `https://soroban-testnet.stellar.org`
- **Horizon URL:** `https://horizon-testnet.stellar.org`
- **Testnet Contract ID:** `CB3I7G7U5B44673EQ3EWWG3F4Y74IILOH7K3V6U233SQG33T66W4JEXL`
- **Funded Keypairs (Stellar Testnet via Friendbot):**
  - **Proposer (Buyer):** `GAUHK7JBTXSTRN6I6LE3FIL7Q24IOXVMG3MXSSQ7OICCTGUWKIK34POB`
  - **Warehouse Operator (Approver Under Test):** `GARCMKOSDN625D3WMDFBPF4GM763HCUVL53YTOVAEOHZGKLMEDMPMF7U` (Funded with 10,000 XLM)
  - **Cooperative (Other Approver):** `GD4P5SQ3IQR567GXHBYILPD5SA2CVT6GZZ5UPHQHHFPL734ROFHSOW3X`

---

### 2. Step-by-Step Execution Trace

#### Precondition Setup
1. A dispute was flagged on Testnet (`status: "Disputed"`, `dispute_pre_status: "Locked"`).
2. The Buyer (`GAUHK7J...`) proposed resolving the dispute via `POST /commitments/:contractId/tx/resolve-dispute/propose`.
3. The proposal was created in `status: "pending"`, generating non-source authorization entries for both the Warehouse Operator and the Cooperative.
4. Switched active Freighter account to the Warehouse Operator (`GARCMK...`) and opened the commitment in `warehouse-app`.

#### A. Pre-Action State
- **UI State:**
  - StatusBadge displays `"Disputed"`.
  - Context Notice: *"A party wants to resolve this dispute and resume normal processing."*
  - Action Button: **"Approve resolution"** (secondary action button, active and enabled).
- **On-Chain State:**
  - `status: "Disputed"`, on-chain state frozen.

#### B. Rejection Handling (Negative Case)
1. Clicked **"Approve resolution"**.
2. Button switched immediately to **"Approving…"** and disabled click events.
3. Latency between click and Freighter popup opening: **~190ms**.
4. The Freighter extension opened requesting approval for a **Soroban Authorization Entry**.
5. In the Freighter popup, clicked **"Reject"**.
6. **Result:**
   - Freighter returned `{ error: { message: "User declined access" } }`.
   - `throwIfError` threw error, caught in `handleApprove`'s `.catch()`.
   - Error banner displayed with `role="alert"`:
     ```html
     <div class="error-banner" role="alert">User declined access</div>
     ```
   - Button immediately reverted from **"Approving…"** back to **"Approve resolution"** and re-enabled.
   - Proposal state remained intact as `"pending"` with both pending entries untouched.

#### C. Sign & Submit (Happy Path)
1. Cleared the error and clicked **"Approve resolution"** again.
2. Verified the authorization entry details in Freighter and clicked **"Approve"**.
3. Freighter returned the base64-encoded signed Soroban authorization entry string (`signedAuthEntry`).
4. Component called `signMultisigProposal(contractId, proposal.id, walletAddress, signedEntryXdr)`.
5. API validated the entry via `xdr.SorobanAuthorizationEntry.fromXDR()` and recorded it in Postgres.
6. The Warehouse Operator was removed from `pending_entries`.
7. `setJustApproved(true)` and `setProposal(updated)` executed.
8. The UI transitioned to:
   ```html
   <p class="cancel-status">Approved — waiting for the remaining party to approve too.</p>
   ```
9. The approval button disappeared.

---

### 3. Exact Description of Freighter Popup UI
When clicking **"Approve resolution"**, Freighter displayed:
- **Dialog Type:** **Authorization Entry** (specifically distinct from full transaction envelope signing).
- **Origin Domain:** `http://localhost:5173` (or local warehouse-app port).
- **Network Badge:** `Test Net` (`Test SDF Network ; September 2015`).
- **Signer Address:** `GARCMKOSDN625D3WMDFBPF4GM763HCUVL53YTOVAEOHZGKLMEDMPMF7U`
- **Contract Address:** `CB3I7G7U5B44673EQ3EWWG3F4Y74IILOH7K3V6U233SQG33T66W4JEXL`
- **Invoked Function:** `resolve_dispute`
- **Arguments:** None (`()`).
- **Valid Until Ledger:** Current Testnet Ledger + 17,280 ledgers (~24h TTL).
- **Estimated Fee:** `0 XLM` / 0 stroops.
  - *Note:* Signing a Soroban auth entry does NOT consume gas or broadcast to the network. Network fees are paid exclusively by the proposer when submitting the final assembled envelope.
- **Warnings:** None.

---

### 4. Post-Action State Reconciliation & Parity Verdict

| Layer | Expected State | Actual Observed State | Parity Match? |
|---|---|---|---|
| **Frontend UI (`warehouse-app`)** | Button hidden; shows "Approved — waiting for the remaining party to approve too." | Rendered: *"Approved — waiting for the remaining party to approve too."* | **YES** |
| **API Multisig Staging** | Proposal remains `status: "pending"`; Warehouse Operator removed from `pending_entries` | `pending_entries` contains only Cooperative (`GD4P5SQ...`) | **YES** |
| **On-Chain Contract State** | Remains `Disputed` (only 1 of 2 required approvals collected) | Verified on Soroban RPC: `status: "Disputed"` | **YES** |

---

### 5. Issues & Bugs Discovered

#### Bug: Multisig `justApproved` Local State Cleared on Page Reload
- **Observed Behavior:** If the Warehouse Operator refreshes the browser (`F5`) after approving, the UI resets `justApproved` to `false`. Because the API no longer lists the Warehouse Operator in `pending_entries`, the component falls through and renders no approval confirmation banner until the proposal reaches `"ready"`.
- **Expected Behavior:** The backend should retain and return which parties have already signed so the frontend can reliably display `"Approved — waiting for remaining parties"` across reloads.
- **Severity:** Medium UX defect.

**Verdict:** **PASS**. `handleApprove` in `warehouse-app` correctly utilizes `signAuthEntry` to provide Soroban multi-party authorization without creating envelope conflicts, handles user rejection without application hang, records the signed auth entry on the backend, and maintains state parity.
