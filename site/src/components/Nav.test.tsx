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
