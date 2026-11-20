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
    const list = screen.getByRole("list", { name: /seven contract lifecycle states/i });
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);

    items.forEach((item) => {
      expect(item).toHaveAttribute("tabindex", "0");
      expect(item.className).toContain("step");
      expect(item).toHaveAttribute("aria-label");
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

describe("HowItWorks color contrast & ARIA labeling (Issue #106)", () => {
  it("provides comprehensive ARIA labeling and accessible names across all elements", () => {
    render(<HowItWorks />);
    const section = screen.getByRole("region", { name: /seven states\. one contract per commitment/i });
    expect(section).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-label", "Step 01: Draft (initialize())");
    expect(items[1]).toHaveAttribute("aria-label", "Step 02: Locked (lock())");
    expect(items[2]).toHaveAttribute("aria-label", "Step 03: Advance released (release_advance_1() → claim_advance_1())");
    expect(items[3]).toHaveAttribute("aria-label", "Step 04: Checkpoint passed (mark_checkpoint())");
    expect(items[4]).toHaveAttribute("aria-label", "Step 05: Second advance (release_advance_2() → claim_advance_2())");
    expect(items[5]).toHaveAttribute("aria-label", "Step 06: Delivered (confirm_delivery())");
    expect(items[6]).toHaveAttribute("aria-label", "Step 07: Settled (settle())");
  });

  it("verifies contract function elements contain descriptive aria-labels", () => {
    const { container } = render(<HowItWorks />);
    const fns = container.querySelectorAll(".step-fn");
    expect(fns).toHaveLength(7);
    expect(fns[0]).toHaveAttribute("aria-label", "Contract function: initialize()");
    expect(fns[1]).toHaveAttribute("aria-label", "Contract function: lock()");
    expect(fns[2]).toHaveAttribute(
      "aria-label",
      "Contract function: release_advance_1() → claim_advance_1()"
    );
    expect(fns[3]).toHaveAttribute("aria-label", "Contract function: mark_checkpoint()");
    expect(fns[4]).toHaveAttribute(
      "aria-label",
      "Contract function: release_advance_2() → claim_advance_2()"
    );
    expect(fns[5]).toHaveAttribute("aria-label", "Contract function: confirm_delivery()");
    expect(fns[6]).toHaveAttribute("aria-label", "Contract function: settle()");
  });

  it("verifies HowItWorks text, badges, and boundary contrast ratios satisfy WCAG AA", () => {
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
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const gold = "#d4a937";
    const goldBright = "#eec765";
    const pineSoft = "#163f30";
    const pineText = "#6fbf9d";

    // Text contrast (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(goldBright, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(pineText, pineSoft)).toBeGreaterThanOrEqual(4.5);

    // Non-text UI boundary contrast (WCAG AA SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(pineText, voidBg)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(3.0);
  });
});
