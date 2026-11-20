# QA write-up — issue #55: propose a cancellation (`coop-pwa`)

> **Verification status:** code trace and automated checks completed; the real Freighter popup was **not** exercised in this environment (no browser extension/interactive session available). Nothing below is presented as an observed popup result. The checklist at the end is what a tester with a real install needs to confirm.

## What I did

- Traced `handlePropose` in `coop-pwa/src/components/CancelSection.tsx:76-83` through `proposeCancel` in `coop-pwa/src/api.ts:275` to `POST /commitments/:id/tx/cancel/propose` in `api/src/server.ts:920`, and cross-checked `api/docs/cancel-sequence.md`.
- Read the Freighter caveat in `coop-pwa/README.md` and the wallet boundary in `coop-pwa/src/wallet.ts`.
- Ran the real checks available here: `coop-pwa` 127/127 tests across 16 files, `tsc -b --noEmit` (exit 0), `npm run lint` (exit 0, 7 pre-existing warnings).

## What Freighter shows at each step

**Nothing.** This is the key finding of the trace: `handlePropose` makes no call into `wallet.ts`. The API simulates `cancel()` sourced from the proposer, stages the *other* party's `SorobanAuthorizationEntry` with `signatureExpirationLedger = latest + 17,280`, and returns a `pending` proposal. The proposer's own auth is `source_account` and is only satisfied at finalize (#57). A Freighter popup appearing here would itself be a bug.

| Step | Wallet call | Expected Freighter UI | Observed here |
|---|---|---|---|
| Connect | `requestAccess()` via `connectWallet()` | account picker / access request, Test Net | not exercised |
| Propose | none | no popup | code-verified only |
| Poll | none | no popup | code-verified only |

## Does the UI match the real chain state?

Expected, from the code: after propose the button disappears and `cancel.proposed` ("Cancellation proposed — waiting for the other party to approve.") renders via `CancelSection.tsx:124-126`. The on-chain commitment is **unchanged** — only `pending_multisig_proposals` in Postgres has a new row. So the UI is *correctly* showing staging state, not chain state; a tester should explicitly confirm the chain read still shows the old status, otherwise a stale cache could mask a problem.

The proposal is idempotent: proposing again returns the existing row, and an active proposal expires after 24 h.

## Rejection handling

Not applicable to this handler — there is no wallet call to reject. The API error path puts the message into `.error-banner` (`role="alert"`), which is covered by the component tests.

## Checklist for the real run

- [ ] No Freighter popup during propose.
- [ ] API response `pending`, `pending_entries: [other party]`, `ready_xdr: null`.
- [ ] UI shows `cancel.proposed`; chain `GET /commitments/:id` still shows the old status.
- [ ] Repeat propose returns the same proposal id (idempotency).
