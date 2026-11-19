import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Problem } from "./Problem";

describe("Problem keyboard navigation (Issue #111)", () => {
  it("renders section with accessible heading and landmark", () => {
    render(<Problem />);
    const section = document.querySelector("#problem");
    expect(section).toHaveAttribute("aria-labelledby", "problem-heading");
    expect(screen.getByRole("heading", { level: 2, name: /price crash/i })).toHaveAttribute(
      "id",
      "problem-heading"
    );
  });

  it("renders problem cards as an accessible list with sequential keyboard tabIndex", () => {
    render(<Problem />);
    const list = screen.getByRole("list", { name: /compounding harvest timing failures/i });
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);

    items.forEach((item) => {
      expect(item).toHaveAttribute("tabindex", "0");
      expect(item.className).toContain("problem-card");
      expect(item).toHaveAttribute("aria-label");
    });
  });
});
