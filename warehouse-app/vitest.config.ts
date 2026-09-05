import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    // Default forks pool hangs on this machine ("Timeout waiting for
    // worker to respond", every run) -- threads pool works reliably.
    // Same fix as buyer-app/coop-pwa; found empirically there, not a guess.
    pool: "threads",
  },
});
