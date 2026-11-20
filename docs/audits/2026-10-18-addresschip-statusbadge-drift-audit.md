# AddressChip / StatusBadge drift audit across the three apps

**Date:** 2026-10-18
**Issues:** #187 (AddressChip), #188 (StatusBadge)
**Scope:** the three deliberately duplicated copies of `AddressChip.tsx` and `StatusBadge.tsx` (and the CSS their behavior depends on) in `buyer-app`, `coop-pwa` and `warehouse-app`. Behavioral drift, not formatting drift.
**Method:** checksum comparison of the `.tsx` files, side-by-side reading of the CSS blocks each component depends on, a parser-free comparison of the status → colour selectors in each app's `index.css`, and a check of existing test coverage per app. The follow-up tests added by this audit were run in all three apps (`npm test`).

## Why the duplication exists (and why this audit is the cost of it)

These components are duplicated per app on purpose — this project's documented convention, same as `wallet.ts`/`api.ts` (see `TASKS.md`'s warehouse-app entry and the #189–#192 audit that preceded this one). No shared package. The accepted risk is silent divergence; this audit is the periodic check that the risk hasn't turned into a bug.

## AddressChip — no drift found

- `buyer-app/src/components/AddressChip.tsx`, `coop-pwa/src/components/AddressChip.tsx`, `warehouse-app/src/components/AddressChip.tsx` are **byte-identical** (md5 `6dcf4886cf7f1f16e83e8d8a036336a3` for all three). Same truncation (`{address.slice(0, 4)}…{address.slice(-4)}`), same full-value `title`, same copy handler (`e.stopPropagation()`, `navigator.clipboard?.writeText`, 1.5 s "Copied" flip, swallowed rejection when clipboard access is denied), same `copyable` default and nested-button caveat.
- The CSS the behavior depends on is also identical in all three `index.css` files: `.address-chip` (inline-flex, mono, `--bone-dim`), `.address-chip-text { white-space: nowrap; }`, `.address-chip-copy` and its `:hover`, plus the same `max-width` media rule (`min-height: 24px; display: inline-flex; align-items: center;` for the WCAG 2.5.8 touch target). The full-value `title` and `nowrap` truncation don't depend on any app-specific token.
- One non-behavioral difference: `buyer-app` carries an `AddressChip.stories.tsx` because Storybook exists only in that app. A catalog entry is not runtime behavior; no action.
- **Gap found:** no app had any test for the component, so "it matches today" was unpinned. Closed by adding an identical `AddressChip.test.tsx` to all three apps covering: truncation to first-four/last-four with the full address kept in `title`; copy writes the **full** address and flips the label back after the timeout; `copyable={false}` hides the button; copy clicks stop propagation (so a clickable row isn't triggered) while chip clicks still bubble; and a denied clipboard does not flip the label. The test file, like the component, is duplicated verbatim.

## StatusBadge — real drift found and reconciled

- The three `StatusBadge.tsx` files are **byte-identical** (md5 `edde1935dea949d8dbe4169e22f3efb3`): `data-status={status}` and the raw status as the label. Label behavior matches everywhere.
- The per-app tests were behaviorally equivalent (same two assertions; only the literal status fixtures differ).
- **But the status → colour mapping lives in `index.css`, and two of the three copies had drifted.** `warehouse-app` maps `ReadyForDelivery` into the gold "in progress" group and `Forfeited` into the signal/red "terminal bad" group. `buyer-app` and `coop-pwa` were missing both selectors, so **`ReadyForDelivery` and `Forfeited` rendered as the neutral default badge in those two apps** while rendering correctly in `warehouse-app`. The base `.badge` rule and the other groups (`Locked`/`Advance1Released`/`CheckpointPassed`/`Advance2Released` gold, `Settled`/`Delivered` green, `Cancelled`/`Defaulted`/`Disputed` red) were identical everywhere.
- **Which version is correct: `warehouse-app`'s.** It is the only copy whose mapping covers the contract's full status set. `ReadyForDelivery` is a real state that the buyer/coop UIs themselves display and gate actions on (`CancelSection.tsx`/`ReassignBuyerSection.tsx`/`DisputeSection.tsx` all list it in their reachable-state sets; `warehouse-app`'s delivery flow starts there), and `Forfeited` is a real terminal status the API's reputation machinery records. `buyer-app`/`coop-pwa` simply never gained the two selectors when those statuses arrived in later contract deployments. The drift was in the two older copies, not the newest one — so `warehouse-app` was left unchanged and the two selectors were added to `buyer-app` and `coop-pwa`, making all three mapping blocks byte-identical again.
- **Regression guard added:** each app's `StatusBadge.test.tsx` now reads its own `index.css` and asserts the exact full mapping (11 non-neutral statuses; `Draft` intentionally falls back to the neutral default). A status added to the contract without a colour decision, or one copy losing/changing a group, now fails that app's test instead of silently rendering grey.
- Non-drift observation, not changed: `buyer-app`'s Storybook `StatusBadge.stories.tsx` selects from a status list that omits `Forfeited`. That is catalog completeness, not runtime behavior; noted here so the next person doesn't mistake it for the same class of bug.

## Verdict

- #187: **matches.** No behavioral drift; coverage added to pin it.
- #188: **drifted, now reconciled.** The `warehouse-app` mapping was correct; `buyer-app` and `coop-pwa` were corrected, and all three are pinned by an identical regression test.

Related: #189–#192 (`wallet.ts`/`api.ts` copy audit, commit `9c6a041`) — same methodology, same duplicated-test shape.
