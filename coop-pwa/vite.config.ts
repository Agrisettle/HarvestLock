import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// base is only non-root in a combined deployment. Two of those exist:
// Vercel (see /vercel-build.sh and /vercel.json at the repo root), where
// this app's build output is served from /coop/ at the domain root, and
// the interim GitHub Pages preview (see /gh-pages-build.sh and
// /.github/workflows/gh-pages.yml), where the whole site sits one level
// deeper under the repo name (a GitHub Pages project site, not a
// user/org site) -- /HarvestLock/coop/, not /coop/. Vercel sets
// VERCEL=1 during builds; the Pages workflow sets GITHUB_PAGES=true the
// same way. Local `vite`/`vite build` runs have neither, so local dev
// and standalone builds stay at root.
const base = process.env.VERCEL ? "/coop/" : process.env.GITHUB_PAGES ? "/HarvestLock/coop/" : "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    // PRD §7/§16.3's "connectivity loss at depot" edge case, finally
    // built -- see src/offlineQueue.ts for the actual queueing logic.
    // This plugin only covers the other half: making the app shell
    // itself loadable with no network at all (precached via a generated
    // service worker), which the offline queue would be pointless
    // without -- there's no point queuing a claim if the page that lets
    // you view/retry it can't even open offline.
    VitePWA({
      registerType: "autoUpdate",
      // scope/start_url derived from `base` automatically -- don't
      // hardcode "/" here, this app is served from /coop/ in the
      // combined Vercel deployment.
      manifest: {
        name: "HarvestLock — Cooperative Dashboard",
        short_name: "HarvestLock Coop",
        description: "Track commitments, claim advance tranches, propose cancellations or reassignments.",
        theme_color: "#0b120f",
        background_color: "#0b120f",
        display: "standalone",
        icons: [{ src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }],
      },
      workbox: {
        // Precache the built app shell only -- API calls are never
        // cached (this dashboard shows live chain/DB state; a stale
        // cached commitment status would be actively misleading, worse
        // than an honest "you're offline" failure).
        globPatterns: ["**/*.{js,css,html,png,svg}"],
      },
    }),
  ],
});
