import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the status text and sets data-status for CSS targeting", () => {
    render(<StatusBadge status="Locked" />);
    const badge = screen.getByText("Locked");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-status", "Locked");
  });

  it("renders whatever status string it's given, not a fixed set", () => {
    render(<StatusBadge status="Settled" />);
    expect(screen.getByText("Settled")).toHaveAttribute("data-status", "Settled");
  });
});
