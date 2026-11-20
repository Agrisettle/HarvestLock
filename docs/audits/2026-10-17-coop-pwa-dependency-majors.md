# coop-pwa dependency majors audit — 2026-10-17

## Scope and method

Issue #212: list every `coop-pwa` dependency more than one major version
behind, with a one-line read on upgrade risk. Dependabot's groups cover
minor/patch only — by design, majors get a human look (see
`.github/dependabot.yml`).

Method: `npm ci` (so `npm outdated` compares installed versions rather
than just ranges), then `npm outdated --long` in `coop-pwa/`, on
2026-10-17 against the public npm registry — Node 24.21.0 / npm 11.19.0.

## Findings

`npm outdated` listed eight packages. None was **more** than one major
version behind; exactly one was one major behind:

| Package | Installed | Latest | Shift | Upgrade read |
| --- | --- | --- | --- | --- |
| `vite-plugin-pwa` | 1.3.0 | 2.0.0 | 1 major | Safe. v2.0.0's only breaking change is widening the optional `@vite-pwa/assets-generator` peer to `^2.0.0`; this app doesn't use that package. Vite 8 and Node 24 remain in range. Bumped in this PR; typecheck, lint, all 66 tests, and the production build (PWA v2.0.0 service-worker generation) pass. |
| `react` | 19.3.0 | 19.3.1 | patch | Dependabot's minor/patch group. |
| `react-dom` | 19.3.0 | 19.3.1 | patch | Dependabot's minor/patch group. |
| `@testing-library/user-event` | 14.6.7 | 14.6.8 | patch | Dependabot's minor/patch group. |
| `fake-indexeddb` | 6.2.5 | 6.2.6 | patch | Dependabot's minor/patch group. |
| `jsdom` | 30.1.2 | 30.1.3 | patch | Dependabot's minor/patch group. |
| `oxlint` | 1.87.0 | 1.88.0 | minor | Dependabot's minor/patch group. |
| `vitest` | 5.0.3 | 5.0.5 | patch | Dependabot's minor/patch group. |

After this PR's bump, `vite-plugin-pwa` no longer appears in
`npm outdated`; the remaining seven are the same patch/minor drift
Dependabot already handles.

## How to reproduce

```bash
cd coop-pwa
npm ci
npm outdated --long
```
