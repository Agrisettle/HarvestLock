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

describe("CommitmentDetail's pendingSummary (buyer-specific framing)", () => {
  it("lists both advances as outstanding when neither is resolved", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" />);
    expect(
      screen.getByText("Pending: advance 1 not yet released or claimed; advance 2 not yet released or claimed."),
    ).toBeInTheDocument();
  });

  it("lists only the unresolved advance once one is claimed", () => {
    const commitment = { ...baseCommitment, advance1_claimed: true };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" />);
    expect(screen.getByText("Pending: advance 2 not yet released or claimed.")).toBeInTheDocument();
  });

  it("says ready to settle once both advances are resolved but status isn't terminal yet", () => {
    const commitment = { ...baseCommitment, advance1_claimed: true, advance2_expired: true };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" />);
    expect(screen.getByText("Both advances are resolved — this commitment is ready to settle.")).toBeInTheDocument();
  });

  it("shows a settled message for a Settled commitment, not the pending breakdown", () => {
    const commitment = { ...baseCommitment, status: "Settled" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" />);
    expect(
      screen.getByText("Settled — the full remaining balance has been paid to the cooperative."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pending:/)).not.toBeInTheDocument();
  });

  it("shows a cancelled message for a Cancelled commitment", () => {
    const commitment = { ...baseCommitment, status: "Cancelled" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" />);
    expect(screen.getByText("Cancelled — this commitment was unwound.")).toBeInTheDocument();
  });

  it("flags Defaulted and Disputed as needing attention", () => {
    const commitment = { ...baseCommitment, status: "Disputed" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" />);
    expect(screen.getByText("Disputed — needs attention.")).toBeInTheDocument();
  });
});

describe("CommitmentDetail's shared formatting", () => {
  it("labels the buyer's own address distinctly", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" />);
    expect(screen.getByText("Buyer (you)")).toBeInTheDocument();
  });

  it("leads with total locked, not a raw party address", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" />);
    expect(screen.getByText("Total locked")).toBeInTheDocument();
    expect(screen.getByText(baseCommitment.total_amount)).toBeInTheDocument();
  });
});
