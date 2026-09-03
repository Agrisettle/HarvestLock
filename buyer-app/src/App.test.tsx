import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { CommitmentDetail, CommitmentSummary } from "./api";
import * as wallet from "./wallet";

// Mocked at the module boundary -- see coop-pwa's identical App.test.tsx
// comment for why (no real Freighter extension exists in this
// environment; what's verified here is App.tsx's own build/sign/submit
// wiring, not Freighter itself).
vi.mock("./wallet", () => ({
  connectWallet: vi.fn(),
  signTransactionXdr: vi.fn(),
}));

/**
 * Component-level tests, fetch mocked at the network boundary -- see
 * coop-pwa's identical suite for why that's the right kind of mock here
 * (App.tsx's own rendering logic, not the API integration, which is
 * already browser-verified).
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
  it("loads and renders 'what you've locked' on mount", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([summary]));
    render(<App />);

    expect(await screen.findByText(summary.contract_id)).toBeInTheDocument();
    expect(screen.getByText("What you've locked")).toBeInTheDocument();
  });

  it("shows an error banner, not a crash, when the list fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "db down" }, false));
    render(<App />);

    expect(await screen.findByText(/-> 500/)).toBeInTheDocument();
  });

  it("loads and renders buyer-framed detail when a cached row is clicked", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([summary]));
    fetchMock.mockResolvedValueOnce(jsonResponse(detail));
    const user = userEvent.setup();
    render(<App />);

    const row = await screen.findByText(summary.contract_id);
    await user.click(row);

    expect(await screen.findByText(/Pending: advance 1/)).toBeInTheDocument();
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

    expect(await screen.findByText(/Pending: advance 1/)).toBeInTheDocument();
  });

  it("locks a Draft commitment: build -> sign -> submit -> refresh, end to end through the app", async () => {
    const draftSummary = { ...summary, status: "Draft" };
    const draftDetail: CommitmentDetail = { ...detail, status: "Draft" };
    const lockedDetail: CommitmentDetail = { ...detail, status: "Locked" };

    fetchMock.mockResolvedValueOnce(jsonResponse([draftSummary])); // initial list
    fetchMock.mockResolvedValueOnce(jsonResponse(draftDetail)); // click row -> detail
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: null })); // CancelSection's background poll (Draft is cancellable)
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: null })); // ReassignBuyerSection's background poll (Draft is reassignable)
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_XDR" })); // buildTx
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "abc" })); // submitTx
    fetchMock.mockResolvedValueOnce(jsonResponse(lockedDetail)); // post-lock refresh
    // No second CancelSection/ReassignBuyerSection poll expected here: their
    // refresh()es are memoized on [contractId, cancellable]/[contractId,
    // reassignable], and Draft -> Locked doesn't change either (both are
    // cancellable/reassignable statuses), so the effects don't re-fire.

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(detail.buyer);
    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_XDR");

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByText(draftSummary.contract_id));
    await user.click(await screen.findByRole("button", { name: "Lock deposit" }));

    await waitFor(() => expect(screen.getByText("Locked")).toBeInTheDocument());
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_XDR", detail.buyer);

    const buildCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/tx/lock"));
    expect(buildCall).toBeDefined();
  });

  it("settles a Delivered commitment as a non-buyer, non-cooperative wallet (permissionless)", async () => {
    const deliveredSummary = { ...summary, status: "Delivered" };
    const deliveredDetail: CommitmentDetail = { ...detail, status: "Delivered" };
    const settledDetail: CommitmentDetail = { ...detail, status: "Settled" };
    const thirdPartyWallet = "GSOME_UNRELATED_THIRD_PARTY_WALLET";

    fetchMock.mockResolvedValueOnce(jsonResponse([deliveredSummary]));
    fetchMock.mockResolvedValueOnce(jsonResponse(deliveredDetail));
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_SETTLE_XDR" }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "def" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(settledDetail));

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(thirdPartyWallet);
    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_SETTLE_XDR");

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByText(deliveredSummary.contract_id));
    await user.click(await screen.findByRole("button", { name: "Settle" }));

    await waitFor(() => expect(screen.getByText("Settled")).toBeInTheDocument());
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_SETTLE_XDR", thirdPartyWallet);
  });

  it("shows an action error banner, not a crash, if signing is rejected", async () => {
    const draftSummary = { ...summary, status: "Draft" };
    const draftDetail: CommitmentDetail = { ...detail, status: "Draft" };

    fetchMock.mockResolvedValueOnce(jsonResponse([draftSummary]));
    fetchMock.mockResolvedValueOnce(jsonResponse(draftDetail));
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: null })); // CancelSection's background poll (Draft is cancellable)
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: null })); // ReassignBuyerSection's background poll (Draft is reassignable)
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_XDR" }));

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(detail.buyer);
    vi.mocked(wallet.signTransactionXdr).mockRejectedValueOnce(new Error("User declined to sign"));

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByText(draftSummary.contract_id));
    await user.click(await screen.findByRole("button", { name: "Lock deposit" }));

    expect(await screen.findByText("User declined to sign")).toBeInTheDocument();
  });

  it("creates a commitment: deploy -> build initialize -> sign -> submit -> loads it, end to end", async () => {
    const newContractId = "CBRANDNEWCOMMITMENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    const newDetail: CommitmentDetail = { ...detail, buyer: "GNEWBUYER", status: "Draft" };
    // Many user.type()/user.click() steps below -- the default 5s per-test
    // timeout is tight for that even without network variance, since this
    // is component-level (fetch-mocked), not live network. Generous
    // explicit timeout, same reasoning as stellar.test.ts's live tests.

    fetchMock.mockResolvedValueOnce(jsonResponse([])); // initial list
    fetchMock.mockResolvedValueOnce(jsonResponse({ contractId: newContractId })); // deployCommitment
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_INIT_XDR" })); // buildInitializeTx
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "xyz" })); // submitTx
    fetchMock.mockResolvedValueOnce(jsonResponse([])); // refreshList after create
    fetchMock.mockResolvedValueOnce(jsonResponse(newDetail)); // loadDetail(newContractId)

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce("GNEWBUYER");
    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_INIT_XDR");

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByRole("button", { name: "Create commitment" }));

    await user.type(screen.getByLabelText("Cooperative address"), "GCOOPADDR");
    await user.type(screen.getByLabelText("Warehouse operator address"), "GWHADDR");
    await user.type(screen.getByLabelText("Token contract address"), "CTOKENADDR");
    await user.type(screen.getByLabelText("Total amount (stroops)"), "1000000000");
    await user.clear(screen.getByLabelText("Advance 1 share (basis points)"));
    await user.type(screen.getByLabelText("Advance 1 share (basis points)"), "1500");
    await user.clear(screen.getByLabelText("Advance 2 share (basis points)"));
    await user.type(screen.getByLabelText("Advance 2 share (basis points)"), "2000");
    await user.clear(screen.getByLabelText("Claim window (seconds)"));
    await user.type(screen.getByLabelText("Claim window (seconds)"), "3600");
    await user.click(screen.getByRole("checkbox"));

    await user.click(screen.getByRole("button", { name: "Create commitment" }));

    expect(await screen.findByText(newContractId)).toBeInTheDocument();
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_INIT_XDR", "GNEWBUYER");

    const deployCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/commitments/deploy"));
    expect(deployCall).toBeDefined();
    const initCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/tx/initialize"));
    expect(initCall).toBeDefined();
    expect(String(initCall?.[1]?.body)).toContain("GNEWBUYER");
  }, 15_000);
});
