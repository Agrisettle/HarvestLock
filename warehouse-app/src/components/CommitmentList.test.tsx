import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitmentList } from "./CommitmentList";
import type { CommitmentSummary } from "../api";

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