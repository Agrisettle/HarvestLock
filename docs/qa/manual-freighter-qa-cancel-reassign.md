# Manual Freighter QA runbook — cancellation & buyer reassignment (`coop-pwa`)

Scope: issues **#55** (propose cancellation), **#56** (approve buyer-proposed cancellation), **#57** (finalize ready cancellation), **#58** (approve buyer-reassignment proposal, cooperative side).

## Verification status — read this first

This document is deliberately explicit about what was and was not executed.

| Category | Status here |
|---|---|
| Source trace of all four handlers (`CancelSection.tsx`, `ReassignBuyerSection.tsx`, `wallet.ts`, `api.ts`, server routes, sequence docs) | **Done** |
| `coop-pwa` unit/component suite: 16 files, 127 tests | **Done — all pass** |
| `coop-pwa` typecheck (`tsc -b --noEmit`) | **Done — passes** |
| `coop-pwa` lint (`oxlint`) | **Done — passes** (7 pre-existing warnings, exit 0) |
| Real, installed Freighter extension, real funded testnet keypairs, real popup observation | **Not executed in this environment.** There is no browser extension or interactive desktop session here. |
| Fabricated popup screenshots, transaction hashes, or "observed" field values | **None.** Where the expected popup content is described below it is labelled *expected*, derived from the exact arguments the app passes to Freighter. The observation columns exist to be filled in by the person running the checklist. |

The four per-issue reports under `docs/qa/` follow the same convention: they record the code-level and test-level evidence that does exist, and provide a precise observation checklist for the one layer that cannot be reached from this sandbox.

## 1. Sources of truth

- `coop-pwa/README.md` — "Freighter caveat" notes for claim-advance, cancel, and reassignment.
- `coop-pwa/src/wallet.ts` — `NETWORK_PASSPHRASE`, `withTimeout`, `signTransactionXdr`, `signAuthEntry`.
- `coop-pwa/src/components/CancelSection.tsx` — `handlePropose`, `handleApprove`, `handleFinalize`.
- `coop-pwa/src/components/ReassignBuyerSection.tsx` — `handleApprove` (cooperative side).
- `coop-pwa/src/api.ts` — the HTTP calls behind those handlers.
- `api/src/server.ts` — propose/sign/submit routes.
- `api/docs/cancel-sequence.md`, `api/docs/reassign-buyer-sequence.md` — on-chain effects.
- `coop-pwa/src/i18n/en.json` — exact user-facing strings asserted below.

## 2. The Freighter caveat

`coop-pwa/README.md` states the gap this QA is meant to close:

> **What's verified and what isn't**: the API calls (build/submit) and the component logic ... are tested ... What's **not** independently verified in this session: signing against a real, installed Freighter extension — this sandboxed environment has no way to install and drive a real browser extension with a real funded account. ... Manual QA with a real Freighter install is still a real gap before calling this fully proven.

The cancel and reassignment sections repeat the same note for their flows. `e2e/README.md` confirms the boundary: its real-browser tests stub only the wallet extension, "No Freighter exists in a headless environment (a long-documented limitation of this project)".

## 3. Wallet contract the tester must check against

`coop-pwa/src/wallet.ts` hardcodes the testnet passphrase `"Test SDF Network ; September 2015"`. Every Freighter call goes through `withTimeout`:

| Wrapper | Freighter method | Timeout | Used by |
|---|---|---|---|
| `isFreighterAvailable()` | `isConnected()` | 3 s | connection badge |
| `connectWallet()` | `requestAccess()` | 10 s | initial connect |
| `signAuthEntry()` | `signAuthEntry(entryXdr, { address, networkPassphrase })` | 60 s | #56, #58 (non-proposer approval) |
| `signTransactionXdr()` | `signTransaction(xdr, { address, networkPassphrase })` | 60 s | #57 finalize |

`signAuthEntry` and `signTransactionXdr` are **not interchangeable**. `signAuthEntry` signs one Soroban authorization entry for a non-source party; using `signTransaction` there would add an extra classic envelope signature and the network rejects the transaction with `tx_bad_auth_extra` (`HANDOFF.md:42`). This distinction is the main thing real-popup QA is expected to confirm.

A popup rejection resolves/rejects with a Freighter error; `throwIfError` turns it into an `Error`, the component `.catch` puts the message into `.error-banner`, and `.finally` clears `busy`.

## 4. Keypairs and roles

| Role | Alias | Needed for |
|---|---|---|
| Buyer | `GBUYER...` | #55 proposer (typical), #56 approver when the co-op proposed, finalizer for #58 |
| Cooperative | `GCOOP...` | #56 and #58 approver; #57 proposer when the co-op proposed |
| Incoming buyer | `GNEWBUYER...` | #58 only — a third funded account, not yet a field on the commitment |
| Deployer | `GDEPLOYER...` | deploys/initializes the commitment; never appears in Freighter |

Cancel needs **two** funded keypairs; reassignment needs **three**. All participating addresses must be funded/created accounts — an unfunded key fails on-chain with a storage error, not a signature error.

Generate and fund (requires `stellar-cli`; the raw friendbot equivalent works for any `G...` address):

```sh
stellar keys generate buyer         --network testnet --fund
stellar keys generate cooperative   --network testnet --fund
stellar keys generate incoming-buyer --network testnet --fund
# curl -s "https://friendbot.stellar.org/?addr=<G...>" if generating addresses another way
```

In Freighter: Settings → Network → **Test Net**, then import the secret keys with labels `HarvestLock Buyer`, `HarvestLock Coop`, `HarvestLock Incoming Buyer`.

## 5. Environment

Start Postgres, run `npm run migrate` in `api/`, then `npm run dev` for the API and `coop-pwa`. `api/.env` needs `DATABASE_URL`, `STELLAR_RPC_URL=https://soroban-testnet.stellar.org`, `STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015`, `DEPLOYER_SECRET_KEY`, `ESCROW_WASM_HASH`, and `CORS_ORIGINS=http://localhost:5173`. `coop-pwa/.env` needs `VITE_API_URL=http://localhost:3000`.

`coop-pwa` is served at `http://localhost:5173`; that origin is what should appear in every Freighter popup.

Seeding states that no single UI click can reach should be done through the real API routes (the same approach `e2e/tests/helpers/api.ts` takes), not by mocking:

- **#55/#56/#57**: a commitment in `Draft`…`ReadyForDelivery` with `buyer` and `cooperative` set to two of the imported keys. `Locked` is the simplest starting point (deploy → initialize → buyer `lock`).
- **#58**: the same, plus the outgoing buyer must be the connected wallet on the proposing device, and `GNEWBUYER...` must be funded.

Confirm the precondition on-chain before starting each flow: the API's commitment detail should show the expected `status`, `buyer`, and `cooperative`, and should match `GET /commitments/:id` from the chain.

## 6. Per-flow execution and observation checklist

### #55 — propose a cancellation

Actors: buyer or cooperative (co-op is the typical `coop-pwa` viewer).

1. Connect `GCOOP...` (or `GBUYER...`) in `coop-pwa`, open the commitment detail.
2. Click **"Cancel this commitment"** (`cancel.propose`, `CancelSection.tsx:119`).
3. `handlePropose` calls `POST /commitments/:id/tx/cancel/propose { proposerPublicKey }`. The API simulates `cancel()` sourced from the proposer, stages the *other* party's auth entry with a ~24 h `signatureExpirationLedger`, and returns a `pending` proposal.

Expected Freighter UI: **none — no wallet call is made in this handler.** Verify this by watching for a popup: one should not appear.

Expected UI state: the button disappears and `cancel.proposed` — "Cancellation proposed — waiting for the other party to approve." — is shown (`CancelSection.tsx:124-126`). Expected chain state: **unchanged** (still `Locked`); only Postgres staging exists.

Observation checklist:

- [ ] No Freighter popup at any point during propose.
- [ ] API response `status: "pending"`, `pending_entries: [other party]`, `ready_xdr: null`.
- [ ] UI text matches `cancel.proposed`; no error banner.
- [ ] `GET /commitments/:id` on chain still shows the pre-proposal status.

### #56 — approve a cancellation proposed by the buyer

Actors: buyer proposes; cooperative approves.

1. With `GBUYER...` connected in `buyer-app` (or through the API), propose the cancellation as in #55.
2. Switch to `GCOOP...` in `coop-pwa` and open the same commitment. Within 10 s the poll picks up the proposal.
3. UI shows "The other party wants to cancel this commitment." and **"Approve cancellation"** (`CancelSection.tsx:128-135`).
4. Click it. `handleApprove` calls `signAuthEntry(myEntry.entry_xdr, GCOOP...)`, then posts the signed entry to `POST /commitments/:id/tx/propose/:proposalId/sign`.

Expected Freighter popup fields (derived from the `signAuthEntry` call and the API's staged entry): dialog type **Authorization Entry** / authorizing an invocation, network **Test Net**, origin `http://localhost:5173`, signer `GCOOP...`, contract `C...`, function `cancel`, no arguments, authorization valid until roughly the current ledger + 17,280. There is no fee for signing the entry itself.

Expected UI state: approver sees `cancel.approvedWaiting` — "Approved — waiting for the proposer to finalize." — and **no** Finalize button (`CancelSection.tsx:143-145`). Expected chain state: **still unchanged**; the API has only flipped the staged row to `ready` and built `ready_xdr`.

Observation checklist:

- [ ] Popup is an authorization-entry request, **not** a transaction-signing request.
- [ ] Network badge reads Test Net, origin is `localhost:5173`, signer is `GCOOP...`, function is `cancel`.
- [ ] Approving returns quickly and the response has `status: "ready"` with a non-null `ready_xdr`.
- [ ] UI shows `cancel.approvedWaiting`, no Finalize button, no error banner.
- [ ] On-chain status is unchanged before finalize.
- [ ] Reject path: clicking Reject shows the Freighter message in `.error-banner` (`role="alert"`), button re-enables, proposal remains `pending`.

### #57 — finalize a ready cancellation

Actors: the original proposer (buyer in the #55/#56 sequence).

1. Switch back to `GBUYER...`, open the commitment. Within 10 s the poll sees `status: "ready"`.
2. Click **"Finalize cancellation"** (`CancelSection.tsx:137-141`).
3. `handleFinalize` calls `signTransactionXdr(proposal.ready_xdr, GBUYER...)`, then `submitTx(signedXdr, contractId, proposal.id)` → `POST /transactions/submit` with `completeProposalId`.

Expected Freighter popup fields: ordinary **Transaction Signing** dialog, network **Test Net**, origin `http://localhost:5173`, signer `GBUYER...`, an `InvokeHostFunction` operation on the escrow contract calling `cancel()` with no arguments, two authorization entries, and a base fee plus Soroban resource fee.

Expected chain state: contract verifies `require_once_each(buyer, cooperative)`, sets `status := Cancelled` (emitting `status_changed`), and transfers the contract's remaining token balance back to the buyer. Already-claimed advances are not clawed back; if nothing was locked the balance is zero and no transfer occurs (`api/docs/cancel-sequence.md:79-81`).

Expected UI state: `setProposal(null)` and `onCancelled()` → `App.tsx` reloads the detail, the status badge shows **Cancelled**, and `CancelSection` unmounts because `Cancelled` is not in `CANCELLABLE_STATUSES`.

Observation checklist:

- [ ] Popup is a full transaction-signing dialog (not an auth entry), signer is the proposer, function `cancel`.
- [ ] Submit returns `SUCCESS` with a hash; the hash resolves on testnet with `status_changed`.
- [ ] `GET /commitments/:id` shows `Cancelled` and the remaining escrow balance returned to the buyer.
- [ ] UI badge reads `Cancelled` after the detail reload; `CancelSection` is gone.
- [ ] Reject path: error banner appears, no submit call is made, proposal stays `ready`.

### #58 — approve a buyer-reassignment proposal (cooperative side)

Actors: outgoing buyer proposes, cooperative approves, incoming buyer also approves, outgoing buyer finalizes. This issue covers only the **cooperative approval** step.

1. With `GBUYER...` connected, propose reassignment to `GNEWBUYER...` (the propose form is only rendered for the current buyer).
2. Switch to `GCOOP...` in `coop-pwa`. The 10 s poll finds the proposal with `pending_entries: [GCOOP..., GNEWBUYER...]`.
3. UI shows "The current buyer wants to reassign this commitment to a new buyer." and **"Approve reassignment"** (`ReassignBuyerSection.tsx:154-161`).
4. Click it. `handleApprove` calls `signAuthEntry(coopEntryXdr, GCOOP...)`, then posts the signed entry to the method-agnostic sign route.

Expected Freighter popup fields: **Authorization Entry**, network **Test Net**, origin `http://localhost:5173`, signer `GCOOP...`, contract `C...`, function `reassign_buyer`, argument `GNEWBUYER...`, validity ~24 h. Again this must not be a full transaction signature.

Expected API result: the cooperative is removed from `pending_entries`, the proposal stays `pending` because `GNEWBUYER...` has not signed, and `ready_xdr` remains null. `justApproved` local state keeps the co-op's session showing "Approved — waiting for the other party to approve too." (`reassign.approvedWaitingOther`). Expected chain state: **unchanged** — `commitment.buyer` is still the outgoing buyer; no funds move at any point in this flow.

Observation checklist:

- [ ] Popup is an auth entry for `reassign_buyer` with the new-buyer argument, signer `GCOOP...`.
- [ ] Response `status` is still `"pending"` with only `GNEWBUYER...` in `pending_entries`.
- [ ] UI shows `reassign.approvedWaitingOther`, not a Finalize button, not an error.
- [ ] After the incoming buyer signs and the outgoing buyer finalizes, chain `buyer` becomes `GNEWBUYER...` and the UI detail reload reflects it.
- [ ] **Reload gap**: reload the co-op tab after approving. `justApproved` is component-local, so the section will disappear — confirm this is what happens and record it against the existing tracking issue.
- [ ] Reject path: error message appears in `.error-banner`. Note this banner currently has no `role="alert"` (`ReassignBuyerSection.tsx:130`), unlike `CancelSection.tsx:116`; tracked in issue #92.

## 7. Reconciliation matrix

| Issue | Wallet call | Popup type | Chain state immediately after | UI state after |
|---|---|---|---|---|
| #55 | none | none | unchanged; staging only | `cancel.proposed`, waiting |
| #56 | `signAuthEntry` | Authorization Entry | unchanged; proposal `ready` | `cancel.approvedWaiting`, no Finalize |
| #57 | `signTransactionXdr` | Transaction Signing | `Cancelled`, escrow remainder to buyer | badge `Cancelled`, section unmounted |
| #58 (co-op side) | `signAuthEntry` | Authorization Entry | unchanged; proposal still `pending` | `reassign.approvedWaitingOther` via `justApproved` |

## 8. Verification actually run for this write-up

```sh
cd coop-pwa && npm install
npm test          # 16 files, 127 tests passed
npx tsc -b --noEmit  # exit 0
npm run lint      # oxlint: exit 0, 7 pre-existing warnings
```

No on-chain transaction was submitted and no Freighter popup was observed in this environment, so the "expected" columns above are not presented as test results.

## 9. Known gaps found by inspection

- `justApproved` in `ReassignBuyerSection.tsx` is local component state; a page reload after approval loses the co-op's "waiting" state. Already documented in the component comment and in `coop-pwa/README.md`; also reported for the analogous dispute flow in the earlier QA runbook.
- `ReassignBuyerSection.tsx:130` error banner lacks `role="alert"`, unlike `CancelSection.tsx:116`. Tracked upstream in issue #92 ("Accessibility: color contrast & ARIA labeling — coop-pwa/ReassignBuyerSection.tsx").
