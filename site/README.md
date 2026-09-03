# site

The public face of HarvestLock — a single-page site, not a logged-in
product surface. Built with real content (live testnet contract address,
actual GitHub links, honest pre-validation status) rather than placeholder
copy standing in for a product that doesn't exist yet.

Design system: dark-first, `Fraunces` (display) + `Inter` (body) +
`IBM Plex Mono` (data/addresses), extending the Agrisettle brand palette
from [`BRANDING.md`](https://github.com/Agrisettle/.github/blob/main/BRANDING.md)
in the org profile repo.

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

## Notes for whoever touches this next

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
