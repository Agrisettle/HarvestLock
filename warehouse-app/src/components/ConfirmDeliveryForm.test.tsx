import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDeliveryForm } from "./ConfirmDeliveryForm";
import { expectNoA11yViolations } from "../a11y";

const GRADE_PRICE_BPS = [10_000, 9_000, 7_500];

describe("ConfirmDeliveryForm", () => {
  it("defaults the delivered quantity to the full contracted amount and grade to index 0", async () => {
    const { container } = render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={false}
        submitError={null}
      />,
    );
    expect(screen.getByLabelText("Delivered quantity")).toHaveValue(1000);
    expect(screen.getByLabelText("Grade")).toHaveValue("0");
    await expectNoA11yViolations(container);
  });

  it("lists every grade_price_bps entry as a selectable option", () => {
    render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={false}
        submitError={null}
      />,
    );
    expect(screen.getByText("Grade 0 — 100.00% of unit price")).toBeInTheDocument();
    expect(screen.getByText("Grade 1 — 90.00% of unit price")).toBeInTheDocument();
    expect(screen.getByText("Grade 2 — 75.00% of unit price")).toBeInTheDocument();
  });

  it("submits the entered quantity and selected grade index", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={onSubmit}
        submitting={false}
        submitError={null}
      />,
    );

    await user.clear(screen.getByLabelText("Delivered quantity"));
    await user.type(screen.getByLabelText("Delivered quantity"), "500");
    await user.selectOptions(screen.getByLabelText("Grade"), "1");
    await user.click(screen.getByRole("button", { name: "Confirm delivery" }));

    expect(onSubmit).toHaveBeenCalledWith(500, 1);
  });

  it("submits an over-delivery instead of blocking it; the contract caps settlement at 100%", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={onSubmit}
        submitting={false}
        submitError={null}
      />,
    );

    await user.clear(screen.getByLabelText("Delivered quantity"));
    await user.type(screen.getByLabelText("Delivered quantity"), "1200");

    const submit = screen.getByRole("button", { name: "Confirm delivery" });
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith(1200, 0);
  });

  it("rejects a negative quantity with an inline error and keeps the button enabled for valid input", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={onSubmit}
        submitting={false}
        submitError={null}
      />,
    );

    const input = screen.getByLabelText("Delivered quantity");
    await user.clear(input);
    await user.type(input, "-5");

    expect(await screen.findByText(/Delivered quantity must be a non-negative integer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm delivery" })).toBeDisabled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    await expectNoA11yViolations(container);

    await user.clear(screen.getByLabelText("Delivered quantity"));
    await user.type(screen.getByLabelText("Delivered quantity"), "500");
    expect(screen.queryByText(/Delivered quantity must be a non-negative integer/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm delivery" })).toBeEnabled();
  });

  it("shows submitError and disables submit while submitting", async () => {
    const { container } = render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={true}
        submitError="warehouse_operator auth required"
      />,
    );
    expect(screen.getByText("warehouse_operator auth required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
    await expectNoA11yViolations(container);
  });
});

describe("ConfirmDeliveryForm keyboard navigation audit (Issue #99)", () => {
  it("associates form landmark with heading via aria-labelledby", () => {
    const { container } = render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={false}
        submitError={null}
      />,
    );
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("aria-labelledby", "confirm-delivery-heading");
    expect(screen.getByRole("heading", { level: 2, name: "Confirm delivery" })).toHaveAttribute(
      "id",
      "confirm-delivery-heading",
    );
  });

  it("navigates through interactive controls in sequential tab order without traps", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={false}
        submitError={null}
      />,
    );

    const input = screen.getByLabelText("Delivered quantity");
    const select = screen.getByLabelText("Grade");
    const submitBtn = screen.getByRole("button", { name: "Confirm delivery" });

    await user.tab();
    expect(input).toHaveFocus();

    await user.tab();
    expect(select).toHaveFocus();

    await user.tab();
    expect(submitBtn).toHaveFocus();
  });

  it("submits form on Enter press inside input field", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={onSubmit}
        submitting={false}
        submitError={null}
      />,
    );

    const input = screen.getByLabelText("Delivered quantity");
    await user.clear(input);
    await user.type(input, "800{Enter}");

    expect(onSubmit).toHaveBeenCalledWith(800, 0);
  });

  it("passes axe accessibility checks without violations", async () => {
    const { container } = render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={false}
        submitError={null}
      />,
    );
    await expectNoA11yViolations(container);
  });
});

describe("ConfirmDeliveryForm color contrast & ARIA labeling (Issue #100)", () => {
  it("announces error banners with role='alert'", () => {
    render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={false}
        submitError="Attestation transaction failed"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Attestation transaction failed");
  });

  it("indicates busy state during submission via aria-busy", () => {
    const { rerender } = render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={false}
        submitError={null}
      />,
    );

    const button = screen.getByRole("button", { name: "Confirm delivery" });
    expect(button).toHaveAttribute("aria-busy", "false");

    rerender(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={true}
        submitError={null}
      />,
    );

    const submittingButton = screen.getByRole("button", { name: "Confirming…" });
    expect(submittingButton).toHaveAttribute("aria-busy", "true");
  });

  it("marks invalid inputs with aria-invalid='true'", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDeliveryForm
        contractedQuantity={1000}
        gradePriceBps={GRADE_PRICE_BPS}
        onSubmit={vi.fn()}
        submitting={false}
        submitError={null}
      />,
    );

    const input = screen.getByLabelText("Delivered quantity");
    expect(input).toHaveAttribute("aria-invalid", "false");

    await user.clear(input);
    await user.type(input, "-10");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("verifies contrast ratios meet WCAG AA requirements for form tokens", () => {
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

    // Text contrast on form backgrounds (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5); // Heading & error text
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(4.5); // Description text
    expect(contrastRatio(boneFaint, voidBg)).toBeGreaterThanOrEqual(4.5); // Labels
    expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5); // Input & select value text
    expect(contrastRatio(voidBg, gold)).toBeGreaterThanOrEqual(4.5); // Button text on gold

    // Non-text control boundary & focus indicator contrast (WCAG SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(voidLineStrong, voidBg)).toBeGreaterThanOrEqual(3.0); // Input borders on void
    expect(contrastRatio(voidLineStrong, voidRaised)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(3.0); // Focus outline on void
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(3.0);
  });
});
