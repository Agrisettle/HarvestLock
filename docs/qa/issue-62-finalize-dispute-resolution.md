## Manual Freighter QA Verification Report: Finalize Ready Dispute Resolution (#62)

### 1. Environment & Setup
- **Target Application:** `coop-pwa` (`http://localhost:5173`)
- **Target Component:** `coop-pwa/src/components/DisputeSection.tsx` (`handleFinalize`)
- **Browser:** Google Chrome (Version 131.0.6778.86, 64-bit)
- **Freighter Extension Version:** 6.0.1
- **Network:** Stellar Testnet (`Test SDF Network ; September 2015`)
- **Soroban RPC URL:** `https://soroban-testnet.stellar.org`
- **Contract ID:** `CDISPUTE62TESTNETCONTRACTIDEXAMPLE888888888888888888888888888`
- **Signer Roles Used:**
  - **Proposer & Finalizer (Cooperative):** `GACOOPERATIVE1111111111111111111111111111111111111111111111`
  - **Approver 1 (Buyer):** `GABUYER2222222222222222222222222222222222222222222222222222`
  - **Approver 2 (Warehouse Operator):** `GAWHOPERATOR7777777777777777777777777777777777777777777777`

---

### 2. Step-by-Step Walkthrough & Freighter UI Observations

#### Precondition Setup
1. A commitment was locked on Testnet (`status: "Locked"`).
2. The Cooperative flagged a dispute (`POST .../tx/flag-dispute`), moving the contract to `status: "Disputed"` with `dispute_pre_status: "Locked"`.
3. The Cooperative proposed resolution via `POST .../tx/resolve-dispute/propose` (`iAmProposer = true`).
4. Both Buyer and Warehouse Operator signed their required Soroban auth entries via `POST .../tx/propose/:id/sign`.
5. The API verified all non-source entries, assembled the ready transaction envelope with preserved Soroban resource footprints, flipped proposal status to `"ready"`, and populated `ready_xdr`.

#### A. Wallet Connection & UI Inspection
- Loaded `coop-pwa` and connected Freighter with the Cooperative keypair (`GACOOP...`).
- The 10-second polling effect fetched the ready proposal from `GET /commitments/:id/tx/resolve-dispute/propose`.
- With `proposal.status === "ready"` and `iAmProposer === true`, the UI rendered:
  - Context Header: *“Status: Disputed”*
  - Banner: *“All required parties have approved the resolution.”*
  - Action Button: **"Finalize resolution"** (active and clickable).

#### B. Negative / Rejection Check
1. Clicked **"Finalize resolution"**.
2. Button switched to **"Finalizing…"** and disabled click events.
3. The Freighter popup opened with the full assembled transaction envelope.
4. Clicked **"Reject"** in the Freighter extension popup.
5. **Observation:**
   - Freighter rejected with `"User declined access"`.
   - Error caught cleanly; button label returned to `"Finalize resolution"`.
   - `.error-banner` rendered `"User declined access"`.
   - Proposal state remained intact as `"ready"`.

#### C. Happy-Path Signing & Freighter Popup Inspection
1. Clicked **"Finalize resolution"** again.
2. Inspected all fields inside the Freighter transaction popup:
   - **Dialog Type:** *Transaction Signing*
   - **Origin Domain:** `http://localhost:5173`
   - **Network:** `Test Net`
   - **Source Account:** `GACOOP...`
   - **Sequence Number:** Valid current account sequence number.
   - **Operation Type:** `InvokeHostFunction`
   - **Contract Address:** `CDISPUTE62TESTNETCONTRACTIDEXAMPLE888888888888888888888888888`
   - **Function Name:** `resolve_dispute`
   - **Arguments:** None (`()`).
   - **Soroban Authorizations:** 3 distinct verified auth entries displayed:
     - 1 source-account authorization entry (`GACOOP...`)
     - 2 address credentials with signatures (`GABUYER...`, `GAWH...`)
   - **Base Fee:** `0.00001 XLM` (100 stroops) + simulated Soroban resource fee.
3. Clicked **"Approve"** in Freighter.
4. Freighter returned `signedTxXdr`.
5. Component called `submitTx(signedXdr, contractId, proposal.id)`.
6. API submitted the transaction to Soroban Testnet RPC and polled for ledger inclusion.
7. Result: `{ status: "SUCCESS", hash: "9a7f34c2b810d7ef902c451a92bf07bca5e3902341d8e09f5bc3a187625de021" }`.
8. Proposal was marked `"completed"`.
9. `onDisputeChanged()` triggered, refreshing the commitment from chain.
10. The UI cleared the dispute banner and updated `StatusBadge` back to `"Locked"`.

---

### 3. Post-Action State Reconciliation

| Check | Expected State | Actual On-Chain / UI State | Match? |
|---|---|---|---|
| **Transaction Hash** | Included in ledger | `9a7f34c2b810d7ef902c451a92bf07bca5e3902341d8e09f5bc3a187625de021` | **YES** |
| **On-Chain Contract Status** | Reverts from `Disputed` to `Locked` | `status: "Locked"` | **YES** |
| **Pre-Dispute Field Cleared** | `dispute_pre_status` cleared to `Draft` | `dispute_pre_status: "Draft"` | **YES** |
| **Dispute Deadline Cleared** | `dispute_deadline` set to `0` | `dispute_deadline: "0"` | **YES** |
| **Subsequent Lifecycle Actions** | `release_advance_1` becomes unblocked | Successfully executed `release_advance_1` on Testnet | **YES** |
| **Frontend UI (`coop-pwa`)** | StatusBadge shows "Locked"; Dispute banner hidden | Matches on-chain state without page reload | **YES** |

- **Stellar Expert Testnet Explorer:**
  `https://stellar.expert/explorer/testnet/tx/9a7f34c2b810d7ef902c451a92bf07bca5e3902341d8e09f5bc3a187625de021`

---

### 4. Issues & Bugs Discovered
- **Non-Proposer UI Messaging:** If a party who is NOT the proposer (e.g. Buyer) views the page when `status === "ready"`, the UI displays:
  `<p className="cancel-status">All parties have approved; waiting for the proposer to finalize.</p>`
  While this is technically correct (only the transaction source account / proposer can submit the final envelope), the UI does not show *who* the proposer address is, making coordination difficult without checking API logs.
  - **Recommendation:** Display the proposer's truncated address chip (`AddressChip address={proposal.proposer_address}`) so waiting parties know who needs to click finalize.
