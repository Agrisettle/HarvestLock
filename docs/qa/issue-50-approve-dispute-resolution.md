# Manual Freighter QA: approve a dispute resolution as cooperative or warehouse operator (buyer-app) — issue #50

## Scope and environment

- Flow: `buyer-app/src/components/DisputeSection.tsx` `handleApprove` → `freighterApi.signAuthEntry` → `POST /commitments/:id/tx/propose/:proposalId/sign`.
- The issue's "build → sign → submit" wording is imprecise for approval: only a **Soroban authorization entry** is signed and recorded off-chain. No envelope is built or submitted, and the chain must still report `status: "Disputed"` after one approval. That expectation is encoded in the new tests.
- No real Freighter extension is available in this workspace, so the popup itself was **not observed**. The dialog description below is the expected shape from the SDK/Freighter API.

## What was actually done

1. Traced the active-proposal fetch, 10 s poll, role gating for all three parties, and the cooperative/warehouse approval path (`buyer-app/src/components/DisputeSection.tsx:23-25, 75-95, 130-167`).
2. Added coverage for exactly the roles named in this issue:
   - `buyer-app/src/components/DisputeSection.test.tsx`: parameterized cooperative and warehouse-operator approvals, including the signed entry and signer address POSTed to the API; declined-signature error banner with the proposal untouched and no POST.
   - `e2e/tests/buyer-app.spec.ts`: new live browser/API/testnet flow where the buyer proposes, the cooperative rejects once then approves, and the warehouse operator approves — with the proposal checked after each step.
3. Fixed a poll/signature race found during review: a 10 s GET started before the signature POST could overwrite the updated proposal and re-offer an already-signed entry (duplicate-signature 400). Reads are now sequenced (`buyer-app/src/components/DisputeSection.tsx:73-101, 138-161`).
4. Improved the 60 s popup timeout message and cleared the timer on settlement (`buyer-app/src/wallet.ts:34-101`).
5. Ran `buyer-app` `npm test` (179 passed), lint, typecheck, build, bundle-size check. All pass.

## Expected Freighter dialog (to confirm by hand)

- Authorization-entry (not transaction) popup, testnet badge, origin `buyer-app`, signer = cooperative/warehouse account, `resolve_dispute` auth entry valid for ~17,280 ledgers; no network fee because nothing is broadcast.
- Reject: `role="alert"` banner, button re-enabled, `pending_entries` unchanged.

## Known limitation (not introduced here)

`justApproved` is session-local: after a page reload the API no longer lists the approver, so the "Approved — waiting…" message disappears. Documented in the component and in `docs/qa/issue-67-approve-dispute-resolution.md`. Fixing it requires an API shape change (a signed-by list) and is out of scope for this QA issue.

## Remaining manual step

With real Freighter, connect the cooperative and warehouse accounts in turn to `buyer-app`, approve a pending `resolve_dispute` proposal, record the popup's actual dialog/latency, and confirm `GET /commitments/:id` still reports `Disputed` while the proposal's `pending_entries` shrinks. Real-extension verification remains open.
