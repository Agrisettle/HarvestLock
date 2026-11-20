# Dependency version audit — warehouse-app and site

**Date:** 2026-10-17
**Scope:** `warehouse-app/` and `site/` (the two frontends not yet covered by a PWA; `api/`, `buyer-app/`, and `coop-pwa/` have their own Dependabot entries in `.github/dependabot.yml`).
**Method:** `npm outdated` run against a fresh `npm install` in each directory, comparing `Current` vs `Latest`.

## Rule applied

Flag any dependency **more than one major version behind** (e.g. current major 5, latest major 7+). Minor/patch drift is deliberately not flagged here: `.github/dependabot.yml` already groups and auto-creates PRs for minor/patch bumps in every frontend. Major bumps need a human look at what actually changed — this audit is that look.

## warehouse-app

`npm outdated` output:

| Package | Current | Latest | Gap |
|---|---|---|---|
| react | 19.3.0 | 19.3.1 | patch |
| react-dom | 19.3.0 | 19.3.1 | patch |
| vitest | 5.0.3 | 5.0.5 | patch |
| jsdom | 30.1.2 | 30.1.3 | patch |
| @testing-library/user-event | 14.6.7 | 14.6.8 | patch |
| oxlint | 1.87.0 | 1.88.0 | minor |

**Nothing is more than one major version behind.** Every outdated package is on its current major line, so Dependabot's `minor-and-patch` group already covers all of them.

Upgrade risk: low. All six are patch/minor bumps on the same major — safe to let Dependabot handle. No manual upgrade PR warranted from this audit.

## site

`npm outdated` output:

| Package | Current | Latest | Gap |
|---|---|---|---|
| react | 19.3.0 | 19.3.1 | patch |
| react-dom | 19.3.0 | 19.3.1 | patch |
| vite | 8.3.2 | 8.3.4 | patch |
| @vitejs/plugin-react | 6.1.1 | 6.1.2 | patch |
| oxlint | 1.86.0 | 1.88.0 | minor |
| typescript | 6.0.3 | 7.0.2 | exactly one major |

**Nothing is more than one major version behind.** Five of six are patch/minor on the current major — Dependabot covers them, low risk, safe to upgrade automatically.

**Watch item — TypeScript 6 → 7:** `typescript` is exactly one major behind (6.0.3 → 7.0.2), which does not clear the "more than one major" threshold, but it is the only cross-major drift in this audit. TypeScript 7 is a real major with potential breaking changes; when the team is ready, upgrade it deliberately with the TS 7 changelog reviewed, not via Dependabot's minor/patch group.

## Conclusion

No dependency in `warehouse-app/` or `site/` is more than one major version behind, so there are no forced major bumps to review right now, and no version-bump PR attached to this audit. Re-run `npm outdated` in both directories whenever Dependabot's major-bump policy is revisited.

Related: #213 (warehouse-app), #214 (site).