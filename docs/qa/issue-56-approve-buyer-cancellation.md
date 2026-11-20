# QA write-up — issue #56: approve a cancellation proposed by the buyer (`coop-pwa`)

> **Verification status:** code trace and automated checks completed; the real Freighter extension and popup were **not** exercised in this environment. Expected popup fields below are derived from the exact arguments passed in `wallet.ts`/`CancelSection.tsx`, not from an observation. See the runbook for the full tester checklist.

## What I did

- Traced `handleApprove` in `coop-pwa/src/components/CancelSection.tsx:85-95`: it finds the connected wallet's own entry in `proposal.pending_entries`, calls `signAuthEntry(myEntry.entry_xdr, walletAddress)`, then posts the signed entry to `POST /commitments/:id/tx/propose/:proposalId/sign`.
- Verified the API side in `api/src/server.ts:1071` and `api/docs/cancel-sequence.md:55-71`: locked read-modify-write, wrong signer/double sign rejected with 400, then the transaction is rebuilt without re-simulation and the row flips to `ready`.
- Ran `coop-pwa` tests (127/127), typecheck (exit 0), lint (exit 0, 7 pre-existing warnings).

## What Freighter shows at each step

| Step | Wallet call | Expected Freighter UI | Observed here |
|---|---|---|---|
| Open commitment as co-op | none (10 s poll) | no popup | code-verified only |
| Click "Approve cancellation" | `signAuthEntry(entryXdr, { address, networkPassphrase })` | **Authorization Entry** dialog, network **Test Net**, origin `http://localhost:5173`, signer `GCOOP...`, contract `C...`, function `cancel`, no arguments, validity ~17,280 ledgers (~24 h), no fee on the entry | not exercised |
| Approve | none | popup closes; request resolves with `signedAuthEntry` | not exercised |
| Reject | none | Freighter error → `throwIfError` → `.error-banner` | covered by mocked component test only |

The critical thing to observe is that this is **not** a transaction-signing dialog. `signTransaction` here would add a classic envelope signature and the finalized transaction would fail with `tx_bad_auth_extra` (`HANDOFF.md:42`). The 60 s timeout in `signAuthEntry` exists to give a human time to read this popup.

## Does the UI match the real chain state?

Expected: after a successful sign the API returns `status: "ready"` with `ready_xdr`, and because the connected wallet is the approver (not the proposer), `CancelSection.tsx:143-145` renders `cancel.approvedWaiting` — "Approved — waiting for the proposer to finalize." — with **no** Finalize button. The on-chain status is **still unchanged** at this point; nothing has been submitted. That mismatch is intentional and correct: the UI is showing staged multi-party progress, not chain state. The tester should confirm both facts explicitly.

## Rejection handling

The mocked-wallet component test asserts the banner text and that no state corrupts. Real-popup rejection still needs confirming: reject should show the message in `.error-banner` (`role="alert"` at `CancelSection.tsx:116`), re-enable the button, and leave the proposal `pending`.

## Checklist for the real run

- [ ] Popup type is Authorization Entry, not transaction signing.
- [ ] Network Test Net, origin `localhost:5173`, signer `GCOOP...`, function `cancel`, ~24 h validity.
- [ ] Response `ready` with non-null `ready_xdr`; chain status unchanged before finalize.
- [ ] UI shows `cancel.approvedWaiting`, no Finalize button.
- [ ] Rejection surfaces the Freighter message and leaves the proposal `pending`.
