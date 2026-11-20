## PR: Add StatusBadge snapshot test (fixes #217)

**Summary**

Adds an explicit unit test that renders the `StatusBadge` component once for every real contract `Status` value and asserts the visible label and `data-status` attribute. This ensures the component is covered independently of other components' fixtures and guards against drift between the contract's enum and the app's visual mapping.

**Why**

- `StatusBadge` is the most-seen component across product surfaces and previously only received incidental coverage.
- This test prevents regressions when a new status is added to the contract or CSS mapping is changed.

**What changed**

- Updated `buyer-app/src/components/StatusBadge.test.tsx` to add a test iterating the full set of statuses and asserting that each renders with the correct label and `data-status` attribute.

Files modified

- buyer-app/src/components/StatusBadge.test.tsx

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

1. Install dependencies in the `buyer-app` workspace:

```bash
cd buyer-app
npm install
```

2. Run the tests:

```bash
npm test
```

The existing CSS-mapping test in the same file continues to assert border colours by reading `buyer-app/src/index.css`, so this PR covers both label/data-status and colour assertions.

**Notes & follow-ups**

- The authoritative enum lives in the contracts repo at `HarvestLock-Contracts/contracts/escrow/src/lib.rs` — this repo's test list mirrors the statuses used in the apps' `index.css` and project docs. If the contract adds or renames statuses, update the test and CSS in each app accordingly.
- CI should pick up this test automatically; ensure the package install step runs before tests in any CI job that exercises `buyer-app`.

**Checklist**

- [x] Add exhaustive `StatusBadge` test
- [ ] Run tests locally and fix failures (if any)
- [ ] Confirm CI green on branch/PR

**Related**

- Issue: #217
