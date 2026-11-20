import { defineConfig } from "@playwright/test";
import { API_URL, APP_ORIGINS, LIVE } from "./tests/helpers/env";

// Every test in this package drives a real browser against a real,
// locally-running API and real Stellar testnet -- it can't run in CI
// (no funded testnet key there, no local Postgres) and shouldn't run by
// accident on a laptop. E2E_LIVE=1 is the explicit opt-in; without it
// every spec skips with a pointer to README.md. global-setup.ts runs
// hard preflight checks (API health, CORS) once it is set.
//
// The three dev servers are on fixed ports; the API's CORS_ORIGINS must
// list all three -- checked before any test runs, since a missing origin
// otherwise fails deep inside an in-browser fetch with a famously
// unhelpful "Failed to fetch". `--strictPort` makes a port conflict a
// loud startup failure instead of Vite silently moving to 5174 and
// leaving every test pointed at the wrong app.
function devServer(name: keyof typeof APP_ORIGINS) {
  const port = new URL(APP_ORIGINS[name]).port;
  return {
    command: `npm run dev -- --port ${port} --strictPort`,
    cwd: `../${name}`,
    url: APP_ORIGINS[name],
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      ...(process.env as Record<string, string>),
      // Vite exposes VITE_*-prefixed env vars to the app, so each dev
      // server's api.ts talks to the same real API this test's direct
      // setup calls use.
      VITE_API_URL: API_URL,
    },
  };
}

export default defineConfig({
  testDir: "./tests",
  // The three apps each hit the same real API, the same Postgres, and
  // the same testnet -- parallel workers would only create cross-talk
  // (rate-limit budget, friendbot rate limiting) for zero wall-clock
  // win at this size.
  fullyParallel: false,
  workers: 1,
  // A commitment lifecycle walks several real testnet transactions,
  // each polled to confirmation -- the API's own live suite allows
  // 120-180s per scenario, so 300s here is generous, not hopeful.
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: { trace: "retain-on-failure" },
  webServer: LIVE
    ? [devServer("buyer-app"), devServer("coop-pwa"), devServer("warehouse-app")]
    : undefined,
  projects: [
    { name: "buyer-app", testMatch: /buyer-app\.spec\.ts/, use: { baseURL: APP_ORIGINS["buyer-app"] } },
    { name: "coop-pwa", testMatch: /coop-pwa\.spec\.ts/, use: { baseURL: APP_ORIGINS["coop-pwa"] } },
    { name: "warehouse-app", testMatch: /warehouse-app\.spec\.ts/, use: { baseURL: APP_ORIGINS["warehouse-app"] } },
  ],
});
