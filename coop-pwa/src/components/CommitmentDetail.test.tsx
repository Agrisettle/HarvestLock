import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Defaults for the write-path props every test doesn't specifically
// exercise — a no-op wallet-less viewer, matching how most of these
// tests care about read-only rendering, not the claim flow.
const noopProps = {
  walletAddress: null as string | null,
  onClaim: vi.fn(),
  claimingTranche: null as 1 | 2 | null,
  claimError: null as string | null,
};

describe("CommitmentDetail", () => {
  it("formats bps as a percentage", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("15.00%")).toBeInTheDocument();
    expect(screen.getByText("20.00%")).toBeInTheDocument();
  });

  it("shows 'not yet opened' for a deadline of 0, not an epoch date", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    // Both tranches share this fixture's un-opened state.
    expect(screen.getAllByText("not yet opened")).toHaveLength(2);
  });

  it("formats a real deadline as a localized date, not the raw unix seconds", () => {
    const commitment = { ...baseCommitment, advance1_deadline: "1788245397" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.queryByText("1788245397")).not.toBeInTheDocument();
    expect(screen.getByText(new Date(1788245397 * 1000).toLocaleString())).toBeInTheDocument();
  });

  it("reflects claimed vs. expired vs. pending tranche state distinctly", () => {
    const commitment = {
      ...baseCommitment,
      advance1_claimed: true,
      advance2_expired: true,
    };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("claimed")).toBeInTheDocument();
    expect(screen.getByText("expired, reclaimable")).toBeInTheDocument();
  });

  it("renders the current status badge", () => {
    render(<CommitmentDetail commitment={{ ...baseCommitment, status: "Settled" }} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Settled")).toHaveAttribute("data-status", "Settled");
  });
});

describe("CommitmentDetail's claim action", () => {
  it("shows no Action column when no wallet is connected", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.queryByText("Action")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
  });

  it("shows no Action column when the connected wallet isn't the cooperative", () => {
    render(
      <CommitmentDetail
        commitment={baseCommitment}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.buyer}
      />,
    );
    expect(screen.queryByText("Action")).not.toBeInTheDocument();
  });

  it("offers Claim for an open, unclaimed, unexpired tranche when connected as the cooperative", () => {
    const futureDeadline = String(Math.floor(Date.now() / 1000) + 3600);
    const commitment = { ...baseCommitment, advance1_deadline: futureDeadline };
    render(
      <CommitmentDetail
        commitment={commitment}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.cooperative}
      />,
    );
    expect(screen.getByRole("button", { name: "Claim" })).toBeInTheDocument();
  });

  it("does not offer Claim for a tranche that hasn't opened yet (deadline 0)", () => {
    render(
      <CommitmentDetail
        commitment={baseCommitment}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.cooperative}
      />,
    );
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
  });

  it("does not offer Claim for an already-claimed tranche", () => {
    const pastDeadline = String(Math.floor(Date.now() / 1000) + 3600);
    const commitment = { ...baseCommitment, advance1_deadline: pastDeadline, advance1_claimed: true };
    render(
      <CommitmentDetail
        commitment={commitment}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.cooperative}
      />,
    );
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
  });

  it("does not offer Claim once the deadline has passed", () => {
    const pastDeadline = String(Math.floor(Date.now() / 1000) - 3600);
    const commitment = { ...baseCommitment, advance1_deadline: pastDeadline };
    render(
      <CommitmentDetail
        commitment={commitment}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.cooperative}
      />,
    );
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
  });

  it("calls onClaim(1) when Advance 1's Claim button is clicked", async () => {
    const futureDeadline = String(Math.floor(Date.now() / 1000) + 3600);
    const commitment = { ...baseCommitment, advance1_deadline: futureDeadline };
    const onClaim = vi.fn();
    const user = userEvent.setup();
    render(
      <CommitmentDetail
        commitment={commitment}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.cooperative}
        onClaim={onClaim}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Claim" }));
    expect(onClaim).toHaveBeenCalledWith(1);
  });

  it("shows 'Claiming…' and disables the button for the tranche being claimed", () => {
    const futureDeadline = String(Math.floor(Date.now() / 1000) + 3600);
    const commitment = { ...baseCommitment, advance1_deadline: futureDeadline };
    render(
      <CommitmentDetail
        commitment={commitment}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.cooperative}
        claimingTranche={1}
      />,
    );
    const button = screen.getByRole("button", { name: "Claiming…" });
    expect(button).toBeDisabled();
  });

  it("renders a claim error banner when one is passed", () => {
    render(
      <CommitmentDetail
        commitment={baseCommitment}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.cooperative}
        claimError="claim_advance_1 -> 500: something went wrong"
      />,
    );
    expect(screen.getByText(/something went wrong/)).toBeInTheDocument();
  });
});
