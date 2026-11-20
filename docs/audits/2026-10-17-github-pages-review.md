# GitHub Pages audit attempt — 2026-10-17

## Scope and method

Target: <https://agrisettle.github.io/HarvestLock/> (the deployed GitHub Pages
preview assembled by `gh-pages-build.sh`, not the separate `site/` app).

The page returned HTTP 200. Its HTML response was 36,259 bytes and included
`Cache-Control: max-age=600`. I inspected the deployed HTML and the repository's
deployment notes for external requests, metadata, and unavailable product
flows. The URL is reachable, but a Lighthouse score could not be collected:
the PageSpeed Insights API returned HTTP 429 for exhausted quota, and this
environment has no local Lighthouse CLI or browser executable. Therefore the
items below are prioritized manual follow-ups, not measured Lighthouse
diagnostics; no performance, accessibility, or SEO scores are claimed.

## Prioritized findings

1. **The preview links into product flows whose writes cannot work on Pages.**
   GitHub Pages serves only static files; the API is not deployed there. The
   repository deployment notes confirm that lock, settle, cancel, and related
   writes fail against the unavailable API. Before using this preview with
   reviewers or pilot partners, show a clear preview limitation at the entry
   point or deploy the API and point the apps at it. This is a known journey
   limitation, not a Lighthouse measurement.
2. **The deployed landing page has no social preview metadata.** Its title and
   description exist, but it has no Open Graph or Twitter card tags. Add a
   representative image and explicit share title/description once the landing
   page's canonical URL and artwork are settled, so shared links do not rely on
   crawler-specific fallbacks.
3. **Initial font rendering depends on Google Fonts.** The page requests
   Fraunces, Inter, and IBM Plex Mono from Google's CSS endpoint. It already
   uses preconnect and `display=swap`, which are useful mitigations; consider
   self-hosting or reducing the font families if a real mobile Lighthouse
   waterfall confirms font latency or layout shifts.

## Before / after

No product code or hosting configuration changed in this audit. Before, there
was no recorded review of the currently deployed preview. After, the target,
HTTP observations, tooling limitation, and three prioritized follow-ups are
documented here. Run Lighthouse again when PageSpeed quota or a local browser
is available, then replace these manual observations with measured findings.
