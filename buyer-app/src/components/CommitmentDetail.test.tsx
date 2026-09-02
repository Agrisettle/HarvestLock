import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitmentDetail, primaryAction } from "./CommitmentDetail";
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

// Defaults for the write-path props most tests here don't specifically
// exercise — a no-op wallet-less viewer.
const noopProps = {
  walletAddress: null as string | null,
  onAction: vi.fn(),
  actionInFlight: false,
  actionError: null as string | null,
};

describe("CommitmentDetail's pendingSummary (buyer-specific framing)", () => {
  it("lists both advances as outstanding when neither is resolved", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(
      screen.getByText("Pending: advance 1 not yet released or claimed; advance 2 not yet released or claimed."),
    ).toBeInTheDocument();
  });

  it("lists only the unresolved advance once one is claimed", () => {
    const commitment = { ...baseCommitment, advance1_claimed: true };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Pending: advance 2 not yet released or claimed.")).toBeInTheDocument();
  });

  it("says ready to settle once both advances are resolved but status isn't terminal yet", () => {
    const commitment = { ...baseCommitment, advance1_claimed: true, advance2_expired: true };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Both advances are resolved — this commitment is ready to settle.")).toBeInTheDocument();
  });

  it("shows a settled message for a Settled commitment, not the pending breakdown", () => {
    const commitment = { ...baseCommitment, status: "Settled" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(
      screen.getByText("Settled — the full remaining balance has been paid to the cooperative."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pending:/)).not.toBeInTheDocument();
  });

  it("shows a cancelled message for a Cancelled commitment", () => {
    const commitment = { ...baseCommitment, status: "Cancelled" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Cancelled — this commitment was unwound.")).toBeInTheDocument();
  });

  it("flags Defaulted and Disputed as needing attention", () => {
    const commitment = { ...baseCommitment, status: "Disputed" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Disputed — needs attention.")).toBeInTheDocument();
  });
});

describe("CommitmentDetail's shared formatting", () => {
  it("labels the buyer's own address distinctly", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Buyer (you)")).toBeInTheDocument();
  });

  it("leads with total locked, not a raw party address", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Total locked")).toBeInTheDocument();
    expect(screen.getByText(baseCommitment.total_amount)).toBeInTheDocument();
  });
});

describe("primaryAction", () => {
  it("offers lock only for a Draft commitment when the connected wallet is the buyer", () => {
    const draft = { ...baseCommitment, status: "Draft" };
    expect(primaryAction(draft, baseCommitment.buyer)).toBe("lock");
    expect(primaryAction(draft, baseCommitment.cooperative)).toBe(null);
    expect(primaryAction(draft, null)).toBe(null);
  });

  it("offers settle for a Delivered commitment to ANY connected wallet, not just the buyer", () => {
    // settle() has no require_auth() in lib.rs -- genuinely permissionless,
    // so this deliberately checks a non-buyer, non-cooperative address too.
    const delivered = { ...baseCommitment, status: "Delivered" };
    expect(primaryAction(delivered, baseCommitment.buyer)).toBe("settle");
    expect(primaryAction(delivered, "GSOMEONE_ELSE_ENTIRELY")).toBe("settle");
    expect(primaryAction(delivered, null)).toBe(null); // still needs *some* signer to pay the fee
  });

  it("offers nothing for a status neither lock nor settle applies to", () => {
    const locked = { ...baseCommitment, status: "Locked" };
    expect(primaryAction(locked, baseCommitment.buyer)).toBe(null);
  });
});

describe("CommitmentDetail's action button", () => {
  it("shows no action button for a status/wallet combination with no applicable action", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} walletAddress={baseCommitment.buyer} />);
    expect(screen.queryByRole("button", { name: /Lock deposit|Settle/ })).not.toBeInTheDocument();
  });

  it("shows 'Lock deposit' for a Draft commitment when connected as the buyer", () => {
    const draft = { ...baseCommitment, status: "Draft" };
    render(<CommitmentDetail commitment={draft} contractId="CXXX" {...noopProps} walletAddress={baseCommitment.buyer} />);
    expect(screen.getByRole("button", { name: "Lock deposit" })).toBeInTheDocument();
  });

  it("shows 'Settle' for a Delivered commitment when any wallet is connected", () => {
    const delivered = { ...baseCommitment, status: "Delivered" };
    render(<CommitmentDetail commitment={delivered} contractId="CXXX" {...noopProps} walletAddress="GANY_CONNECTED_WALLET" />);
    expect(screen.getByRole("button", { name: "Settle" })).toBeInTheDocument();
  });

  it("calls onAction('lock') when the Lock button is clicked", async () => {
    const draft = { ...baseCommitment, status: "Draft" };
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <CommitmentDetail commitment={draft} contractId="CXXX" {...noopProps} walletAddress={baseCommitment.buyer} onAction={onAction} />,
    );
    await user.click(screen.getByRole("button", { name: "Lock deposit" }));
    expect(onAction).toHaveBeenCalledWith("lock");
  });

  it("shows 'Locking…' and disables the button while in flight", () => {
    const draft = { ...baseCommitment, status: "Draft" };
    render(
      <CommitmentDetail
        commitment={draft}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.buyer}
        actionInFlight={true}
      />,
    );
    expect(screen.getByRole("button", { name: "Locking…" })).toBeDisabled();
  });

  it("renders an action error banner when one is passed", () => {
    render(
      <CommitmentDetail
        commitment={baseCommitment}
        contractId="CXXX"
        {...noopProps}
        actionError="lock -> 500: something went wrong"
      />,
    );
    expect(screen.getByText(/something went wrong/)).toBeInTheDocument();
  });
});
