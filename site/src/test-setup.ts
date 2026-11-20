import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// globals are off, so RTL's automatic cleanup never registers itself.
afterEach(() => {
  cleanup();
});
