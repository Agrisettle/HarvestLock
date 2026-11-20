import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HowItWorks } from "./HowItWorks";

describe("HowItWorks keyboard navigation (Issue #105)", () => {
  it("renders section with accessible heading and landmark", () => {
    render(<HowItWorks />);
    const section = document.querySelector("#how-it-works");
    expect(section).toHaveAttribute("aria-labelledby", "how-it-works-heading");
    expect(
      screen.getByRole("heading", { level: 2, name: /seven states\. one contract per commitment/i })
    ).toHaveAttribute("id", "how-it-works-heading");
  });

  it("renders lifecycle steps as an accessible list with sequential keyboard tabIndex", () => {
    render(<HowItWorks />);
    const list = screen.getByRole("list");
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);

    items.forEach((item) => {
      expect(item).toHaveAttribute("tabindex", "0");
      expect(item.className).toContain("step");
    });
  });

  it("ensures step markers have aria-hidden to prevent redundant announcements", () => {
    const { container } = render(<HowItWorks />);
    const markers = container.querySelectorAll(".step-marker");
    expect(markers).toHaveLength(7);
    markers.forEach((marker) => {
      expect(marker).toHaveAttribute("aria-hidden", "true");
    });
  });
});
