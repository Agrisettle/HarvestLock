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
    const mailLink = screen.getByRole("link", { name: /samuelojetunde898@gmail.com/i });
    expect(mailLink).toBeInTheDocument();
    expect(mailLink).toHaveAttribute("href", "mailto:samuelojetunde898@gmail.com");
  });
});
