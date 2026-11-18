import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// globals are off, so RTL's automatic cleanup never registers itself.
afterEach(() => {
  cleanup();
});
