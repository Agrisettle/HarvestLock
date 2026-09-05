import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDeliveryForm } from "./ConfirmDeliveryForm";

const GRADE_PRICE_BPS = [10_000, 9_000, 7_500];

describe("ConfirmDeliveryForm", () => {
  it("defaults the delivered quantity to the full contracted amount and grade to index 0", () => {
    render(
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

  it("disables submit while a negative or non-integer quantity is entered", async () => {
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
    await user.type(screen.getByLabelText("Delivered quantity"), "-5");

    expect(screen.getByRole("button", { name: "Confirm delivery" })).toBeDisabled();
  });

  it("shows submitError and disables submit while submitting", () => {
    render(
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
  });
});
