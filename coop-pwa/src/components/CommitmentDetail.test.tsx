import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitmentDetail } from "./CommitmentDetail";
import type { CommitmentDetail as CommitmentDetailType } from "../api";

const baseCommitment: CommitmentDetailType = {
  status: "Locked",
  buyer: "GBUYERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  cooperative: "GCOOPADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  warehouse_operator: "GWHADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  token: "CTOKENADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  total_amount: "1000000000",
  advance1_bps: 1500,
  advance2_bps: 2000,
  claim_window_secs: "3600",
  created_at: "1788245397",
  advance1_deadline: "0",
  advance1_claimed: false,
  advance1_expired: false,
  advance2_deadline: "0",
  advance2_claimed: false,
  advance2_expired: false,
};

describe("CommitmentDetail", () => {
  it("formats bps as a percentage", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" />);
    expect(screen.getByText("15.00%")).toBeInTheDocument();
    expect(screen.getByText("20.00%")).toBeInTheDocument();
  });

  it("shows 'not yet opened' for a deadline of 0, not an epoch date", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" />);
    // Both tranches share this fixture's un-opened state.
    expect(screen.getAllByText("not yet opened")).toHaveLength(2);
  });

  it("formats a real deadline as a localized date, not the raw unix seconds", () => {
    const commitment = { ...baseCommitment, advance1_deadline: "1788245397" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" />);
    expect(screen.queryByText("1788245397")).not.toBeInTheDocument();
    expect(screen.getByText(new Date(1788245397 * 1000).toLocaleString())).toBeInTheDocument();
  });

  it("reflects claimed vs. expired vs. pending tranche state distinctly", () => {
    const commitment = {
      ...baseCommitment,
      advance1_claimed: true,
      advance2_expired: true,
    };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" />);
    expect(screen.getByText("claimed")).toBeInTheDocument();
    expect(screen.getByText("expired, reclaimable")).toBeInTheDocument();
  });

  it("renders the current status badge", () => {
    render(<CommitmentDetail commitment={{ ...baseCommitment, status: "Settled" }} contractId="CXXX" />);
    expect(screen.getByText("Settled")).toHaveAttribute("data-status", "Settled");
  });
});
