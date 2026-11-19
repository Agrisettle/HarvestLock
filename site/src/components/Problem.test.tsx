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

describe("Problem color contrast & ARIA labeling (Issue #112)", () => {
  it("provides comprehensive ARIA labeling and accessible names across all elements", () => {
    render(<Problem />);
    const section = screen.getByRole("region", { name: /price crash/i });
    expect(section).toBeInTheDocument();

    const list = screen.getByRole("list", { name: /compounding harvest timing failures/i });
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-label", "Failure 01: No price certainty before planting");
    expect(items[1]).toHaveAttribute("aria-label", "Failure 02: No cash before harvest");
    expect(items[2]).toHaveAttribute("aria-label", "Failure 03: No verifiable distribution");
    expect(items[3]).toHaveAttribute("aria-label", "Failure 04: No currency transparency");
  });

  it("verifies Problem text and indicator contrast ratios satisfy WCAG AA (>= 4.5:1)", () => {
    const lum = (hex: string) => {
      const rgb = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => parseInt(c, 16) / 255);
      const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrastRatio = (hex1: string, hex2: string) => {
      const [l1, l2] = [lum(hex1), lum(hex2)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    // Dark theme values
    const voidBg = "#0b120f";
    const voidRaised = "#121a16";
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const boneFaint = "#8a897f";
    const gold = "#d4a937";

    // Heading (h2, h3) contrast on void & void-raised (>= 4.5:1)
    expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5);

    // Body text (lede, card paragraphs) contrast (>= 4.5:1)
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5);

    // Number indicator (problem-n) contrast (>= 4.5:1)
    expect(contrastRatio(boneFaint, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneFaint, voidRaised)).toBeGreaterThanOrEqual(4.5);

    // Eyebrow contrast (>= 4.5:1)
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(4.5);
  });
});
