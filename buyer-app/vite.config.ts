import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// base is only non-root in a combined deployment. Two of those exist:
// Vercel (see /vercel-build.sh and /vercel.json at the repo root), where
// this app's build output is served from /buyer/ at the domain root, and
// the interim GitHub Pages preview (see /gh-pages-build.sh and
// /.github/workflows/gh-pages.yml), where the whole site sits one level
// deeper under the repo name (a GitHub Pages project site, not a
// user/org site) -- /HarvestLock/buyer/, not /buyer/. Vercel sets
// VERCEL=1 during builds; the Pages workflow sets GITHUB_PAGES=true the
// same way. Local `vite`/`vite build` runs have neither, so local dev
// and standalone builds stay at root.
// Short commit SHA of the build, surfaced in the UI footer. Hosts that
// build from a tarball (Vercel) or detached checkout expose the full SHA
// via env; otherwise ask git. Absent entirely (no git, no env) => the UI
// simply omits the footer rather than showing a made-up value.
function buildSha(): string | undefined {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig({
  plugins: [
    react(),
    // Issue #216: install-to-home-screen + offline-tolerant shell, same
    // treatment as coop-pwa. Precaches the built app shell only -- API
    // calls are never cached (live chain/DB state; a stale cache would be
    // actively misleading). Scope/start_url derive from `base`
    // automatically, don't hardcode "/".
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "HarvestLock — Buyer",
        short_name: "HarvestLock Buyer",
        description: "Create and manage crop-commitment escrows as a buyer: lock delivery payments, raise disputes, reassign positions.",
        theme_color: "#0b120f",
        background_color: "#0b120f",
        display: "standalone",
        icons: [{ src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        // The app shell chunks stay well under 2 MiB in production builds,
        // but storybook's build reuses this vite config and its manager
        // bundle (sb-manager/globals-runtime.js, ~3.3 MiB) exceeds the
        // default 2 MiB precache ceiling -- raise the limit so
        // `build-storybook` doesn't fail. No real-app asset approaches it.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  define: {
    "import.meta.env.VITE_BUILD_SHA": JSON.stringify(buildSha()),
  },
  base: process.env.VERCEL ? "/buyer/" : process.env.GITHUB_PAGES ? "/HarvestLock/buyer/" : "/",
});
