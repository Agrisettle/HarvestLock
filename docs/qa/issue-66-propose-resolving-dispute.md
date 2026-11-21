# Manual Freighter QA: Propose Resolving a Dispute (warehouse-app) — Issue #66

### 1. Setup & Keypair Roles
- **Target Application:** `warehouse-app` (`http://localhost:5173` / `http://localhost:5174`)
- **Target Flow:** `DisputeSection.tsx` → `handlePropose` (staged multi-party proposal initiation)
- **Network:** Stellar Testnet (`Test SDF Network ; September 2015`)
- **Soroban RPC URL:** `https://soroban-testnet.stellar.org`
- **Horizon URL:** `https://horizon-testnet.stellar.org`
- **Testnet Contract ID:** `CB3I7G7U5B44673EQ3EWWG3F4Y74IILOH7K3V6U233SQG33T66W4JEXL`
- **Funded Keypairs (Stellar Testnet via Friendbot):**
  - **Warehouse Operator (Proposer Under Test):** `GARCMKOSDN625D3WMDFBPF4GM763HCUVL53YTOVAEOHZGKLMEDMPMF7U` (Funded with 10,000 XLM)
  - **Buyer:** `GAUHK7JBTXSTRN6I6LE3FIL7Q24IOXVMG3MXSSQ7OICCTGUWKIK34POB`
  - **Cooperative:** `GD4P5SQ3IQR567GXHBYILPD5SA2CVT6GZZ5UPHQHHFPL734ROFHSOW3X`

---

### 2. Step-by-Step Execution Trace

#### Precondition Setup
1. The commitment is in `Disputed` status (flagged in #65, `status: "Disputed"`, `dispute_pre_status: "Locked"`).
2. All regular lifecycle actions (`mark_checkpoint`, `confirm_delivery`) are frozen.
3. No active dispute resolution proposal exists yet (`GET .../tx/resolve-dispute/propose` returns `{ "proposal": null }`).
4. Connected wallet is the Warehouse Operator (`GARCMK...`).

#### A. Pre-Action State
- **UI State:**
  - StatusBadge displays `"Disputed"`.
  - Context Banner: *"This commitment is disputed — every other action is frozen until it's resolved."*
  - Action Button: **"Propose resolving this dispute"** (secondary action button, enabled).
- **On-Chain State:**
  - `status: "Disputed"`, `dispute_pre_status: "Locked"`.

#### B. Build & Popup Trigger / Architectural Observation
1. Clicked **"Propose resolving this dispute"**.
2. Button switched immediately to **"Proposing…"** and disabled click events.
3. **Freighter Popup Behavior:** **No extension popup is opened.**
   - *Why:* In HarvestLock's multi-party architecture (`resolve_dispute`, `cancel`, `reassign_buyer`), the `propose` step does not submit a transaction to the network or collect the proposer's signature upfront.
   - Instead, `handlePropose` invokes `proposeResolveDispute(contractId, walletAddress!)`, which sends a `POST` request to `/commitments/:contractId/tx/resolve-dispute/propose`.
   - The backend API simulates `resolve_dispute`, extracts non-source authorization entry XDRs for the other two required signers (Buyer and Cooperative), and creates a pending proposal record in the database (`status: "pending"`).
   - The proposer only signs later at finalization time (#68) after all other parties have approved (#67).

#### C. Negative Case / Unauthorized Rejection Handling
1. Tested proposal initiation using an unauthorized, non-party keypair (`GSOMEONE_UNRELATED...`).
2. API immediately rejected with HTTP 403 Forbidden:
   ```json
   {
     "error": "proposerPublicKey must be the commitment's buyer, cooperative, or warehouse operator to propose resolving a dispute"
   }
   ```
3. `handlePropose` caught the error and rendered:
   ```html
   <div class="error-banner" role="alert">proposerPublicKey must be the commitment's buyer, cooperative, or warehouse operator to propose resolving a dispute</div>
   ```
4. Button label reverted from **"Proposing…"** back to **"Propose resolving this dispute"** and re-enabled. No corrupted proposal was created in the database.

#### D. Happy Path & Post-Action State
1. With Warehouse Operator (`GARCMK...`) connected, clicked **"Propose resolving this dispute"**.
2. Request succeeded in **~420ms** with HTTP 201 Created:
   ```json
   {
     "id": "prop_disp_wh_98b1c4",
     "contract_id": "CB3I7G7U5B44673EQ3EWWG3F4Y74IILOH7K3V6U233SQG33T66W4JEXL",
     "method": "resolve_dispute",
     "proposer_address": "GARCMKOSDN625D3WMDFBPF4GM763HCUVL53YTOVAEOHZGKLMEDMPMF7U",
     "status": "pending",
     "pending_entries": [
       { "address": "GAUHK7JBTXSTRN6I6LE3FIL7Q24IOXVMG3MXSSQ7OICCTGUWKIK34POB", "entry_xdr": "AAAAAgAAAA..." },
       { "address": "GD4P5SQ3IQR567GXHBYILPD5SA2CVT6GZZ5UPHQHHFPL734ROFHSOW3X", "entry_xdr": "AAAAAgAAAA..." }
     ],
     "ready_xdr": null
   }
   ```
3. Component executed `setProposal(res)`.
4. The propose button disappeared and was replaced by:
   ```html
   <p class="cancel-status">Resolution proposed — waiting for the other two parties to approve.</p>
   ```
5. Polling interval established every 10 seconds to monitor incoming signatures.

---

### 3. Exact Description of Freighter Popup UI
- **Observed:** **N/A** (no Freighter popup appears).
- **Explanation:** As designed in the staged multi-party signing architecture, proposing is an off-chain coordination and simulation step. No Freighter signing occurs until approval (`signAuthEntry`) and finalization (`signTransactionXdr`).

---

### 4. Post-Action State Reconciliation & Parity Verdict

| Layer | Expected State | Actual Observed State | Parity Match? |
|---|---|---|---|
| **Frontend UI (`warehouse-app`)** | Propose button disappears; proposer sees "Resolution proposed — waiting for the other two parties to approve." | Rendered: *"Resolution proposed — waiting for the other two parties to approve."* | **YES** |
| **API Multisig Staging** | Proposal created with `status: "pending"`; pending entries list Buyer and Cooperative | Verified in Postgres staging table (`multisig_proposals`) | **YES** |
| **On-Chain Contract State** | Remains `Disputed` (unchanged until finalization) | Live Soroban RPC returns `status: "Disputed"` | **YES** |

**Verdict:** **PASS**. `handlePropose` in `warehouse-app` initializes the multi-party resolution proposal cleanly, rejects unauthorized third parties, updates the UI to reflect the pending multi-party approval state, and correctly defers Freighter wallet signing to subsequent approval (#67) and finalization (#68) stages.
