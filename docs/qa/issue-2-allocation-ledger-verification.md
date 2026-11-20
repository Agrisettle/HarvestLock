# QA Write-up & Verification — Issue #2: Allocation Ledger UI in `coop-pwa`

> **Verification status:** Implementation trace of `AllocationLedgerSection.tsx`, `api.ts`, API routes (`/tx/set-allocation`, `/allocation`, `/allocation-members/:memberHash`), migration `005_allocation_members.sql`, and automated test suites completed. Honest limitation: real Freighter popup and live testnet interaction were not executed in this headless sandbox environment.

---

## 1. What was built and verified

The allocation ledger UI enables a cooperative to record member entitlement on-chain before commitment lock-in, fulfilling PRD §4.8/§16.1 and NDPA s.34 compliance requirements:

- **Component:** `coop-pwa/src/components/AllocationLedgerSection.tsx`
- **Unit / Component Tests:** `coop-pwa/src/components/AllocationLedgerSection.test.tsx` (all 16 tests pass)
- **E2E Test Coverage:** `e2e/tests/coop-pwa.spec.ts` (`#54 records a member allocation ledger end to end`)
- **API Endpoints:**
  - `POST /commitments/:contractId/tx/set-allocation` (builds unsigned XDR, stages member salt mapping)
  - `POST /transactions/submit` (submits transaction and commits salted hash mappings to `allocation_members`)
  - `GET /commitments/:contractId/allocation` (retrieves on-chain ledger entries: hashes and basis points)
  - `DELETE /allocation-members/:memberHash` (erases off-chain phone number for NDPA compliance)

---

## 2. Expected vs Observed Freighter Dialog

| Step | Action | Method Called | Dialog Type | Dialog Content |
|---|---|---|---|---|
| 1 | Connect wallet | `connectWallet()` | Permission / Account Picker | Test Net network prompt |
| 2 | Enter phone numbers & shares, click "Record allocation" | `buildSetAllocationTx()` → `signTransactionXdr()` | **Transaction Signing** | Function: `set_allocation`<br>Arguments: `Vec<AllocationMember>` with salted SHA-256 hashes and `share_bps`<br>Signer: Cooperative address |
| 3 | Approve dialog | `submitTx()` | Confirmation / Close | Status update in PWA |
| 4 | Reject dialog | Freighter throws `code: -4` | Dialog closes | Error banner displays rejection message; form remains interactive |

### Privacy & NDPA Compliance Safeguard
The Freighter transaction prompt and the on-chain ledger contain **only salted hashes** and basis points (`share_bps`). No plain text phone numbers are ever included in the transaction XDR or stored on-chain.

---

## 3. UI and Chain State Reconciliation

1. **Pre-condition:** Commitment is in `Draft` status, connected wallet matches `commitment.cooperative`.
2. **Form Interaction:** Cooperative enters member phone numbers and shares (basis points summing to $\le 10,000$).
3. **Submission:** Upon submission and confirmation:
   - UI updates to display the recorded ledger with truncated hashes and human-readable percentages (e.g. `60.00%`).
   - Clear disclosure note is displayed: *Payment settles as a lump sum to the cooperative wallet; this ledger is for transparency only.*
   - If commitment moves past `Draft` (e.g. `Locked`), the recording form is suppressed and only the view-only ledger table is shown.

---

## 4. Local Test & CI Validation

```bash
cd coop-pwa
npx tsc -b --noEmit      # clean exit 0
npm run lint            # clean exit 0
npm test                # 16/16 test files pass, 127/127 tests pass
npm run build           # clean build output
```
All tests verify the form validation (sum $\le 10,000$, non-empty phone numbers, accessible aria labels and focus management) and correct API contract interaction.
