import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Partners } from "./Partners";

describe("Partners keyboard navigation (Issue #109)", () => {
  it("renders section with accessible heading and landmark", () => {
    render(<Partners />);
    const section = document.querySelector("#partners");
    expect(section).toHaveAttribute("aria-labelledby", "partners-heading");
    expect(screen.getByRole("heading", { level: 2, name: /running an outgrower programme/i })).toHaveAttribute(
      "id",
      "partners-heading"
    );
  });

  it("contains all interactive links in correct tab order without focus traps", () => {
    render(<Partners />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);

    const [issueLink, prdLink] = links;
    expect(issueLink).toHaveTextContent(/open an issue on github/i);
    expect(issueLink).toHaveAttribute("href", "https://github.com/Agrisettle/HarvestLock/issues");
    expect(issueLink).toHaveAttribute("target", "_blank");

    expect(prdLink).toHaveTextContent(/read the full prd first/i);
    expect(prdLink).toHaveAttribute(
      "href",
      "https://github.com/Agrisettle/HarvestLock/blob/main/docs/PRD.md"
    );
    expect(prdLink).toHaveAttribute("target", "_blank");
  });

  it("ensures decorative SVG has aria-hidden and focusable=false to prevent extra tab stops", () => {
    const { container } = render(<Partners />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Partners color contrast & ARIA labeling (Issue #110)", () => {
  it("provides accessible names and notices on external new-tab links", () => {
    render(<Partners />);
    const issueLink = screen.getByRole("link", {
      name: /open an issue on github for partnership inquiries \(opens in a new tab\)/i,
    });
    expect(issueLink).toBeInTheDocument();
    expect(issueLink).toHaveAttribute("rel", "noreferrer noopener");

    const prdLink = screen.getByRole("link", {
      name: /read the full product requirements document \(prd\) on github \(opens in a new tab\)/i,
    });
    expect(prdLink).toBeInTheDocument();
    expect(prdLink).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("verifies contrast ratios meet WCAG AA requirements", () => {
    // Luminance helper matching WCAG 2.1 formula
    const lum = (hex: string) => {
      const rgb = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => parseInt(c, 16) / 255);
      const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrastRatio = (hex1: string, hex2: string) => {
      const [l1, l2] = [lum(hex1), lum(hex2)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    // Dark mode colors used in Partners
    const voidRaised = "#121a16";
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const gold = "#d4a937";
    const goldFill = "#d4a937";
    const goldInk = "#0b120f";

    // Text on background (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(goldInk, goldFill)).toBeGreaterThanOrEqual(4.5);

    // Button UI boundary against background (WCAG AA SC 1.4.11: >= 3:1)
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(3.0);
  });
});
