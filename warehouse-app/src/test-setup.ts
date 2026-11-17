import "@testing-library/jest-dom/vitest";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import axe from "axe-core";

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

/**
 * Runs axe accessibility assertions against the given container.
 *
 * Disables the `color-contrast` rule under jsdom, which can't compute it;
 * contrast stays a manual and Lighthouse check (#145, #152).
 */
export async function expectNoA11yViolations(
  container: Element,
  options?: axe.RunOptions,
): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      // jsdom cannot compute element geometry or real color contrast;
      // color-contrast rule must remain disabled here. Contrast stays
      // a manual and Lighthouse check (#145, #152).
      "color-contrast": { enabled: false },
      ...options?.rules,
    },
    ...options,
  });

  if (results.violations.length > 0) {
    const violationSummary = results.violations
      .map((v) => {
        const targets = v.nodes
          .map((node) => `  - ${node.target.join(", ")}: ${node.html}`)
          .join("\n");
        return `[${v.id}] ${v.help} (${v.helpUrl})\n${targets}`;
      })
      .join("\n\n");
    expect.fail(`Expected no accessibility violations but found ${results.violations.length}:\n${violationSummary}`);
  }
}
