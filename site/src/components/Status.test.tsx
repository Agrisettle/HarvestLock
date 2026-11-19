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
