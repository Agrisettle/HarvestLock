import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitmentList } from "./CommitmentList";

describe("CommitmentList", () => {
  it("renders a helpful empty state message when commitments is an empty array", () => {
    render(
      <CommitmentList commitments={[]} onSelect={() => {}} />
    );
    expect(screen.getByText(/Nothing locked yet./)).toBeInTheDocument();
  });
});