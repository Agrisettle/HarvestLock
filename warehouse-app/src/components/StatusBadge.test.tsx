import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
