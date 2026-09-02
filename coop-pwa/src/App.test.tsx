import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { CommitmentDetail, CommitmentSummary } from "./api";
import * as wallet from "./wallet";

// wallet.ts talks to the real Freighter browser extension, which doesn't
// exist in this test environment (and can't be meaningfully faked the
// way fetch can — there's no real signer to fake signing with). Mocked
// at the module boundary; what these tests verify is App.tsx's own
// build -> sign -> submit -> refresh wiring, not Freighter itself, which
// hasn't been verified against a real installed extension in this
// session — see coop-pwa/README.md.
vi.mock("./wallet", () => ({
  connectWallet: vi.fn(),
  signTransactionXdr: vi.fn(),
}));

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
  vi.mocked(wallet.connectWallet).mockReset();
  vi.mocked(wallet.signTransactionXdr).mockReset();
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

  it("connects a wallet and shows its truncated address instead of the connect button", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(detail.cooperative);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: "Connect wallet" });
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));

    expect(await screen.findByText("GCOO…COOP")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect wallet" })).not.toBeInTheDocument();
  });

  it("shows a wallet error banner, not a crash, if connecting fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    vi.mocked(wallet.connectWallet).mockRejectedValueOnce(new Error("User declined access"));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));

    expect(await screen.findByText("User declined access")).toBeInTheDocument();
  });

  it("claims an open tranche: build -> sign -> submit -> refresh, end to end through the app", async () => {
    const openDetail: CommitmentDetail = { ...detail, advance1_deadline: String(Math.floor(Date.now() / 1000) + 3600) };
    const claimedDetail: CommitmentDetail = { ...openDetail, advance1_claimed: true };

    fetchMock.mockResolvedValueOnce(jsonResponse([summary])); // initial list
    fetchMock.mockResolvedValueOnce(jsonResponse(openDetail)); // click row -> detail
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_XDR" })); // buildTx
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "abc" })); // submitTx
    fetchMock.mockResolvedValueOnce(jsonResponse(claimedDetail)); // post-claim refresh

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(detail.cooperative);
    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_XDR");

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByText(summary.contract_id));
    await user.click(await screen.findByRole("button", { name: "Claim" }));

    expect(await screen.findByText("claimed")).toBeInTheDocument();
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_XDR", detail.cooperative);

    const buildCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/tx/claim_advance_1"));
    expect(buildCall).toBeDefined();
    const submitCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/transactions/submit"));
    expect(submitCall?.[1]?.body).toContain("SIGNED_XDR");
  });

  it("shows a claim error banner, not a crash, if signing is rejected", async () => {
    const openDetail: CommitmentDetail = { ...detail, advance1_deadline: String(Math.floor(Date.now() / 1000) + 3600) };

    fetchMock.mockResolvedValueOnce(jsonResponse([summary]));
    fetchMock.mockResolvedValueOnce(jsonResponse(openDetail));
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_XDR" }));

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(detail.cooperative);
    vi.mocked(wallet.signTransactionXdr).mockRejectedValueOnce(new Error("User declined to sign"));

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByText(summary.contract_id));
    await user.click(await screen.findByRole("button", { name: "Claim" }));

    expect(await screen.findByText("User declined to sign")).toBeInTheDocument();
  });
});
