import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    // Same threads pool as buyer-app/vitest.config.ts (the default forks
    // pool hangs in some environments).
    pool: "threads",
  },
});
