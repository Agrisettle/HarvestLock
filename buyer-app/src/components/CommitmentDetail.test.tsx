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
  grade_price_bps: [10_000],
  delivered_quantity: 0,
  grade_index: 0,
  settlement_bps: 0,
  fx_resolved: false,
  fx_adjusted_total: "0",
  fx_shortfall_amount: "0",
  fx_shortfall_funded: false,
  fx_shortfall_deadline: "0",
  dispute_pre_status: "Draft",
  dispute_deadline: "0",
};

// Defaults for the write-path props most tests here don't specifically
// exercise — a no-op wallet-less viewer.
const noopProps = {
  walletAddress: null as string | null,
  onAction: vi.fn(),
  actionInFlight: false,
  actionError: null as string | null,
  onCancelled: vi.fn(),
  onReassigned: vi.fn(),
  onDisputeChanged: vi.fn(),
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
  it("shows claim deadlines in UTC with an explicit timezone label", () => {
    const commitment = { ...baseCommitment, advance1_deadline: "1798245397" };
    render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("26 Dec 2026, 00:36 UTC")).toBeInTheDocument();
  });

  it("labels the buyer's own address distinctly", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Buyer (you)")).toBeInTheDocument();
  });

  it("leads with total locked, not a raw party address", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("Total locked")).toBeInTheDocument();
    expect(screen.getByText("100.00")).toBeInTheDocument();
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

describe("CommitmentDetail keyboard navigation & accessibility (Issue #69)", () => {
  it("renders action button with type='button' and aria-busy when in flight", () => {
    const draft = { ...baseCommitment, status: "Draft" };
    const { rerender } = render(
      <CommitmentDetail
        commitment={draft}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.buyer}
        actionInFlight={false}
      />,
    );
    const button = screen.getByRole("button", { name: "Lock deposit" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-busy", "false");

    rerender(
      <CommitmentDetail
        commitment={draft}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.buyer}
        actionInFlight={true}
      />,
    );
    const busyButton = screen.getByRole("button", { name: "Locking…" });
    expect(busyButton).toHaveAttribute("aria-busy", "true");
  });

  it("renders error banner with role='alert' for immediate screen reader announcement", () => {
    render(
      <CommitmentDetail
        commitment={baseCommitment}
        contractId="CXXX"
        {...noopProps}
        actionError="lock -> 500: network timeout"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("network timeout");
  });

  it("provides accessible tranche table structure with scope attributes and keyboard-accessible scroll region", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    const region = screen.getByRole("region", { name: "Tranche schedule" });
    expect(region).toHaveAttribute("tabIndex", "0");

    const columnHeaders = screen.getAllByRole("columnheader");
    expect(columnHeaders).toHaveLength(4);
    expect(columnHeaders.map((h) => h.textContent)).toEqual(["Tranche", "Share", "Claim deadline", "State"]);
    for (const h of columnHeaders) {
      expect(h).toHaveAttribute("scope", "col");
    }

    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(2);
    expect(rowHeaders.map((h) => h.textContent)).toEqual(["Advance 1", "Advance 2"]);
    for (const h of rowHeaders) {
      expect(h).toHaveAttribute("scope", "row");
    }
  });
});

describe("CommitmentDetail color contrast & ARIA labeling (Issue #70)", () => {
  it("marks pending summary status with role='status' and aria-live='polite'", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    const status = screen.getByText(/Pending:/);
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("marks party details and tranche table with accessible names", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByRole("table", { name: "Tranche schedule" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Tranche schedule" })).toBeInTheDocument();
  });

  it("ensures all controls have accessible names", () => {
    const draft = { ...baseCommitment, status: "Draft" };
    render(
      <CommitmentDetail
        commitment={draft}
        contractId="CXXX"
        {...noopProps}
        walletAddress={baseCommitment.buyer}
      />,
    );
    expect(screen.getByRole("button", { name: "Lock deposit" })).toBeInTheDocument();
    const copyButtons = screen.getAllByRole("button", { name: "Copy" });
    expect(copyButtons.length).toBeGreaterThan(0);
  });

  it("verifies contrast ratios meet WCAG AA requirements for CommitmentDetail styling tokens", () => {
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
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const boneFaint = "#8a897f";
    const gold = "#d4a937";
    const goldBright = "#eec765";
    const signal = "#c1432e";
    const greenBadge = "#8fd6b4";
    const signalBadge = "#ef9c8c";

    // Text contrast (WCAG AA: >= 4.5:1 for normal text)
    expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5); // Table data & dd values
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5); // Pending summary text
    expect(contrastRatio(boneFaint, voidRaised)).toBeGreaterThanOrEqual(4.5); // Field labels & table th
    expect(contrastRatio(voidBg, gold)).toBeGreaterThanOrEqual(4.5); // Primary action button text
    expect(contrastRatio(goldBright, voidRaised)).toBeGreaterThanOrEqual(4.5); // Locked badge text
    expect(contrastRatio(greenBadge, voidRaised)).toBeGreaterThanOrEqual(4.5); // Settled/Delivered badge text
    expect(contrastRatio(signalBadge, voidRaised)).toBeGreaterThanOrEqual(4.5); // Disputed/Cancelled badge text

    // Non-text control boundary & focus indicator contrast (WCAG SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(3.0); // Focus outline on card
    expect(contrastRatio(goldBright, voidRaised)).toBeGreaterThanOrEqual(3.0); // Focus outline on action button
    expect(contrastRatio(signal, voidRaised)).toBeGreaterThanOrEqual(3.0); // Error banner border
    expect(contrastRatio(boneFaint, voidRaised)).toBeGreaterThanOrEqual(3.0); // Address chip copy button border
  });
});
