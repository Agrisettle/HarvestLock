import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base is only non-root in a combined deployment. Two of those exist:
// Vercel (see /vercel-build.sh and /vercel.json at the repo root), where
// this app's build output is served from /warehouse/ at the domain root,
// and the interim GitHub Pages preview (see /gh-pages-build.sh and
// /.github/workflows/gh-pages.yml), where the whole site sits one level
// deeper under the repo name (a GitHub Pages project site, not a
// user/org site) -- /HarvestLock/warehouse/, not /warehouse/. Vercel
// sets VERCEL=1 during builds; the Pages workflow sets GITHUB_PAGES=true
// the same way. Local `vite`/`vite build` runs have neither, so local
// dev and standalone builds stay at root.
export default defineConfig({
  plugins: [react()],
  base: process.env.VERCEL ? "/warehouse/" : process.env.GITHUB_PAGES ? "/HarvestLock/warehouse/" : "/",
});
