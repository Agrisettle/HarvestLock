import axe from "axe-core";
import { expect } from "vitest";

/**
 * Asserts that `container` has no axe-core accessibility violations.
 *
 * `color-contrast` is disabled: jsdom does no layout or paint, so axe
 * can't compute it. Contrast stays a manual + Lighthouse check (#145,
 * #152). Everything else (labels, ARIA validity, duplicate IDs, ...) runs.
 *
 * Usage in a component test: `await expectNoA11yViolations(container)`.
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
  expect(summary).toEqual([]);
}
