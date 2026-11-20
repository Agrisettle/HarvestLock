# buyer-app dependency majors audit — 2026-10-17

## Scope and method

Issue #211: list every `buyer-app` dependency more than one major version
behind, with a one-line read on upgrade risk. Dependabot's groups cover
minor/patch only — by design, majors get a human look (see
`.github/dependabot.yml`).

Method: `npm ci` (so `npm outdated` compares installed versions rather
than just ranges), then `npm outdated --long` in `buyer-app/`, on
2026-10-17 against the public npm registry — Node 24.21.0 / npm 11.19.0.

## Findings

`npm outdated` listed six packages, all patch/minor. No dependency is
even one major version behind, let alone more than one:

| Package | Installed | Latest | Shift | Upgrade read |
| --- | --- | --- | --- | --- |
| `react` | 19.3.0 | 19.3.1 | patch | Dependabot's minor/patch group. |
| `react-dom` | 19.3.0 | 19.3.1 | patch | Dependabot's minor/patch group. |
| `@testing-library/user-event` | 14.6.7 | 14.6.8 | patch | Dependabot's minor/patch group. |
| `jsdom` | 30.1.2 | 30.1.3 | patch | Dependabot's minor/patch group. |
| `oxlint` | 1.87.0 | 1.88.0 | minor | Dependabot's minor/patch group. |
| `vitest` | 5.0.3 | 5.0.5 | patch | Dependabot's minor/patch group. |

Nothing here needs a human major-bump review or an upgrade outside
Dependabot's existing lane, so no dependency changed for this issue.

## How to reproduce

```bash
cd buyer-app
npm ci
npm outdated --long
```
