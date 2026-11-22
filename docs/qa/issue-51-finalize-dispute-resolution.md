# Manual Freighter QA: finalize a ready dispute resolution (buyer-app) — issue #51

## Scope and environment

- Flow: `buyer-app/src/components/DisputeSection.tsx` `handleFinalize` → `POST .../refresh-ready` → `freighterApi.signTransaction` → `POST /transactions/submit` → live `GET /commitments/:id`.
- No real Freighter extension, funded deployer, or contract WASM is available here, so the popup and live chain drive were **not executed**. Popup details below are expected, not observed.

## What was actually done

1. Traced the refresh-ready rebuild (fresh sequence/time bound after issue #443), envelope signing, submit with `completeProposalId`, and parent chain refresh at `buyer-app/src/components/DisputeSection.tsx:169-187` and `buyer-app/src/api.ts:158-280`.
2. Added tests:
   - `buyer-app/src/components/DisputeSection.test.tsx`: finalize happy path, declined-signature rejection (no submit), and `202 PENDING` submit followed to SUCCESS before `onDisputeChanged`.
   - `buyer-app/src/api.test.ts`: transaction-hash polling and bounded give-up.
   - `e2e/tests/buyer-app.spec.ts`: new live flow that proposes, gets both approvals, finalizes through the UI, and checks the on-chain status returns to `Locked` with `dispute_pre_status: "Draft"`.
3. Fixed two defects that would show up as "UI doesn't match chain":
   - PENDING submit was treated as final; the UI cleared the proposal and re-read state before confirmation, and the API's deferred `completeProposalId` side effect was never triggered by this client. It now polls `/transactions/:hash` (`buyer-app/src/api.ts:158-204`).
   - `setProposal(null)` ran *before* the parent's chain read, flashing "Propose resolving this dispute" for a dispute that had just been resolved. The ready action is kept until the parent reports the new status (`buyer-app/src/components/DisputeSection.tsx:178-186`).
   - As in the other apps, the API's 5 s read cache is now invalidated on a confirmed write (`api/src/server.ts:155-170`).
4. Ran `buyer-app` `npm test` (179 passed), lint, typecheck, build, bundle-size check. All pass.

## Expected Freighter dialog (to confirm by hand)

- Transaction-signing popup for the proposer on testnet with `resolve_dispute()` and all three auth credentials assembled; approve yields the signed envelope, reject shows the inline error banner and leaves the proposal `ready` for another attempt.

## Remaining manual step

With real Freighter installed, connect the proposer to `buyer-app`, finalize an approved (`ready`) proposal, record the dialog facts and click→popup latency, and compare the UI badge with `GET /commitments/:id` plus `GET /transactions/:hash`. Real-extension verification remains open.
