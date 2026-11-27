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
    ).toMatch(/can't add up to more than 10000/);
  });

  it("rejects a claim window below the API's minimum", () => {
    expect(validateCreateCommitmentFields({ ...validFields, claimWindowSecs: "60" })).toMatch(/Claim window must be between/);
  });

  it("rejects a claim window above the API's maximum", () => {
    expect(
      validateCreateCommitmentFields({ ...validFields, claimWindowSecs: String(60 * 60 * 24 * 365) }),
    ).toMatch(/Claim window must be between/);
  });

  it("rejects an advance share over 10000 basis points", () => {
    expect(
      validateCreateCommitmentFields({ ...validFields, advance1Bps: 10_001 }),
    ).toMatch(/Advance 1 share must be between 0 and 10000 basis points/);
  });

  it("rejects a negative advance share", () => {
    expect(
      validateCreateCommitmentFields({ ...validFields, advance1Bps: -1 }),
    ).toMatch(/Advance 1 share must be between 0 and 10000 basis points/);
    expect(
      validateCreateCommitmentFields({ ...validFields, advance2Bps: -1 }),
    ).toMatch(/Advance 2 share must be between 0 and 10000 basis points/);
  });

  it("rejects advance1Bps + advance2Bps over 10000 (100%)", () => {
    expect(
      validateCreateCommitmentFields({ ...validFields, advance1Bps: 6000, advance2Bps: 5000 }),
    ).toMatch(/can't add up to more than 10000/);
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

describe("CreateCommitmentForm", { timeout: 20_000 }, () => {
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
    await user.type(screen.getByLabelText("Total amount (USDC)"), "100");
    await user.clear(screen.getByLabelText("Advance 1 share (%)"));
    await user.type(screen.getByLabelText("Advance 1 share (%)"), "15");
    await user.clear(screen.getByLabelText("Advance 2 share (%)"));
    await user.type(screen.getByLabelText("Advance 2 share (%)"), "20");
    await user.clear(screen.getByLabelText("Claim window"));
    await user.type(screen.getByLabelText("Claim window"), "1");
    await user.selectOptions(screen.getByLabelText("Claim window unit"), "hours");
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

  it("rejects an amount with more than 7 decimal places without submitting", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateCommitmentForm onSubmit={onSubmit} submitting={false} submitError={null} />);
    await user.type(screen.getByLabelText("Total amount (USDC)"), "1.12345678");
    await user.click(screen.getByRole("button", { name: "Create commitment" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/At most 7 decimal places/)).toBeInTheDocument();
  });

  it("sends the exact stroop, second and basis-point strings for friendly inputs", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateCommitmentForm onSubmit={onSubmit} submitting={false} submitError={null} />);
    await user.type(screen.getByLabelText("Cooperative address"), validFields.cooperative);
    await user.type(screen.getByLabelText("Warehouse operator address"), validFields.warehouseOperator);
    await user.type(screen.getByLabelText("Token contract address"), validFields.token);
    await user.type(screen.getByLabelText("Total amount (USDC)"), "1250.5");
    await user.clear(screen.getByLabelText("Advance 1 share (%)"));
    await user.type(screen.getByLabelText("Advance 1 share (%)"), "12.5");
    await user.type(screen.getByLabelText(/Contracted quantity/), validFields.contractedQuantity);
    await user.click(screen.getByRole("checkbox", { name: /Roles & Responsibilities/ }));
    await user.click(screen.getByRole("button", { name: "Create commitment" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        totalAmount: "12505000000",
        advance1Bps: 1250,
        claimWindowSecs: "86400",
        remainderWindowSecs: "604800",
        deliveryWindowSecs: "10368000",
      }),
    );
  }, 15_000);

  it("does not call onSubmit when the Roles & Responsibilities checkbox is left unchecked", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateCommitmentForm onSubmit={onSubmit} submitting={false} submitError={null} />);

    await user.type(screen.getByLabelText("Cooperative address"), validFields.cooperative);
    await user.type(screen.getByLabelText("Warehouse operator address"), validFields.warehouseOperator);
    await user.type(screen.getByLabelText("Token contract address"), validFields.token);
    await user.type(screen.getByLabelText("Total amount (USDC)"), "100");
    await user.clear(screen.getByLabelText("Advance 1 share (%)"));
    await user.type(screen.getByLabelText("Advance 1 share (%)"), "15");
    await user.clear(screen.getByLabelText("Advance 2 share (%)"));
    await user.type(screen.getByLabelText("Advance 2 share (%)"), "20");
    await user.type(screen.getByLabelText(/Contracted quantity/), validFields.contractedQuantity);
    // Deliberately not checking the Roles & Responsibilities checkbox this time.

    await user.click(screen.getByRole("button", { name: "Create commitment" }));

    expect(onSubmit).not.toHaveBeenCalled();
    // Matches only the error banner -- a plain /Roles & Responsibilities/
    // regex also matches the checkbox's own (unrelated) label text.
    expect(screen.getByText(/must confirm you've read Roles & Responsibilities/)).toBeInTheDocument();
  }, 15_000);

  it("clears the oracle fields' validation errors when FX conversion is toggled off, not just hides the inputs", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateCommitmentForm onSubmit={onSubmit} submitting={false} submitError={null} />);

    await user.type(screen.getByLabelText("Cooperative address"), validFields.cooperative);
    await user.type(screen.getByLabelText("Warehouse operator address"), validFields.warehouseOperator);
    await user.type(screen.getByLabelText("Token contract address"), validFields.token);
    await user.type(screen.getByLabelText("Total amount (USDC)"), "100");
    await user.type(screen.getByLabelText(/Contracted quantity/), validFields.contractedQuantity);
    await user.click(screen.getByRole("checkbox", { name: /Roles & Responsibilities/ }));

    // Enable FX conversion but leave its oracle fields blank, so submitting
    // fails with an oracle-specific validation error.
    await user.click(screen.getByRole("checkbox", { name: /FX conversion/ }));
    await user.click(screen.getByRole("button", { name: "Create commitment" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Oracle contract address is required/)).toBeInTheDocument();

    // Turning FX conversion back off hides the oracle inputs...
    await user.click(screen.getByRole("checkbox", { name: /FX conversion/ }));
    expect(screen.queryByLabelText("Reflector oracle contract address")).not.toBeInTheDocument();

    // ...and must clear the now-irrelevant validation error, not leave it
    // pointing at fields the buyer can no longer see.
    expect(screen.queryByText(/Oracle contract address is required/)).not.toBeInTheDocument();
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

describe("CreateCommitmentForm keyboard navigation audit (Issue #73)", { timeout: 20_000 }, () => {
  it("allows sequential tab navigation through interactive elements without focus traps", async () => {
    const user = userEvent.setup();
    render(<CreateCommitmentForm onSubmit={vi.fn()} submitting={false} submitError={null} />);

    const coopInput = screen.getByLabelText("Cooperative address");
    const whInput = screen.getByLabelText("Warehouse operator address");
    const tokenInput = screen.getByLabelText("Token contract address");
    const amountInput = screen.getByLabelText("Total amount (USDC)");
    const adv1Input = screen.getByLabelText("Advance 1 share (%)");
    const adv2Input = screen.getByLabelText("Advance 2 share (%)");
    const claimInput = screen.getByLabelText("Claim window");
    const claimSelect = screen.getByLabelText("Claim window unit");
    const remInput = screen.getByLabelText("Remainder-payment window");
    const remSelect = screen.getByLabelText("Remainder-payment window unit");
    const delInput = screen.getByLabelText("Delivery window");
    const delSelect = screen.getByLabelText("Delivery window unit");
    const qtyInput = screen.getByLabelText(/Contracted quantity/);
    const gradeInput = screen.getByLabelText(/Grade price schedule/);
    const fxCheckbox = screen.getByLabelText(/This deal needs FX conversion/);
    const rolesCheckbox = screen.getByLabelText(/I've read/);
    const submitBtn = screen.getByRole("button", { name: "Create commitment" });

    await user.tab();
    expect(coopInput).toHaveFocus();

    await user.tab();
    expect(whInput).toHaveFocus();

    await user.tab();
    expect(tokenInput).toHaveFocus();

    await user.tab();
    expect(amountInput).toHaveFocus();

    await user.tab();
    expect(adv1Input).toHaveFocus();

    await user.tab();
    expect(adv2Input).toHaveFocus();

    await user.tab();
    expect(claimInput).toHaveFocus();

    await user.tab();
    expect(claimSelect).toHaveFocus();

    await user.tab();
    expect(remInput).toHaveFocus();

    await user.tab();
    expect(remSelect).toHaveFocus();

    await user.tab();
    expect(delInput).toHaveFocus();

    await user.tab();
    expect(delSelect).toHaveFocus();

    await user.tab();
    expect(qtyInput).toHaveFocus();

    await user.tab();
    expect(gradeInput).toHaveFocus();

    await user.tab();
    expect(fxCheckbox).toHaveFocus();

    await user.tab();
    expect(rolesCheckbox).toHaveFocus();

    await user.tab();
    expect(submitBtn).toHaveFocus();
  });

  it("toggles checkboxes via keyboard Space key", async () => {
    const user = userEvent.setup();
    render(<CreateCommitmentForm onSubmit={vi.fn()} submitting={false} submitError={null} />);

    const fxCheckbox = screen.getByLabelText(/This deal needs FX conversion/);
    expect(fxCheckbox).not.toBeChecked();

    fxCheckbox.focus();
    expect(fxCheckbox).toHaveFocus();

    await user.keyboard(" ");
    expect(fxCheckbox).toBeChecked();

    // With FX enabled, oracle inputs appear in tab sequence
    const oracleInput = screen.getByLabelText("Reflector oracle contract address");
    expect(oracleInput).toBeInTheDocument();

    await user.keyboard(" ");
    expect(fxCheckbox).not.toBeChecked();
    expect(screen.queryByLabelText("Reflector oracle contract address")).not.toBeInTheDocument();
  });

  it("submits the form using keyboard Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CreateCommitmentForm onSubmit={onSubmit} submitting={false} submitError={null} />);

    const submitBtn = screen.getByRole("button", { name: "Create commitment" });
    submitBtn.focus();
    expect(submitBtn).toHaveFocus();

    await user.keyboard("{Enter}");
    // Validation fails because fields are empty, showing error banner
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("CreateCommitmentForm color contrast & ARIA labeling (Issue #74)", () => {
  it("labels the form via aria-labelledby referencing its heading", () => {
    render(<CreateCommitmentForm onSubmit={vi.fn()} submitting={false} submitError={null} />);
    const form = screen.getByRole("form", { name: "Create a new commitment" });
    expect(form).toBeInTheDocument();
  });

  it("provides accessible names for all form controls", () => {
    render(<CreateCommitmentForm onSubmit={vi.fn()} submitting={false} submitError={null} />);
    expect(screen.getByLabelText("Cooperative address")).toHaveAttribute("id", "cooperative-address");
    expect(screen.getByLabelText("Warehouse operator address")).toHaveAttribute("id", "warehouse-address");
    expect(screen.getByLabelText("Token contract address")).toHaveAttribute("id", "token-address");
    expect(screen.getByLabelText("Total amount (USDC)")).toHaveAttribute("id", "total-amount");
    expect(screen.getByLabelText("Advance 1 share (%)")).toHaveAttribute("id", "advance1-pct");
    expect(screen.getByLabelText("Advance 2 share (%)")).toHaveAttribute("id", "advance2-pct");
    expect(screen.getByLabelText("Claim window")).toHaveAttribute("id", "claim-window");
    expect(screen.getByLabelText("Claim window unit")).toBeInTheDocument();
    expect(screen.getByLabelText("Remainder-payment window")).toHaveAttribute("id", "remainder-window");
    expect(screen.getByLabelText("Remainder-payment window unit")).toBeInTheDocument();
    expect(screen.getByLabelText("Delivery window")).toHaveAttribute("id", "delivery-window");
    expect(screen.getByLabelText("Delivery window unit")).toBeInTheDocument();
    expect(screen.getByLabelText(/Contracted quantity/)).toHaveAttribute("id", "contracted-quantity");
    expect(screen.getByLabelText(/Grade price schedule/)).toHaveAttribute("id", "grade-price-bps");
    expect(screen.getByLabelText(/This deal needs FX conversion/)).toHaveAttribute("id", "fx-conversion-checkbox");
    expect(screen.getByLabelText(/I've read/)).toHaveAttribute("id", "roles-acknowledged-checkbox");
    expect(screen.getByRole("button", { name: "Create commitment" })).toBeInTheDocument();
  });

  it("sets aria-busy on submit button during submission", () => {
    const { rerender } = render(<CreateCommitmentForm onSubmit={vi.fn()} submitting={false} submitError={null} />);
    const button = screen.getByRole("button", { name: "Create commitment" });
    expect(button).toHaveAttribute("aria-busy", "false");

    rerender(<CreateCommitmentForm onSubmit={vi.fn()} submitting={true} submitError={null} />);
    const busyButton = screen.getByRole("button", { name: "Creating…" });
    expect(busyButton).toHaveAttribute("aria-busy", "true");
  });

  it("verifies contrast ratios meet WCAG AA requirements for CreateCommitmentForm styling tokens", () => {
    const lum = (hex: string) => {
      const rgb = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => parseInt(c, 16) / 255);
      const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrastRatio = (hex1: string, hex2: string) => {
      const [l1, l2] = [lum(hex1), lum(hex2)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    const voidBg = "#0b120f";
    const voidRaised = "#121a16";
    const voidLineStrong = "#5c6b62";
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const boneFaint = "#8a897f";
    const gold = "#d4a937";
    const goldBright = "#eec765";
    const signal = "#c1432e";

    // Text contrast (WCAG AA: >= 4.5:1 for normal text)
    expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5); // Heading on card
    expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5); // Input text on input bg
    expect(contrastRatio(boneFaint, voidRaised)).toBeGreaterThanOrEqual(4.5); // Labels on card
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5); // Checkbox and note text
    expect(contrastRatio(voidBg, gold)).toBeGreaterThanOrEqual(4.5); // Button text on gold
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(4.5); // Roles & Responsibilities link text

    // Non-text control boundary & focus indicator contrast (WCAG SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(voidLineStrong, voidBg)).toBeGreaterThanOrEqual(3.0); // Input borders on void
    expect(contrastRatio(voidLineStrong, voidRaised)).toBeGreaterThanOrEqual(3.0); // Control borders on voidRaised
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(3.0); // Focus outline on void
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(3.0); // Focus outline on card
    expect(contrastRatio(goldBright, voidRaised)).toBeGreaterThanOrEqual(3.0); // Button focus outline
    expect(contrastRatio(signal, voidRaised)).toBeGreaterThanOrEqual(3.0); // Error banner border
  });
});
