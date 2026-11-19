import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RolesPage } from "./RolesPage";

describe("RolesPage keyboard navigation (Issue #113)", () => {
  it("renders a skip link targeting the main content landmark", () => {
    render(<RolesPage />);
    const skipLink = screen.getByRole("link", { name: /skip to content/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#roles-content");

    const main = document.querySelector("#roles-content");
    expect(main).toBeInTheDocument();
    expect(main).toHaveAttribute("tabIndex", "-1");
  });

  it("provides accessible back navigation to homepage", () => {
    render(<RolesPage />);
    const backLink = screen.getByRole("link", { name: /back to harvestlock homepage/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/");
  });

  it("provides keyboard-accessible scroll region for the commitment windows table", () => {
    render(<RolesPage />);
    const tableRegion = screen.getByRole("region", { name: /commitment window lengths/i });
    expect(tableRegion).toBeInTheDocument();
    expect(tableRegion).toHaveAttribute("tabIndex", "0");

    const table = tableRegion.querySelector("table");
    expect(table).toBeInTheDocument();
  });

  it("ensures appeals email link is interactive and keyboard reachable", () => {
    render(<RolesPage />);
    const mailLink = screen.getByRole("link", { name: /send appeal email to samuelojetunde898@gmail.com/i });
    expect(mailLink).toBeInTheDocument();
    expect(mailLink).toHaveAttribute("href", "mailto:samuelojetunde898@gmail.com");
  });
});

describe("RolesPage color contrast & ARIA labeling (Issue #114)", () => {
  it("provides accessible landmark and section headings via aria-labelledby", () => {
    render(<RolesPage />);
    expect(document.querySelector(".roles-hero")).toHaveAttribute("aria-labelledby", "roles-hero-title");
    expect(screen.getByRole("heading", { level: 1, name: /roles & responsibilities/i })).toHaveAttribute(
      "id",
      "roles-hero-title"
    );

    expect(screen.getByRole("heading", { level: 2, name: /how a commitment moves money/i })).toHaveAttribute(
      "id",
      "roles-money-title"
    );
    expect(screen.getByRole("heading", { level: 2, name: /the buyer's side/i })).toHaveAttribute(
      "id",
      "roles-buyer-title"
    );
    expect(screen.getByRole("heading", { level: 2, name: /the cooperative's side/i })).toHaveAttribute(
      "id",
      "roles-coop-title"
    );
    expect(screen.getByRole("heading", { level: 2, name: /window lengths/i })).toHaveAttribute(
      "id",
      "roles-windows-title"
    );
    expect(screen.getByRole("heading", { level: 2, name: /appeals/i })).toHaveAttribute(
      "id",
      "roles-appeals-title"
    );
  });

  it("gives severity badges status roles and explicit accessible names", () => {
    render(<RolesPage />);
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);

    expect(statuses[0]).toHaveAttribute("aria-label", "Consequence severity: Immediate permanent bar");
    expect(statuses[0]).toHaveTextContent(/immediate permanent bar/i);

    expect(statuses[1]).toHaveAttribute("aria-label", "Consequence severity: Graduated — three before a bar");
    expect(statuses[1]).toHaveTextContent(/graduated — three before a bar/i);
  });

  it("provides semantic table headers with scope and caption", () => {
    render(<RolesPage />);
    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();

    const caption = table.querySelector("caption");
    expect(caption).toHaveTextContent(/default commitment window durations and trigger points/i);

    const colHeaders = table.querySelectorAll("thead th");
    expect(colHeaders).toHaveLength(3);
    colHeaders.forEach((th) => expect(th).toHaveAttribute("scope", "col"));

    const rowHeaders = table.querySelectorAll("tbody th");
    expect(rowHeaders).toHaveLength(2);
    rowHeaders.forEach((th) => expect(th).toHaveAttribute("scope", "row"));
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
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const gold = "#d4a937";
    const signal = "#f07a63";

    // Text contrast on void & voidRaised (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(signal, voidRaised)).toBeGreaterThanOrEqual(4.5);

    // Non-text UI boundaries (WCAG AA SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(signal, voidRaised)).toBeGreaterThanOrEqual(3.0);
  });
});
