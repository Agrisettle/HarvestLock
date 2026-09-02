import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateCommitmentForm, validateCreateCommitmentFields, type CreateCommitmentFields } from "./CreateCommitmentForm";

const validFields: CreateCommitmentFields = {
  cooperative: "GCOOPADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  warehouseOperator: "GWHADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  token: "CTOKENADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  totalAmount: "1000000000",
  advance1Bps: 1500,
  advance2Bps: 2000,
  claimWindowSecs: "3600",
};

describe("validateCreateCommitmentFields", () => {
  it("accepts a fully valid set of fields", () => {
    expect(validateCreateCommitmentFields(validFields)).toBe(null);
  });

  it("rejects a missing cooperative address", () => {
    expect(validateCreateCommitmentFields({ ...validFields, cooperative: "" })).toMatch(/Cooperative address/);
  });

  it("rejects a zero total amount", () => {
    expect(validateCreateCommitmentFields({ ...validFields, totalAmount: "0" })).toMatch(/greater than zero/);
  });

  it("rejects advance1Bps + advance2Bps over 10000 (100%)", () => {
    expect(
      validateCreateCommitmentFields({ ...validFields, advance1Bps: 6000, advance2Bps: 5000 }),
    ).toMatch(/can't add up to more than 100%/);
  });

  it("rejects a claim window below the API's minimum", () => {
    expect(validateCreateCommitmentFields({ ...validFields, claimWindowSecs: "60" })).toMatch(/Claim window must be between/);
  });

  it("rejects a claim window above the API's maximum", () => {
    expect(
      validateCreateCommitmentFields({ ...validFields, claimWindowSecs: String(60 * 60 * 24 * 365) }),
    ).toMatch(/Claim window must be between/);
  });
});

describe("CreateCommitmentForm", () => {
  it("does not call onSubmit when validation fails, and shows the error", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateCommitmentForm onSubmit={onSubmit} submitting={false} submitError={null} />);

    await user.click(screen.getByRole("button", { name: "Create commitment" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Cooperative address is required/)).toBeInTheDocument();
  });

  it("calls onSubmit with the entered fields when they're valid", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateCommitmentForm onSubmit={onSubmit} submitting={false} submitError={null} />);

    await user.type(screen.getByLabelText("Cooperative address"), validFields.cooperative);
    await user.type(screen.getByLabelText("Warehouse operator address"), validFields.warehouseOperator);
    await user.type(screen.getByLabelText("Token contract address"), validFields.token);
    await user.type(screen.getByLabelText("Total amount (stroops)"), validFields.totalAmount);
    await user.clear(screen.getByLabelText("Advance 1 share (basis points)"));
    await user.type(screen.getByLabelText("Advance 1 share (basis points)"), "1500");
    await user.clear(screen.getByLabelText("Advance 2 share (basis points)"));
    await user.type(screen.getByLabelText("Advance 2 share (basis points)"), "2000");
    await user.clear(screen.getByLabelText("Claim window (seconds)"));
    await user.type(screen.getByLabelText("Claim window (seconds)"), "3600");

    await user.click(screen.getByRole("button", { name: "Create commitment" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        cooperative: validFields.cooperative,
        warehouseOperator: validFields.warehouseOperator,
        token: validFields.token,
        totalAmount: "1000000000",
        advance1Bps: 1500,
        advance2Bps: 2000,
        claimWindowSecs: "3600",
      }),
    );
  });

  it("shows 'Creating…' and disables the button while submitting", () => {
    render(<CreateCommitmentForm onSubmit={vi.fn()} submitting={true} submitError={null} />);
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });

  it("renders a submit error banner when one is passed", () => {
    render(<CreateCommitmentForm onSubmit={vi.fn()} submitting={false} submitError="deploy -> 500: something went wrong" />);
    expect(screen.getByText(/something went wrong/)).toBeInTheDocument();
  });
});
