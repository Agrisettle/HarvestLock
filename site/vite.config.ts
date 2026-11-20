import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'


// Short commit SHA of the build, surfaced in the UI footer. Hosts that
// build from a tarball (Vercel) or detached checkout expose the full SHA
// via env; otherwise ask git. Absent entirely (no git, no env) => the UI
// simply omits the footer rather than showing a made-up value.
function buildSha(): string | undefined {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha()),
  },
  build: {
    // Multi-page static build (Vite's native support, no router dependency
    // needed for one extra page) -- roles.html is the disclosure page
    // linked from the footer and from buyer-app's create-commitment
    // consent checkbox.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        roles: resolve(import.meta.dirname, 'roles.html'),
      },
    },
  },
})
