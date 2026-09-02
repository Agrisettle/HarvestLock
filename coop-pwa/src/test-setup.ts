import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react's automatic afterEach(cleanup) only registers
// itself when it detects vitest's *global* test APIs -- this project
// deliberately runs with `globals: false` (explicit imports everywhere,
// matching api/'s test style), so that auto-registration never fires.
// Without this, DOM from one test leaks into the next within a file —
// found via a real failure: "not yet opened" appearing 4 times instead
// of 2, and a duplicate-button error, both from a prior test's unmounted
// tree still sitting in the document.
afterEach(() => {
  cleanup();
});
