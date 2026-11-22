# Manual Freighter QA: claim advance tranche 2 (coop-pwa) — issue #53

## Scope and environment

- Flow: `coop-pwa/src/App.tsx` `handleClaim(2)` → `CommitmentDetail.tsx` tranche-2 button.
- This environment has no installed Freighter extension and no configured testnet deployer/WASM hash, so the real popup and live chain drive were **not performed**. The dialog description below is derived from the code and the Freighter API shape, not observed.

## What was actually done

1. Confirmed the two tranches share build → sign → submit → refresh logic but are separate buttons and method names (`claim_advance_1` vs `claim_advance_2`) at `coop-pwa/src/components/CommitmentDetail.tsx:177-214` and `coop-pwa/src/App.tsx:146-213`.
2. Closed the specific coverage gap this issue names: tranche 2 had no component test and no live E2E test.
   - `coop-pwa/src/App.test.tsx`: tranche 2 builds `claim_advance_2`, signs the returned XDR, submits, and re-reads state showing the tranche as claimed.
   - `e2e/tests/coop-pwa.spec.ts`: new live test locks, releases/claims tranche 1, marks a checkpoint, releases tranche 2, then clicks the actual tranche-2 Claim button and compares UI text with `getCommitment(contractId).advance2_claimed`.
3. Applied the same correctness fixes as issue #52: 202 PENDING polling, no offline-queue misclassification after a confirmed submit, stale-selection guard, API read-cache invalidation after writes, and signing-specific timeout copy.
4. Ran `npm test` (147 passed), lint, typecheck, build, bundle-size check in `coop-pwa`. All pass.

## Expected Freighter dialog (to confirm by hand)

- Transaction-signing popup for the cooperative account on testnet, invoking `claim_advance_2()`; approve returns a signed envelope, reject returns Freighter's declined error and shows the inline banner with the button re-enabled.

## Remaining manual step

Requires a Locked commitment with tranche 1 claimed, a checkpoint marked, and `release_advance_2` submitted. With real Freighter installed, connect the cooperative account, click Claim on the second tranche, and compare the refreshed UI with `GET /commitments/:id` (`advance2_claimed`, `advance2_expired`) and the transaction status. Record the actual popup contents and timing in a follow-up comment. Real-extension verification remains open.
