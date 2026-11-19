import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Status } from "./Status";

describe("Status keyboard navigation (Issue #115)", () => {
  it("renders section with accessible heading and landmark", () => {
    render(<Status />);
    const section = document.querySelector("#status");
    expect(section).toHaveAttribute("aria-labelledby", "status-heading");
    expect(screen.getByRole("heading", { level: 2, name: /pre-validation/i })).toHaveAttribute(
      "id",
      "status-heading"
    );
  });

  it("contains all interactive links in correct tab order without focus traps", () => {
    render(<Status />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);

    const [repoLink, contractLink, testnetLink] = links;
    expect(repoLink).toHaveAttribute("href", "https://github.com/Agrisettle/HarvestLock");
    expect(repoLink).toHaveAttribute("target", "_blank");
    expect(repoLink).toHaveAttribute("rel", "noreferrer noopener");

    expect(contractLink).toHaveAttribute("href", "https://github.com/Agrisettle/HarvestLock-Contracts");
    expect(contractLink).toHaveAttribute("target", "_blank");
    expect(contractLink).toHaveAttribute("rel", "noreferrer noopener");

    expect(testnetLink).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/contract/CDVF6UVJOLF3OHCFSYSJ72RMG2T6DUQ42VRJ6IHL6MVEFDYEBZ3KTFK4"
    );
    expect(testnetLink).toHaveAttribute("target", "_blank");
    expect(testnetLink).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("preserves list semantics for assistive technologies", () => {
    render(<Status />);
    const lists = screen.getAllByRole("list");
    expect(lists.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Status color contrast & ARIA labeling (Issue #116)", () => {
  it("provides descriptive accessible names indicating destination and new tab", () => {
    render(<Status />);
    const repoLink = screen.getByRole("link", {
      name: /view agrisettle\/harvestlock repository on github \(opens in a new tab\)/i,
    });
    expect(repoLink).toBeInTheDocument();

    const contractLink = screen.getByRole("link", {
      name: /view harvestlock smart contracts source code on github \(opens in a new tab\)/i,
    });
    expect(contractLink).toBeInTheDocument();

    const testnetLink = screen.getByRole("link", {
      name: /view testnet contract CDVF6UVJOLF3OHCFSYSJ72RMG2T6DUQ42VRJ6IHL6MVEFDYEBZ3KTFK4 on stellar expert \(opens in a new tab\)/i,
    });
    expect(testnetLink).toBeInTheDocument();
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
    const voidRaised = "#121a16";
    const boneDim = "#c9c6ba";
    const gold = "#d4a937";
    const goldBright = "#f2c94c";
    const pineSoft = "#163f30";
    const pineText = "#6fbf9d";

    // Text contrast (WCAG AA: >= 4.5:1)
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(goldBright, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(pineText, pineSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(4.5);

    // Non-text UI boundary contrast (WCAG AA SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(pineText, voidBg)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(pineText, pineSoft)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(3.0);
  });
});
