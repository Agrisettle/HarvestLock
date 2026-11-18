# site

The public face of HarvestLock — a single-page site, not a logged-in
product surface. Built with real content (live testnet contract address,
actual GitHub links, honest pre-validation status) rather than placeholder
copy standing in for a product that doesn't exist yet.

Design system: dark-first, `Fraunces` (display) + `Inter` (body) +
`IBM Plex Mono` (data/addresses), extending the Agrisettle brand palette
from [`BRANDING.md`](https://github.com/Agrisettle/.github/blob/main/BRANDING.md)
in the org profile repo.

### Color contrast

The site follows `prefers-color-scheme`: dark remains the default, and the
light palette is selected when the operating system requests light mode. Both
`index.html` and `roles.html` provide matching browser theme colors. Shared
tokens also cover the standalone roles page, navigation, badges, buttons,
focus rings, and severity labels.

Before this change, the page stayed dark under both system preferences, and
the immediate-severity red (`#c1432e`) on the dark page background
(`#0b120f`) measured **3.71:1**, below WCAG AA's 4.5:1 threshold for normal
text. The faint text color (`#8a897f`) measured 5.39:1 on that background.
After the change, the red is lightened in dark mode, a separate darker red is
used in light mode, and all text/accent token pairs checked by the contrast
script exceed 4.5:1. Representative minimum pairs are:

| System preference | Text / background | Contrast |
| --- | --- | ---: |
| Dark | faint text `#8a897f` / page `#0b120f` | 5.39:1 |
| Dark | severity `#f07a63` / page `#0b120f` | 6.92:1 |
| Light | faint text `#59645d` / page `#f7f6f0` | 5.69:1 |
| Light | severity `#a82f1f` / page `#f7f6f0` | 6.27:1 |
| Dark | pine text `#6fbf9d` / badge `#163f30` | 5.38:1 |
| Light | pine text `#1e6b4e` / badge `#e2eee7` | 5.39:1 |

Run `npm run check:contrast` from this directory to recalculate the key
foreground/background token pairs in both palettes. It is a palette check;
it does not inspect rendered pixels or replace a browser-based page audit.

## Running it

Requires Node `^20.19.0 || >=22.12.0` — every dev dependency's own
engines floor (vite 8, oxlint). Verified in a clean checkout under Node
20.19: dev, build, preview, typecheck, lint, and `npm run check:contrast`
all pass there. CI runs Node 24 (`.github/workflows/site.yml`).

```bash
npm ci
cp .env.example .env   # optional — only for the Status section's live badge
npm run dev       # http://localhost:5173
npm run build     # production build to dist/ (typechecks: tsc -b && vite build)
npm run preview   # serve the production build locally
npm test          # Vitest + jsdom (src/**/*.test.ts); CI runs it too
```

`.env` really is optional — `VITE_API_URL` is its only knob, and
`src/hooks/useLiveStatus.ts` is deliberately silent when it's unset: the
Status section's live badge just never renders, with no error and no
stuck spinner. That silence becomes a trap once you *do* set it:
pointing it at a local `api/` looks exactly like leaving it unset when
the read is failing, because the usual cause is CORS — the API sends no
CORS headers to any origin until `CORS_ORIGINS` includes
`http://localhost:5173`, and `curl http://localhost:3000/commitments/...`
will happily return 200 while the browser blocks the fetch. See
[`../api/README.md`](../api/README.md)'s Setup and CORS sections.

Before pushing, the checks CI runs (`.github/workflows/site.yml`):
`npx tsc -b --noEmit`, `npm run lint`, `npm run build`.

Static hosts receive `public/404.html` in the built `dist/` directory. It
replaces the generic host/Vite not-found response with a branded explanation
and links back to the site and repository.

## Notes for whoever touches this next

- The page metadata describes HarvestLock as a **testnet prototype**. The
  reference contract is live on Stellar testnet, but there is no production
  pilot or mainnet deployment yet. Both pages use the shared branded OG image;
  its “Stellar testnet — live” label reflects that status, and its alt text
  describes the prototype rather than implying a live production service.
  The roles page describes proposed responsibilities and suggested processes,
  not binding product policy.

- Scroll-reveal (`src/hooks/useInView.ts`) uses `IntersectionObserver`.
  **If you're testing scroll behavior with a headless browser, use real
  wheel events** (`page.mouse.wheel()` in Playwright), not
  `window.scrollTo()` in a loop — this project sets `scroll-behavior:
  smooth` globally, which turns programmatic `scrollTo` calls into
  animated, interruptible scrolls. Rapidly issuing many of them in a tight
  loop fights its own animation and produces flaky, misleading results
  that look like a reveal bug but aren't. Confirmed clean (23/23 reveal
  elements, 3/3 runs) against a real production build using genuine wheel
  input before this was shipped.
- All content is grounded in what's actually true about the project as of
  this writing (test counts, the deployed testnet contract address, repo
  links). If any of that changes — new test count, new contract address,
  status moves past pre-validation — update this site in the same PR as
  the change it's describing, not as an afterthought.
