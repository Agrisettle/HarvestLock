import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateCommitmentForm, validateCreateCommitmentFields, parseGradePriceBps, type CreateCommitmentFields } from "./CreateCommitmentForm";

const validFields: CreateCommitmentFields = {
  cooperative: "GCOOPADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  warehouseOperator: "GWHADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  token: "CTOKENADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  totalAmount: "1000000000",
  advance1Bps: 1500,
  advance2Bps: 2000,
  claimWindowSecs: "3600",
  remainderWindowSecs: "3600",
  deliveryWindowSecs: String(60 * 60 * 24),
  contractedQuantity: "1000",
  gradePriceBps: "10000",
  fxConversionEnabled: false,
  oracleContract: "",
  priceAsset: "",
  oracleMaxAgeSecs: String(60 * 60 * 24),
  denominatedAmount: "",
  rolesAcknowledged: true,
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

  it("rejects a remainder-payment window below the API's minimum", () => {
    expect(validateCreateCommitmentFields({ ...validFields, remainderWindowSecs: "60" })).toMatch(
      /Remainder-payment window must be between/,
    );
  });

  it("rejects a remainder-payment window above the API's maximum", () => {
    expect(
      validateCreateCommitmentFields({ ...validFields, remainderWindowSecs: String(60 * 60 * 24 * 365) }),
    ).toMatch(/Remainder-payment window must be between/);
  });

  it("rejects a delivery window below the API's minimum", () => {
    expect(validateCreateCommitmentFields({ ...validFields, deliveryWindowSecs: "60" })).toMatch(
      /Delivery window must be between/,
    );
  });

  it("rejects a delivery window above the API's maximum", () => {
    expect(
      validateCreateCommitmentFields({ ...validFields, deliveryWindowSecs: String(60 * 60 * 24 * 1000) }),
    ).toMatch(/Delivery window must be between/);
  });

  it("rejects submitting without acknowledging Roles & Responsibilities", () => {
    expect(validateCreateCommitmentFields({ ...validFields, rolesAcknowledged: false })).toMatch(
      /Roles & Responsibilities/,
    );
  });

  it("rejects a zero contracted quantity", () => {
    expect(validateCreateCommitmentFields({ ...validFields, contractedQuantity: "0" })).toMatch(
      /Contracted quantity must be a positive/,
    );
  });

  it("rejects an empty grade price schedule", () => {
    expect(validateCreateCommitmentFields({ ...validFields, gradePriceBps: "" })).toMatch(/Grade price schedule/);
  });

  it("rejects a grade price schedule entry over 10000 bps", () => {
    expect(validateCreateCommitmentFields({ ...validFields, gradePriceBps: "8000,12000" })).toMatch(
      /Grade price schedule/,
    );
  });

  it("parses a multi-entry grade price schedule in order", () => {
    expect(parseGradePriceBps("8000, 10000,12000")).toEqual([8000, 10000, 12000]);
  });

  it("rejects FX conversion enabled with no oracle contract address", () => {
    expect(
      validateCreateCommitmentFields({ ...validFields, fxConversionEnabled: true, denominatedAmount: "500" }),
    ).toMatch(/Oracle contract address/);
  });

  it("rejects FX conversion enabled with no price asset", () => {
    expect(
      validateCreateCommitmentFields({
        ...validFields,
        fxConversionEnabled: true,
        oracleContract: "CORACLEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        denominatedAmount: "500",
      }),
    ).toMatch(/Price asset/);
  });

  it("rejects FX conversion enabled with a zero denominated amount", () => {
    expect(
      validateCreateCommitmentFields({
        ...validFields,
        fxConversionEnabled: true,
        oracleContract: "CORACLEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        priceAsset: "NGN",
        denominatedAmount: "0",
      }),
    ).toMatch(/Deal value in the price asset must be greater than zero/);
  });

  it("accepts a fully valid FX-conversion-enabled deal", () => {
    expect(
      validateCreateCommitmentFields({
        ...validFields,
        fxConversionEnabled: true,
        oracleContract: "CORACLEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        priceAsset: "NGN",
        denominatedAmount: "500000000",
      }),
    ).toBe(null);
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
    await user.type(screen.getByLabelText(/Contracted quantity/), validFields.contractedQuantity);
    await user.click(screen.getByRole("checkbox", { name: /Roles & Responsibilities/ }));

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
        contractedQuantity: validFields.contractedQuantity,
        rolesAcknowledged: true,
      }),
    );
  });

  it("does not call onSubmit when the Roles & Responsibilities checkbox is left unchecked", async () => {
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
    await user.type(screen.getByLabelText(/Contracted quantity/), validFields.contractedQuantity);
    // Deliberately not checking the Roles & Responsibilities checkbox this time.

    await user.click(screen.getByRole("button", { name: "Create commitment" }));

    expect(onSubmit).not.toHaveBeenCalled();
    // Matches only the error banner -- a plain /Roles & Responsibilities/
    // regex also matches the checkbox's own (unrelated) label text.
    expect(screen.getByText(/must confirm you've read Roles & Responsibilities/)).toBeInTheDocument();
  }, 15_000);

  it("shows 'Creating…' and disables the button while submitting", () => {
    render(<CreateCommitmentForm onSubmit={vi.fn()} submitting={true} submitError={null} />);
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });

  it("renders a submit error banner when one is passed", () => {
    render(<CreateCommitmentForm onSubmit={vi.fn()} submitting={false} submitError="deploy -> 500: something went wrong" />);
    expect(screen.getByText(/something went wrong/)).toBeInTheDocument();
  });
});
