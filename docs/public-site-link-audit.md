# Public site link audit

Audit date: 2026-10-17

## Before

There was no recorded audit of the public preview's internal links after the documentation restructuring.

## After

The live preview at <https://agrisettle.github.io/HarvestLock/> returned HTTP 200. Its rendered page had 14 unique fragment targets; every fragment matched an element ID. The three dashboard links also returned HTTP 200:

| Internal route | Result |
| --- | --- |
| `/HarvestLock/buyer/` | 200 |
| `/HarvestLock/coop/` | 200 |
| `/HarvestLock/warehouse/` | 200 |

The separate `site/` Vite app was checked at source level because the repository's GitHub Pages preview builds from `landing/` and the three dashboard apps, not from `site/`. Its in-page links target IDs rendered by `App.tsx` and its page components; `/roles.html` is included in the Vite build inputs, and its back link targets the existing `index.html` route.

The repository and documentation links used by the public site were also checked: the Agrisettle organization, HarvestLock repository and issues page, `docs/PRD.md`, `LICENSE`, the contract repository, the branding document, the testnet contract explorer page, and Freighter all returned HTTP 200. No broken links were found, so no existing site links needed changing.
