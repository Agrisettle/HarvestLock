## PR: Add StatusBadge snapshot test for coop-pwa (fixes #218)

**Summary**

Adds a unit test that renders the `StatusBadge` component once for every real contract `Status` value and asserts the visible label and `data-status` attribute in `coop-pwa`.

**Why**

- `StatusBadge` appears across every product surface; previously it only received incidental coverage via other components' fixtures. This exhaustive test prevents regressions when statuses are added/renamed or CSS mappings change.

**What changed**

- Updated `coop-pwa/src/components/StatusBadge.test.tsx` to render and assert each status label and `data-status`.

Files modified

- coop-pwa/src/components/StatusBadge.test.tsx

**Statuses covered**

- Draft
- Locked
- Advance1Released
- CheckpointPassed
- Advance2Released
- ReadyForDelivery
- Delivered
- Settled
- Cancelled
- Defaulted
- Forfeited
- Disputed

**How to run locally**

```bash
cd coop-pwa
npm install
npm test
```

**Notes & follow-ups**

- The authoritative enum is in the contracts repo at `HarvestLock-Contracts/contracts/escrow/src/lib.rs`; the test mirrors the statuses used in the app's `index.css` and project docs. If the contract changes, update this test and the CSS mapping.
- CI should run this test automatically when `coop-pwa` is part of the changeset; ensure `npm install` happens in CI before `npm test`.

**Checklist**

- [x] Add exhaustive `StatusBadge` test for `coop-pwa`
- [ ] Run tests locally and fix failures (if any)
- [ ] Confirm CI green on branch/PR

**Related**

- Issue: #218
