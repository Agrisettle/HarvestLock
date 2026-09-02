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
    // Found empirically, not a guess; if this stops being necessary on
    // a future Node/vitest version, confirm before removing it.
    pool: "threads",
  },
});
