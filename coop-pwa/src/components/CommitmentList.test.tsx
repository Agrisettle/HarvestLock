import { describe, it, expect } from "vitest";
import { expectNoA11yViolations } from "../a11y";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitmentList } from "./CommitmentList";

describe("CommitmentList", () => {
  it("renders a helpful empty state message when commitments is an empty array", () => {
    render(
      <CommitmentList commitments={[]} onSelect={() => {}} />
    );
    expect(screen.getByText(/No commitments cached yet./)).toBeInTheDocument();
  });

  const rows = [
    { id: 1, contract_id: "CAAA111", status: "Locked" },
    { id: 2, contract_id: "CBBB222", status: "Draft" },
  ] as unknown as Parameters<typeof CommitmentList>[0]["commitments"];

  it("exposes rows as a list of buttons named by full contract ID and status, with no axe violations", async () => {
    const { container } = render(<CommitmentList commitments={rows} onSelect={() => {}} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "CAAA111, Locked" })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("selects a row from the keyboard with Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CommitmentList commitments={rows} onSelect={onSelect} />);
    screen.getByRole("button", { name: "CBBB222, Draft" }).focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("CBBB222");
  });
});
