import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react's automatic afterEach(cleanup) only registers
// itself when it detects vitest's *global* test APIs -- this project
// deliberately runs with `globals: false` (explicit imports everywhere,
// matching the other test suites), so that auto-registration never
// fires. Without this, DOM from one test leaks into the next within a
// file — see buyer-app/coop-pwa's identical setup for the failure this
// caused there before it was added.
afterEach(() => {
  cleanup();
});
