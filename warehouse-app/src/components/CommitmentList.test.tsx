import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitmentList } from "./CommitmentList";
import type { CommitmentSummary } from "../api";
import { expectNoA11yViolations } from "../a11y";

const summary: CommitmentSummary = {
  id: "row-1",
  contract_id: "CONTRACT-1",
  buyer_address: "GBUYER",
  cooperative_address: "GCOOP",
  warehouse_address: "GWH",
  token_address: "CTOKEN",
  total_amount: "1000000000",
  advance1_bps: 1500,
  advance2_bps: 2000,
  claim_window_secs: "3600",
  status: "Locked",
  created_at: "2026-09-01T06:49:56.733Z",
  updated_at: "2026-09-01T06:50:23.319Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CommitmentList CSV export", () => {
  it("downloads all summary fields as CSV", async () => {
    let exportedBlob: Blob | null = null;
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        exportedBlob = blob;
        return "blob:commitments";
      },
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<CommitmentList commitments={[summary]} onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(exportedBlob).not.toBeNull();
    const csv = await exportedBlob!.text();
    expect(csv.split("\r\n")[0]).toBe('"id","contract_id","buyer_address","cooperative_address","warehouse_address","token_address","total_amount","advance1_bps","advance2_bps","claim_window_secs","status","created_at","updated_at"');
    expect(csv.split("\r\n")[1]).toBe('"row-1","CONTRACT-1","GBUYER","GCOOP","GWH","CTOKEN","1000000000","1500","2000","3600","Locked","2026-09-01T06:49:56.733Z","2026-09-01T06:50:23.319Z"');
  });
});

describe("CommitmentList keyboard navigation audit (Issue #97)", () => {
  it("renders interactive elements with explicit type='button'", () => {
    render(<CommitmentList commitments={[summary]} onSelect={vi.fn()} />);
    const csvBtn = screen.getByRole("button", { name: "Download CSV" });
    expect(csvBtn).toHaveAttribute("type", "button");

    const rowBtn = screen.getByRole("button", { name: /CONT…CT-1.*Locked/i });
    expect(rowBtn).toHaveAttribute("type", "button");
  });

  it("allows sequential keyboard tab navigation without focus traps", async () => {
    const user = userEvent.setup();
    const summary2: CommitmentSummary = {
      ...summary,
      id: "row-2",
      contract_id: "CONTRACT-2",
    };
    render(<CommitmentList commitments={[summary, summary2]} onSelect={vi.fn()} />);

    const csvBtn = screen.getByRole("button", { name: "Download CSV" });
    const [row1, row2] = screen.getAllByRole("button", { name: /CONT…CT-.*Locked/i });

    await user.tab();
    expect(csvBtn).toHaveFocus();

    await user.tab();
    expect(row1).toHaveFocus();

    await user.tab();
    expect(row2).toHaveFocus();
  });

  it("activates commitment selection via keyboard (Enter/Space)", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CommitmentList commitments={[summary]} onSelect={onSelect} />);

    await user.tab(); // to CSV button
    await user.tab(); // to row button

    const rowBtn = screen.getByRole("button", { name: /CONT…CT-1.*Locked/i });
    expect(rowBtn).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(summary.contract_id);
  });

  it("passes axe accessibility checks without violations", async () => {
    const { container } = render(<CommitmentList commitments={[summary]} onSelect={vi.fn()} />);
    await expectNoA11yViolations(container);
  });
});

describe("CommitmentList color contrast & ARIA labeling (Issue #98)", () => {
  it("structures commitment list with role='list' and role='listitem' semantics", () => {
    render(<CommitmentList commitments={[summary]} onSelect={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Commitments" });
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
  });

  it("provides accessible status announcements on empty state", () => {
    render(<CommitmentList commitments={[]} onSelect={vi.fn()} />);
    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent(/nothing to attest yet/i);
  });

  it("provides clear accessible names with status and full contract ID for screen readers", () => {
    render(<CommitmentList commitments={[summary]} onSelect={vi.fn()} />);
    const button = screen.getByRole("button", { name: /CONT…CT-1.*status Locked, contract ID CONTRACT-1/i });
    expect(button).toBeInTheDocument();
  });

  it("verifies contrast ratios meet WCAG AA requirements for CommitmentList styling tokens", () => {
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
    const pine = "#1e6b4e";
    const gold = "#d4a937";
    const goldBright = "#eec765";

    // Text contrast (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneFaint, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(bone, pine)).toBeGreaterThanOrEqual(4.5); // "Download CSV" text on pine button
    expect(contrastRatio(goldBright, voidRaised)).toBeGreaterThanOrEqual(4.5); // Locked badge text

    // Non-text UI control boundary & focus indicator contrast (WCAG SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(voidLineStrong, voidRaised)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(voidLineStrong, voidBg)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(3.0);
  });
});
