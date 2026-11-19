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
