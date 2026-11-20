import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitmentDetail } from "./CommitmentDetail";
import type { CommitmentDetail as CommitmentDetailType } from "../api";
import { expectNoA11yViolations } from "../a11y";

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
  fx_resolved: false,
  fx_adjusted_total: "0",
  fx_shortfall_amount: "0",
  fx_shortfall_funded: false,
  fx_shortfall_deadline: "0",
  dispute_pre_status: "Draft",
  dispute_deadline: "0",
};

const noopProps = {
  walletAddress: null as string | null,
  onMarkCheckpoint: vi.fn(),
  onConfirmDelivery: vi.fn(),
  actionInFlight: false,
  actionError: null as string | null,
  onDisputeChanged: vi.fn(),
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

  it("shows a waiting note, not the confirm-delivery form, when ReadyForDelivery but the remainder isn't funded yet", async () => {
    const commitment = { ...baseCommitment, status: "ReadyForDelivery", remainder_funded: false };
    const { container } = render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText(/hasn't funded the remainder yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm delivery" })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("shows the confirm-delivery form once ReadyForDelivery and the remainder is funded", async () => {
    const commitment = { ...baseCommitment, status: "ReadyForDelivery", remainder_funded: true };
    const { container } = render(<CommitmentDetail commitment={commitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByRole("button", { name: "Confirm delivery" })).toBeInTheDocument();
    await expectNoA11yViolations(container);
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

describe("CommitmentDetail's delivery deadline", () => {
  it("shows the absolute deadline in UTC with an explicit timezone label", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    expect(screen.getByText("26 Dec 2026, 00:36 UTC")).toBeInTheDocument();
  });
});

describe("CommitmentDetail keyboard navigation audit (Issue #95)", () => {
  it("renders interactive elements with explicit type='button'", () => {
    const { unmount } = render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);
    const checkpointBtn = screen.getByRole("button", { name: "Mark mid-season checkpoint" });
    expect(checkpointBtn).toHaveAttribute("type", "button");
    unmount();

    const deliveredCommitment: CommitmentDetailType = {
      ...baseCommitment,
      status: "Delivered",
      delivered_quantity: 1000,
      grade_index: 0,
      settlement_bps: 10_000,
    };
    render(<CommitmentDetail commitment={deliveredCommitment} contractId="CXXX" {...noopProps} />);
    const printBtn = screen.getByRole("button", { name: "Print receipt" });
    expect(printBtn).toHaveAttribute("type", "button");
  });

  it("allows sequential keyboard tab navigation across controls and scroll region", async () => {
    const user = userEvent.setup();
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);

    // Tab order: contractId copy button, checkpoint button, buyer copy, coop copy, tranches scroll region
    const copyButtons = screen.getAllByRole("button", { name: "Copy" });
    const checkpointBtn = screen.getByRole("button", { name: "Mark mid-season checkpoint" });
    const tranchesRegion = screen.getByRole("region", { name: "Grade price schedule" });

    await user.tab();
    expect(copyButtons[0]).toHaveFocus();

    await user.tab();
    expect(checkpointBtn).toHaveFocus();

    await user.tab();
    expect(copyButtons[1]).toHaveFocus();

    await user.tab();
    expect(copyButtons[2]).toHaveFocus();

    await user.tab();
    expect(tranchesRegion).toHaveFocus();
  });

  it("activates checkpoint button via keyboard (Enter)", async () => {
    const user = userEvent.setup();
    const onMarkCheckpoint = vi.fn();
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} onMarkCheckpoint={onMarkCheckpoint} />);

    const checkpointBtn = screen.getByRole("button", { name: "Mark mid-season checkpoint" });
    checkpointBtn.focus();
    expect(checkpointBtn).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onMarkCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("activates print receipt button via keyboard and triggers window.print", async () => {
    const printSpy = vi.fn();
    const originalPrint = window.print;
    window.print = printSpy;

    try {
      const user = userEvent.setup();
      const deliveredCommitment: CommitmentDetailType = {
        ...baseCommitment,
        status: "Delivered",
        delivered_quantity: 1000,
        grade_index: 0,
        settlement_bps: 10_000,
      };
      render(<CommitmentDetail commitment={deliveredCommitment} contractId="CXXX" {...noopProps} />);

      const printBtn = screen.getByRole("button", { name: "Print receipt" });
      printBtn.focus();
      expect(printBtn).toHaveFocus();

      await user.keyboard("{Enter}");
      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.print = originalPrint;
    }
  });

  it("sets aria-busy and disables action button when action is in flight", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} actionInFlight={true} />);
    const checkpointBtn = screen.getByRole("button", { name: "Marking checkpoint…" });
    expect(checkpointBtn).toBeDisabled();
    expect(checkpointBtn).toHaveAttribute("aria-busy", "true");
  });

  it("passes axe accessibility checks across multiple commitment states", async () => {
    // 1. Advance1Released
    const { container: container1, unmount: unmount1 } = render(
      <CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />
    );
    await expectNoA11yViolations(container1);
    unmount1();

    // 2. ReadyForDelivery with pending summary
    const readyCommitment: CommitmentDetailType = {
      ...baseCommitment,
      status: "ReadyForDelivery",
      remainder_funded: false,
    };
    const { container: container2, unmount: unmount2 } = render(
      <CommitmentDetail commitment={readyCommitment} contractId="CXXX" {...noopProps} />
    );
    await expectNoA11yViolations(container2);
    unmount2();

    // 3. Delivered with attested receipt
    const deliveredCommitment: CommitmentDetailType = {
      ...baseCommitment,
      status: "Delivered",
      delivered_quantity: 1000,
      grade_index: 0,
      settlement_bps: 10_000,
    };
    const { container: container3 } = render(
      <CommitmentDetail commitment={deliveredCommitment} contractId="CXXX" {...noopProps} />
    );
    await expectNoA11yViolations(container3);
  });
});

describe("CommitmentDetail color contrast & ARIA labeling (Issue #96)", () => {
  it("structures grade schedule table with scope='col' and scope='row' headers", () => {
    render(<CommitmentDetail commitment={baseCommitment} contractId="CXXX" {...noopProps} />);

    const colHeaders = screen.getAllByRole("columnheader");
    expect(colHeaders).toHaveLength(2);
    expect(colHeaders[0]).toHaveTextContent("Grade");
    expect(colHeaders[0]).toHaveAttribute("scope", "col");
    expect(colHeaders[1]).toHaveTextContent("Price multiplier");
    expect(colHeaders[1]).toHaveAttribute("scope", "col");

    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(3);
    expect(rowHeaders[0]).toHaveTextContent("Grade 0");
    expect(rowHeaders[0]).toHaveAttribute("scope", "row");
    expect(rowHeaders[1]).toHaveTextContent("Grade 1");
    expect(rowHeaders[1]).toHaveAttribute("scope", "row");
    expect(rowHeaders[2]).toHaveTextContent("Grade 2");
    expect(rowHeaders[2]).toHaveAttribute("scope", "row");
  });

  it("exposes pending delivery reminder via role='status' live region", () => {
    const readyCommitment: CommitmentDetailType = {
      ...baseCommitment,
      status: "ReadyForDelivery",
      remainder_funded: false,
    };
    render(<CommitmentDetail commitment={readyCommitment} contractId="CXXX" {...noopProps} />);
    const statusNote = screen.getByRole("status");
    expect(statusNote).toHaveTextContent(/hasn't funded the remainder yet/i);
  });

  it("exposes action error messages via role='alert' for immediate announcement", () => {
    render(
      <CommitmentDetail
        commitment={baseCommitment}
        contractId="CXXX"
        {...noopProps}
        actionError="Transaction rejected by user"
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Transaction rejected by user");
  });

  it("verifies contrast ratios meet WCAG AA requirements for CommitmentDetail tokens", () => {
    const contrastRatio = (hex1: string, hex2: string) => {
      const luminance = (hex: string) => {
        const rgb = [0, 2, 4].map((offset) => {
          const c = parseInt(hex.slice(offset + 1, offset + 3), 16) / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      };
      const l1 = luminance(hex1);
      const l2 = luminance(hex2);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    const voidBg = "#0b120f";
    const voidRaised = "#141f1a";
    const voidLineStrong = "#5c6b62";
    const bone = "#f4f1ea";
    const boneDim = "#c2beb2";
    const boneFaint = "#8a897f";
    const gold = "#d4a937";

    // Text contrast on cards (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneFaint, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(voidBg, gold)).toBeGreaterThanOrEqual(4.5); // Primary button text on gold

    // Non-text UI control boundary & focus indicator contrast (WCAG SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(voidLineStrong, voidRaised)).toBeGreaterThanOrEqual(3.0); // Print receipt button border
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(3.0); // Focus outline on card
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(3.0); // Focus outline on void background
  });
});
