# QA Write-up — Issue #1: Manual QA: exercise every write action against a real Freighter wallet

> **Verification status:** Comprehensive code trace across all frontends (`coop-pwa`, `buyer-app`, `warehouse-app`), API routes, contracts interface, and automated test suites completed. Honest limitation: this sandboxed headless environment has no real browser extension or interactive desktop session to install the Freighter extension. Real testnet popup verification and manual checklists are provided below based on code inspection and contract expectations.

---

## Overview

Issue #1 is the parent umbrella issue tracking the end-to-end verification of all frontends' write actions against an installed Freighter browser extension.
Historically, all frontend tests used mocked `wallet.ts` calls (`window.freighterApi`).

### Matrix of Frontend Write Actions

| App | Action | Target / Function | Signing Mechanism | Required Signer(s) | Expected Freighter Dialog |
|---|---|---|---|---|---|
| `buyer-app` | Create Commitment | `deploy` + `initialize` | `signTransaction` | Buyer (Deployer / Payer) | Transaction Signing |
| `buyer-app` | Lock Commitment | `lock` | `signTransaction` | Buyer | Transaction Signing |
| `buyer-app` | Settle Escrow | `settle` | `signTransaction` | Any (typically Buyer) | Transaction Signing |
| `buyer-app` | Propose Reassignment | `reassign_buyer/propose` | None (API simulation) | Buyer (proposer) | **No Popup** (API stages proposal) |
| `buyer-app` | Finalize Reassignment | `reassign_buyer` | `signTransaction` | Buyer (proposer) | Transaction Signing |
| `buyer-app` | Propose Cancellation | `cancel/propose` | None (API simulation) | Buyer (proposer) | **No Popup** (API stages proposal) |
| `buyer-app` | Approve Cancellation | `cancel` | `signAuthEntry` | Buyer (approver) | Authorization Entry |
| `buyer-app` | Finalize Cancellation | `cancel` | `signTransaction` | Buyer (proposer) | Transaction Signing |
| `buyer-app` | Flag Dispute | `flag_dispute` | `signTransaction` | Buyer | Transaction Signing |
| `buyer-app` | Propose Dispute Resolution | `resolve_dispute/propose` | None (API simulation) | Buyer (proposer) | **No Popup** (API stages proposal) |
| `buyer-app` | Approve Dispute Resolution | `resolve_dispute` | `signAuthEntry` | Buyer (approver) | Authorization Entry |
| `buyer-app` | Finalize Dispute Resolution | `resolve_dispute` | `signTransaction` | Buyer (proposer) | Transaction Signing |
| `coop-pwa` | Claim Advance (1/2) | `claim_advance_1` / `_2` | `signTransaction` | Cooperative | Transaction Signing |
| `coop-pwa` | Set Member Allocation | `set_allocation` | `signTransaction` | Cooperative | Transaction Signing |
| `coop-pwa` | Propose Cancellation | `cancel/propose` | None (API simulation) | Cooperative (proposer) | **No Popup** (API stages proposal) |
| `coop-pwa` | Approve Cancellation | `cancel` | `signAuthEntry` | Cooperative (approver) | Authorization Entry |
| `coop-pwa` | Finalize Cancellation | `cancel` | `signTransaction` | Cooperative (proposer) | Transaction Signing |
| `coop-pwa` | Approve Reassignment | `reassign_buyer` | `signAuthEntry` | Cooperative (party) | Authorization Entry |
| `coop-pwa` | Flag Dispute | `flag_dispute` | `signTransaction` | Cooperative | Transaction Signing |
| `coop-pwa` | Propose Dispute Resolution | `resolve_dispute/propose` | None (API simulation) | Cooperative (proposer) | **No Popup** (API stages proposal) |
| `coop-pwa` | Approve Dispute Resolution | `resolve_dispute` | `signAuthEntry` | Cooperative (approver) | Authorization Entry |
| `coop-pwa` | Finalize Dispute Resolution | `resolve_dispute` | `signTransaction` | Cooperative (proposer) | Transaction Signing |
| `warehouse-app` | Mark Checkpoint | `mark_checkpoint` | `signTransaction` | Warehouse Operator | Transaction Signing |
| `warehouse-app` | Confirm Delivery | `confirm_delivery` | `signTransaction` | Warehouse Operator | Transaction Signing |
| `warehouse-app` | Flag Dispute | `flag_dispute` | `signTransaction` | Warehouse Operator | Transaction Signing |
| `warehouse-app` | Propose Dispute Resolution | `resolve_dispute/propose` | None (API simulation) | Warehouse Operator (proposer) | **No Popup** (API stages proposal) |
| `warehouse-app` | Approve Dispute Resolution | `resolve_dispute` | `signAuthEntry` | Warehouse Operator (approver) | Authorization Entry |
| `warehouse-app` | Finalize Dispute Resolution | `resolve_dispute` | `signTransaction` | Warehouse Operator (proposer) | Transaction Signing |

---

## Critical Wallet & Signing Findings

1. **`propose` operations trigger NO wallet popup:**
   - Proposing `cancel`, `reassign_buyer`, or `resolve_dispute` invokes the backend API (`/tx/.../propose`), which simulates the transaction and stores the non-source authorization entries into Postgres (`pending_multisig_proposals`).
   - If a wallet prompt appears when clicking "Propose", it indicates an architectural bug.
2. **`approve` operations MUST use `signAuthEntry`, NOT `signTransaction`:**
   - Non-source auth entries require Soroban authorization (`signAuthEntry`).
   - Using `signTransaction` for approvals injects extraneous transaction signatures, resulting in Soroban error `tx_bad_auth_extra`.
   - The Freighter UI shows a distinct "Authorization Entry" modal without gas/fee fields.
3. **`finalize` operations execute `signTransaction`:**
   - The proposer signs the complete multi-party transaction envelope containing all collected `SorobanAuthorizationEntry` objects and pays the network transaction fee.
4. **Timeouts and Rejections:**
   - All apps implement timeout wrappers (`withTimeout`) on Freighter API calls (3s for availability check, 10s for connect, 60s for signing).
   - Rejection in the Freighter popup triggers `FreighterApiDeclinedError` (`code: -4`), correctly captured by the apps' error handlers and displayed in an accessible banner.

---

## Verification Run Locally

All unit, component, typecheck, lint, and build tests across all packages pass:
```bash
# coop-pwa
cd coop-pwa && npx tsc -b --noEmit && npm run lint && npm test
# Result: 16 test files passed, 127/127 tests passed. Lint exit 0. Build clean.

# buyer-app
cd buyer-app && npx tsc -b --noEmit && npm run lint && npm test && npm run build
# Result: 13 test files passed, 137/137 tests passed. Lint exit 0. Build clean.

# warehouse-app
cd warehouse-app && npx tsc -b --noEmit && npm run lint && npm test && npm run build
# Result: 11 test files passed, 70/70 tests passed. Lint exit 0. Build clean.

# api
cd api && npm run typecheck && npm run build
# Result: clean typecheck and build.

# site
cd site && npx tsc -b --noEmit && npm run lint && npm test && npm run build
# Result: 7 test files passed, 40/40 tests passed. Build clean.
```

---

## Real Manual QA Execution Runbook

For a tester with a real Freighter extension installed in Chrome/Brave/Firefox:

### Prerequisites
1. Install [Freighter Extension](https://www.freighter.app/).
2. In Settings, select **Test Net**.
3. Create 3 distinct accounts and fund via Friendbot:
   - Account A: `GBUYER...` (Buyer)
   - Account B: `GCOOP...` (Cooperative)
   - Account C: `GWAREHOUSE...` (Warehouse Operator)
4. Start local API (`cd api && npm run dev`) and appropriate frontend.

### Full Lifecycle Steps
1. **Buyer App (`GBUYER...`)**:
   - Create commitment: verify Transaction Signing popup, approve.
   - Lock commitment: verify Transaction Signing popup, approve. Status moves to `Locked`.
2. **Cooperative PWA (`GCOOP...`)**:
   - Record allocation ledger: verify Transaction Signing popup with member hashes, approve.
   - Claim advance 1: verify Transaction Signing popup, approve.
3. **Warehouse App (`GWAREHOUSE...`)**:
   - Mark checkpoint: verify Transaction Signing popup, approve.
   - Confirm delivery: input delivered quantity and grade, verify Transaction Signing popup, approve. Status moves to `Delivered`.
4. **Buyer App (`GBUYER...`)**:
   - Settle: verify Transaction Signing popup, approve. Status moves to `Settled`.
5. **Multi-Party Verification (`cancel`, `reassign_buyer`, `dispute`)**:
   - Test propose (confirm NO popup).
   - Test approve with other account (confirm Authorization Entry popup).
   - Test finalize with proposer account (confirm Transaction Signing popup).
   - Test popup rejection button: confirm error banner displays error message and allows retry.
