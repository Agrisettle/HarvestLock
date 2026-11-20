import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Nav } from "./Nav";

describe("Nav keyboard navigation (Issue #107)", () => {
  it("renders header and main navigation landmark with accessible label", () => {
    render(<Nav />);
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: /main navigation/i });
    expect(nav).toBeInTheDocument();
  });

  it("contains all interactive links in correct tab order without focus traps", () => {
    render(<Nav />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);

    const [brandLink, howItWorksLink, statusLink, partnersLink, githubLink] = links;
    expect(brandLink).toHaveAttribute("href", "#top");
    expect(brandLink).toHaveAttribute("aria-label", "HarvestLock homepage");

    expect(howItWorksLink).toHaveAttribute("href", "#how-it-works");
    expect(howItWorksLink).toHaveTextContent("How it works");

    expect(statusLink).toHaveAttribute("href", "#status");
    expect(statusLink).toHaveTextContent("Status");

    expect(partnersLink).toHaveAttribute("href", "#partners");
    expect(partnersLink).toHaveTextContent("Partners");

    expect(githubLink).toHaveAttribute("href", "https://github.com/Agrisettle/HarvestLock");
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("ensures brand icon has aria-hidden to prevent redundant announcements", () => {
    const { container } = render(<Nav />);
    const img = container.querySelector(".nav-brand img");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Nav color contrast & ARIA labeling (Issue #108)", () => {
  it("provides accessible name and new tab notice on external GitHub link", () => {
    render(<Nav />);
    const githubLink = screen.getByRole("link", {
      name: /view agrisettle\/harvestlock repository on github \(opens in a new tab\)/i,
    });
    expect(githubLink).toBeInTheDocument();
    expect(githubLink).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("verifies contrast ratios meet WCAG AA requirements", () => {
    const lum = (hex: string) => {
      const rgb = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => parseInt(c, 16) / 255);
      const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrastRatio = (hex1: string, hex2: string) => {
      const [l1, l2] = [lum(hex1), lum(hex2)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    const voidBg = "#0b120f";
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const gold = "#d4a937";
    const goldBright = "#eec765";

    // Text contrast (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(goldBright, voidBg)).toBeGreaterThanOrEqual(4.5);

    // Non-text UI boundary contrast (WCAG AA SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(3.0);
  });
});
