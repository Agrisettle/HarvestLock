import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { CommitmentDetail, CommitmentSummary } from "./api";
import * as wallet from "./wallet";

// Mocked at the module boundary -- see buyer-app/coop-pwa's identical
// App.test.tsx comment for why (no real Freighter extension exists in
// this environment; what's verified here is App.tsx's own build/sign/
// submit wiring, not Freighter itself).
vi.mock("./wallet", () => ({
  connectWallet: vi.fn(),
  signTransactionXdr: vi.fn(),
}));

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
  status: "Advance1Released",
  created_at: "2026-09-01T06:49:56.733Z",
  updated_at: "2026-09-01T06:50:23.319Z",
};

const detail: CommitmentDetail = {
  status: "Advance1Released",
  buyer: "GBUYER",
  cooperative: "GCOOP",
  warehouse_operator: "GWH",
  token: "CTOKEN",
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

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(wallet.connectWallet).mockReset();
  vi.mocked(wallet.signTransactionXdr).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("loads and renders 'Commitments to attest' on mount", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([summary]));
    render(<App />);

    expect(await screen.findByTitle(summary.contract_id)).toBeInTheDocument();
    expect(screen.getByText("Commitments to attest")).toBeInTheDocument();
  });

  it("shows an error banner, not a crash, when the list fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "db down" }, false));
    render(<App />);

    expect(await screen.findByText(/-> 500/)).toBeInTheDocument();
  });

  it("loads detail when a cached row is clicked", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([summary]));
    fetchMock.mockResolvedValueOnce(jsonResponse(detail));
    const user = userEvent.setup();
    render(<App />);

    const row = await screen.findByTitle(summary.contract_id);
    await user.click(row);

    expect(await screen.findByRole("button", { name: "Mark mid-season checkpoint" })).toBeInTheDocument();
  });

  it("looks up a typed-in contract ID via the form, not just cached rows", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(jsonResponse(detail));
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Contract ID");
    await user.type(input, "CDJGUBCZIDNNWXW2I5PQ6AIOTRR34ISWIZCUK2QDF5XURZANDAVJLMQY");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByRole("button", { name: "Mark mid-season checkpoint" })).toBeInTheDocument();
  });

  it("marks the checkpoint: build -> sign -> submit -> refresh, end to end through the app", async () => {
    const checkpointedDetail: CommitmentDetail = { ...detail, status: "CheckpointPassed" };

    fetchMock.mockResolvedValueOnce(jsonResponse([summary])); // initial list
    fetchMock.mockResolvedValueOnce(jsonResponse(detail)); // click row -> detail
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_XDR" })); // buildTx
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "abc" })); // submitTx
    fetchMock.mockResolvedValueOnce(jsonResponse(checkpointedDetail)); // post-checkpoint refresh

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(detail.warehouse_operator);
    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_XDR");

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByTitle(summary.contract_id));
    await user.click(await screen.findByRole("button", { name: "Mark mid-season checkpoint" }));

    await waitFor(() => expect(screen.getByText("CheckpointPassed")).toBeInTheDocument());
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_XDR", detail.warehouse_operator);

    const buildCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/tx/mark_checkpoint"));
    expect(buildCall).toBeDefined();
  });

  it("confirms delivery: build -> sign -> submit -> refresh, end to end through the app", async () => {
    const readyDetail: CommitmentDetail = { ...detail, status: "ReadyForDelivery", remainder_funded: true };
    const deliveredDetail: CommitmentDetail = {
      ...readyDetail,
      status: "Delivered",
      delivered_quantity: 900,
      grade_index: 1,
      settlement_bps: 8_100,
    };
    const readySummary: CommitmentSummary = { ...summary, status: "ReadyForDelivery" };

    fetchMock.mockResolvedValueOnce(jsonResponse([readySummary])); // initial list
    fetchMock.mockResolvedValueOnce(jsonResponse(readyDetail)); // click row -> detail
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_DELIVERY_XDR" })); // buildConfirmDeliveryTx
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "def" })); // submitTx
    fetchMock.mockResolvedValueOnce(jsonResponse(deliveredDetail)); // post-confirm refresh

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(detail.warehouse_operator);
    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_DELIVERY_XDR");

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByTitle(readySummary.contract_id));
    await user.clear(screen.getByLabelText("Delivered quantity"));
    await user.type(screen.getByLabelText("Delivered quantity"), "900");
    await user.selectOptions(screen.getByLabelText("Grade"), "1");
    await user.click(screen.getByRole("button", { name: "Confirm delivery" }));

    await waitFor(() => expect(screen.getByText("Delivered")).toBeInTheDocument());
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_DELIVERY_XDR", detail.warehouse_operator);

    const confirmCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/tx/confirm-delivery"));
    expect(confirmCall).toBeDefined();
    expect(String(confirmCall?.[1]?.body)).toContain('"deliveredQuantity":900');
    expect(String(confirmCall?.[1]?.body)).toContain('"gradeIndex":1');
  });

  it("shows an action error banner, not a crash, if signing is rejected", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([summary]));
    fetchMock.mockResolvedValueOnce(jsonResponse(detail));
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_XDR" }));

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(detail.warehouse_operator);
    vi.mocked(wallet.signTransactionXdr).mockRejectedValueOnce(new Error("User declined to sign"));

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByTitle(summary.contract_id));
    await user.click(await screen.findByRole("button", { name: "Mark mid-season checkpoint" }));

    expect(await screen.findByText("User declined to sign")).toBeInTheDocument();
  });
});
