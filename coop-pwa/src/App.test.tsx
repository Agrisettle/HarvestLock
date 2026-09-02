import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { CommitmentDetail, CommitmentSummary } from "./api";

/**
 * Component-level tests, fetch mocked at the network boundary. This is a
 * different kind of test than api/'s "no mocks" testnet suite -- there,
 * mocking the chain would mean never verifying the real SDK usage, which
 * is the whole point of that suite. Here, the real API integration is
 * already verified (this session's browser checks); what these tests
 * verify is App.tsx's own logic -- does it render the right thing given
 * a response, does an error surface as a banner instead of a crash --
 * which doesn't need a live network call to check.
 */

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

const detail: CommitmentDetail = {
  status: "Locked",
  buyer: "GBUYER",
  cooperative: "GCOOP",
  warehouse_operator: "GWH",
  token: "CTOKEN",
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("loads and renders the cached commitment list on mount", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([summary]));
    render(<App />);

    expect(await screen.findByText(summary.contract_id)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/commitments"));
  });

  it("shows an error banner, not a crash, when the list fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "db down" }, false));
    render(<App />);

    expect(await screen.findByText(/-> 500/)).toBeInTheDocument();
  });

  it("loads and renders detail when a cached row is clicked", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([summary])); // initial list
    fetchMock.mockResolvedValueOnce(jsonResponse(detail)); // detail on click
    const user = userEvent.setup();
    render(<App />);

    const row = await screen.findByText(summary.contract_id);
    await user.click(row);

    expect(await screen.findByText("15.00%")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining(`/commitments/${summary.contract_id}`),
    );
  });

  it("looks up a typed-in contract ID via the form, not just cached rows", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([])); // empty initial list
    fetchMock.mockResolvedValueOnce(jsonResponse(detail)); // typed lookup
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Contract ID");
    await user.type(input, "CDJGUBCZIDNNWXW2I5PQ6AIOTRR34ISWIZCUK2QDF5XURZANDAVJLMQY");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByText("15.00%")).toBeInTheDocument();
  });
});
