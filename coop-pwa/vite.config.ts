import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base is only non-root in the combined Vercel deployment (see
// /vercel-build.sh and /vercel.json at the repo root), where this app's
// build output is served from /coop/ alongside buyer-app's at /buyer/.
// Vercel sets VERCEL=1 during builds; local `vite`/`vite build` runs
// don't have it, so local dev and standalone builds stay at root.
export default defineConfig({
  plugins: [react()],
  base: process.env.VERCEL ? "/coop/" : "/",
});
