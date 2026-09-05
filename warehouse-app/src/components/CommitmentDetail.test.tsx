import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitmentDetail } from "./CommitmentDetail";
import type { CommitmentDetail as CommitmentDetailType } from "../api";

const baseCommitment: CommitmentDetailType = {
  status: "Advance1Released",
  buyer: "GBUYERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  cooperative: "GCOOPADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  warehouse_operator: "GWHADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  token: "CTOKENADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  total_amount: "1000000000",
  advance1_bps: 1500,
  advance2_bps: 2000,
  claim_window_secs: "3600",
  remainder_window_secs: "604800",
  created_at: "1788245397",
  delivery_deadline: "1798245397",
  advance1_deadline: "0",
  advance1_claimed: false,
  advance1_expired: false,
  advance2_deadline: "0",
  advance2_claimed: false,
  advance2_expired: false,
  remainder_deadline: "0",
  remainder_funded: false,
  contracted_quantity: 1000,
  grade_price_bps: [10_000, 9_000, 7_500],
  delivered_quantity: 0,
  grade_index: 0,
  settlement_bps: 0,
};

const noopProps = {
  onMarkCheckpoint: vi.fn(),
  onConfirmDelivery: vi.fn(),
  actionInFlight: false,
  actionError: null as string | null,
};

describe("CommitmentDetail's next action", () => {
  it("offers 'Mark mid-season checkpoint' for an Advance1Released commitment", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByRole("button", { name: "Mark mid-season checkpoint" })).toBeInTheDocument();
  });

  it("calls onMarkCheckpoint when that button is clicked", async () => {
    const user = userEvent.setup();
    const onMarkCheckpoint = vi.fn();
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} onMarkCheckpoint={onMarkCheckpoint} />);
    await user.click(screen.getByRole("button", { name: "Mark mid-season checkpoint" }));
    expect(onMarkCheckpoint).toHaveBeenCalled();
  });

  it("shows no checkpoint button once past Advance1Released", () => {
    const commitment = { ...baseCommitment, status: "CheckpointPassed" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.queryByRole("button", { name: "Mark mid-season checkpoint" })).not.toBeInTheDocument();
  });

  it("shows a waiting note, not the confirm-delivery form, when ReadyForDelivery but the remainder isn't funded yet", () => {
    const commitment = { ...baseCommitment, status: "ReadyForDelivery", remainder_funded: false };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText(/hasn't funded the remainder yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm delivery" })).not.toBeInTheDocument();
  });

  it("shows the confirm-delivery form once ReadyForDelivery and the remainder is funded", () => {
    const commitment = { ...baseCommitment, status: "ReadyForDelivery", remainder_funded: true };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByRole("button", { name: "Confirm delivery" })).toBeInTheDocument();
  });

  it("passes this commitment's own contracted_quantity/grade_price_bps into the confirm-delivery form", () => {
    const commitment = { ...baseCommitment, status: "ReadyForDelivery", remainder_funded: true, contracted_quantity: 500 };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByLabelText("Delivered quantity")).toHaveValue(500);
  });

  it("shows the attested delivery record for a Delivered commitment, not the form", () => {
    const commitment = {
      ...baseCommitment,
      status: "Delivered",
      remainder_funded: true,
      delivered_quantity: 500,
      grade_index: 1,
      settlement_bps: 4_500,
    };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("500 / 1000 contracted")).toBeInTheDocument();
    expect(screen.getByText("1 (90.00%)")).toBeInTheDocument();
    expect(screen.getByText("45.00% of contract value")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm delivery" })).not.toBeInTheDocument();
  });

  it("renders an action error banner when one is passed", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} actionError="warehouse_operator auth required" />);
    expect(screen.getByText("warehouse_operator auth required")).toBeInTheDocument();
  });
});

describe("CommitmentDetail's grade schedule table", () => {
  it("lists every grade_price_bps entry", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Grade 0")).toBeInTheDocument();
    expect(screen.getByText("Grade 1")).toBeInTheDocument();
    expect(screen.getByText("Grade 2")).toBeInTheDocument();
  });
});
