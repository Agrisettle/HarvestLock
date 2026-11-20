/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the status text and sets data-status for CSS targeting", () => {
    render(<StatusBadge status="ReadyForDelivery" />);
    const badge = screen.getByText("ReadyForDelivery");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-status", "ReadyForDelivery");
  });

  it("renders whatever status string it's given, not a fixed set", () => {
    render(<StatusBadge status="Delivered" />);
    expect(screen.getByText("Delivered")).toHaveAttribute("data-status", "Delivered");
  });

  it("renders every real contract status label and sets data-status", () => {
    const statuses = [
      "Draft",
      "Locked",
      "Advance1Released",
      "CheckpointPassed",
      "Advance2Released",
      "ReadyForDelivery",
      "Delivered",
      "Settled",
      "Cancelled",
      "Defaulted",
      "Forfeited",
      "Disputed",
    ];

    for (const s of statuses) {
      render(<StatusBadge status={s} />);
      const el = screen.getByText(s);
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute("data-status", s);
    }
  });

  it("renders an unrecognized status string (future contract version) instead of a blank badge", () => {
    render(<StatusBadge status="Advance3Released" />);
    expect(screen.getByText("Advance3Released")).toBeInTheDocument();
    expect(screen.getByText("Advance3Released")).toHaveAttribute("data-status", "Advance3Released");
  });
});

// The status -> colour mapping lives in index.css, not in this component,
// so this test reads the CSS directly. Like StatusBadge.tsx, index.css's
// badge block is duplicated per app on purpose — this is the guard
// against one copy's mapping drifting (StatusBadge's own DOM contract is
// covered above; see docs/audits/2026-10-18-addresschip-statusbadge-drift-audit.md).
describe("StatusBadge colour mapping (index.css)", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");

  function badgeBorderColors(): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const [, selectors, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const color = /border-color:\s*([^;]+);/.exec(declarations)?.[1]?.trim();
      if (!color) continue;
      for (const [, status] of selectors.matchAll(/\.badge\[data-status="([^"]+)"\]/g)) {
        mapping[status] = color;
      }
    }
    return mapping;
  }

  it("maps every non-neutral contract status to the agreed colour", () => {
    expect(badgeBorderColors()).toEqual({
      Locked: "var(--gold)",
      Advance1Released: "var(--gold)",
      CheckpointPassed: "var(--gold)",
      Advance2Released: "var(--gold)",
      ReadyForDelivery: "var(--gold)",
      Settled: "var(--pine)",
      Delivered: "var(--pine)",
      Cancelled: "var(--signal)",
      Defaulted: "var(--signal)",
      Forfeited: "var(--signal)",
      Disputed: "var(--signal)",
    });
  });
});
