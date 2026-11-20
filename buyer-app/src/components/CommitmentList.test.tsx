import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitmentList } from "./CommitmentList";
import type { CommitmentSummary } from "../api";

const summary: CommitmentSummary = {
  id: "row-1",
  contract_id: "CDJGUBCZIDNNWXW2I5PQ6AIOTRR34ISWIZCUK2QDF5XURZANDAVJLMQY",
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

describe("CommitmentList", () => {
  it("renders a loading state while the list request is in flight", () => {
    render(<CommitmentList commitments={[]} loading onSelect={vi.fn()} />);

    expect(screen.getByText("Loading commitments…")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing locked yet/)).not.toBeInTheDocument();
  });

  it("renders the specific request failure, not a generic message, when the list request fails", () => {
    const failure = '/commitments -> 500: {"statusCode":500,"message":"connection refused"}';
    render(<CommitmentList commitments={[]} error={failure} onSelect={vi.fn()} />);

    expect(screen.getByText(failure)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing locked yet/)).not.toBeInTheDocument();
  });

  it("renders the empty state when the request succeeded and there is genuinely nothing yet", () => {
    render(<CommitmentList commitments={[]} onSelect={vi.fn()} />);

    expect(screen.getByText(/Nothing locked yet/)).toBeInTheDocument();
    expect(screen.queryByText("Loading commitments…")).not.toBeInTheDocument();
  });

  it("renders rows and reports the clicked contract ID", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CommitmentList commitments={[summary]} onSelect={onSelect} />);

    await user.click(screen.getByTitle(summary.contract_id));

    expect(onSelect).toHaveBeenCalledWith(summary.contract_id);
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("downloads all summary fields as safely escaped CSV", async () => {
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
    const exportSummary = {
      ...summary,
      contract_id: '=HYPERLINK("http://bad")',
      buyer_address: 'Buyer, "A"',
    };
    render(<CommitmentList commitments={[exportSummary]} onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(exportedBlob).not.toBeNull();
    expect(await exportedBlob!.text()).toBe([
      '"id","contract_id","buyer_address","cooperative_address","warehouse_address","token_address","total_amount","advance1_bps","advance2_bps","claim_window_secs","status","created_at","updated_at"',
      '"row-1","\'=HYPERLINK(""http://bad"")","Buyer, ""A""","GCOOP","GWH","CTOKEN","1000000000","1500","2000","3600","Locked","2026-09-01T06:49:56.733Z","2026-09-01T06:50:23.319Z"',
    ].join("\r\n"));
  });

  it("offers 'Load more' only while the caller says another page may exist, and asks for it on click", async () => {
    const onLoadMore = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <CommitmentList commitments={[summary]} onSelect={vi.fn()} hasMore onLoadMore={onLoadMore} />,
    );

    const button = screen.getByRole("button", { name: "Load more" });
    await user.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Short page / exhausted: the caller flips hasMore off and the
    // control disappears rather than offering an empty next fetch.
    rerender(<CommitmentList commitments={[summary]} onSelect={vi.fn()} hasMore={false} onLoadMore={onLoadMore} />);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("disables 'Load more' and says so while the next page is in flight", () => {
    render(
      <CommitmentList
        commitments={[summary]}
        onSelect={vi.fn()}
        hasMore
        loadingMore
        onLoadMore={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Loading more…" });
    expect(button).toBeDisabled();
  });
});

describe("CommitmentList keyboard navigation & accessibility (Issue #71)", () => {
  it("renders all buttons with explicit type='button' and proper aria-busy attributes", () => {
    const { rerender } = render(
      <CommitmentList commitments={[summary]} onSelect={vi.fn()} hasMore loadingMore={false} onLoadMore={vi.fn()} />,
    );
    const csvButton = screen.getByRole("button", { name: "Download CSV" });
    expect(csvButton).toHaveAttribute("type", "button");

    const rowButton = screen.getByRole("button", {
      name: `Commitment ${summary.contract_id}, status: ${summary.status}`,
    });
    expect(rowButton).toHaveAttribute("type", "button");

    const loadMoreButton = screen.getByRole("button", { name: "Load more" });
    expect(loadMoreButton).toHaveAttribute("type", "button");
    expect(loadMoreButton).toHaveAttribute("aria-busy", "false");

    rerender(
      <CommitmentList commitments={[summary]} onSelect={vi.fn()} hasMore loadingMore={true} onLoadMore={vi.fn()} />,
    );
    const busyLoadMore = screen.getByRole("button", { name: "Loading more…" });
    expect(busyLoadMore).toHaveAttribute("aria-busy", "true");
  });
});

describe("CommitmentList color contrast & ARIA labeling (Issue #72)", () => {
  it("provides live region announcements on loading and error states", () => {
    const { rerender } = render(<CommitmentList commitments={[]} loading onSelect={vi.fn()} />);
    const loadingState = screen.getByRole("status");
    expect(loadingState).toHaveAttribute("aria-live", "polite");
    expect(loadingState).toHaveTextContent("Loading commitments…");

    rerender(<CommitmentList commitments={[]} error="Failed to fetch commitments" onSelect={vi.fn()} />);
    const errorState = screen.getByRole("alert");
    expect(errorState).toHaveTextContent("Failed to fetch commitments");
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
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const pine = "#1e6b4e";
    const gold = "#d4a937";
    const goldBright = "#eec765";

    // Text contrast (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(bone, pine)).toBeGreaterThanOrEqual(4.5); // "Download CSV" / "Load more" text on pine button
    expect(contrastRatio(goldBright, voidRaised)).toBeGreaterThanOrEqual(4.5); // Locked badge text

    // Non-text UI boundary / focus ring contrast (WCAG AA SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(gold, voidBg)).toBeGreaterThanOrEqual(3.0); // commitment-row hover/focus ring
    expect(contrastRatio(gold, voidRaised)).toBeGreaterThanOrEqual(3.0);
  });
});
