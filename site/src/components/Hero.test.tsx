import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hero } from "./Hero";

describe("Hero keyboard navigation (Issue #103)", () => {
  it("renders section with accessible heading and landmark", () => {
    render(<Hero />);
    const section = document.querySelector("#top");
    expect(section).toHaveAttribute("aria-labelledby", "hero-heading");
    expect(
      screen.getByRole("heading", { level: 1, name: /commit before harvest/i })
    ).toHaveAttribute("id", "hero-heading");
  });

  it("contains all interactive links in correct tab order without focus traps", () => {
    render(<Hero />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);

    const [contractLink, prdLink] = links;
    expect(contractLink).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/contract/CDVF6UVJOLF3OHCFSYSJ72RMG2T6DUQ42VRJ6IHL6MVEFDYEBZ3KTFK4"
    );
    expect(contractLink).toHaveAttribute("target", "_blank");
    expect(contractLink).toHaveAttribute("rel", "noreferrer noopener");

    expect(prdLink).toHaveAttribute(
      "href",
      "https://github.com/Agrisettle/HarvestLock/blob/main/docs/PRD.md"
    );
    expect(prdLink).toHaveAttribute("target", "_blank");
    expect(prdLink).toHaveAttribute("rel", "noreferrer noopener");

    contractLink.focus();
    expect(contractLink).toHaveFocus();

    prdLink.focus();
    expect(prdLink).toHaveFocus();
  });

  it("ensures decorative SVG has aria-hidden and focusable=false to prevent extra tab stops", () => {
    const { container } = render(<Hero />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("ensures decorative stat rules have aria-hidden to prevent cluttering assistive technology", () => {
    const { container } = render(<Hero />);
    const rules = container.querySelectorAll(".hero-stat-rule");
    expect(rules).toHaveLength(2);
    rules.forEach((rule) => {
      expect(rule).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("preserves list semantics for protocol metric stats", () => {
    render(<Hero />);
    const list = screen.getByRole("list", { name: /key protocol metrics/i });
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
  });
});

describe("Hero color contrast & ARIA labeling (Issue #104)", () => {
  it("provides accessible names and notices on external new-tab links", () => {
    render(<Hero />);
    const contractLink = screen.getByRole("link", {
      name: /view the live contract CDVF6UVJOLF3OHCFSYSJ72RMG2T6DUQ42VRJ6IHL6MVEFDYEBZ3KTFK4 on stellar expert \(opens in a new tab\)/i,
    });
    expect(contractLink).toBeInTheDocument();
    expect(contractLink).toHaveAttribute("rel", "noreferrer noopener");

    const prdLink = screen.getByRole("link", {
      name: /read the architecture in the product requirements document \(prd\) on github \(opens in a new tab\)/i,
    });
    expect(prdLink).toBeInTheDocument();
    expect(prdLink).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("verifies contrast ratios meet WCAG AA requirements in dark and light modes", () => {
    const lum = (hex: string) => {
      const rgb = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => parseInt(c, 16) / 255);
      const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrastRatio = (hex1: string, hex2: string) => {
      const [l1, l2] = [lum(hex1), lum(hex2)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    // Dark mode palette
    const voidBg = "#0b120f";
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const boneFaint = "#8a897f";
    const gold = "#d4a937";
    const goldBright = "#eec765";
    const goldFill = "#d4a937";
    const goldInk = "#0b120f";

    // Text contrast on background (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneFaint, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(goldBright, voidBg)).toBeGreaterThanOrEqual(4.5);

    // Primary CTA button text on background (WCAG AA: >= 4.5:1)
    expect(contrastRatio(goldInk, goldFill)).toBeGreaterThanOrEqual(4.5);

    // Ghost CTA button boundary on background (WCAG AA SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(3.0);

    // Light mode palette
    const lightVoid = "#f7f6f0";
    const lightBone = "#1c261f";
    const lightBoneDim = "#3f4b43";
    const lightBoneFaint = "#59645d";
    const lightGold = "#755000";
    const lightGoldFill = "#f1cf72";
    const lightGoldInk = "#1c261f";

    expect(contrastRatio(lightBone, lightVoid)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightBoneDim, lightVoid)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightBoneFaint, lightVoid)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightGold, lightVoid)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightGoldInk, lightGoldFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightBoneDim, lightVoid)).toBeGreaterThanOrEqual(3.0);
  });
});
