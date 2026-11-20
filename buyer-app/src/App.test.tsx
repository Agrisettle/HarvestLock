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

    expect(await screen.findByTitle(summary.contract_id)).toBeInTheDocument();
    expect(screen.getByText("What you've locked")).toBeInTheDocument();
  });

  it("shows loading and empty states while the commitments list is being fetched", async () => {
    let resolveList!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveList = resolve; }));
    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading your commitments");
    expect(screen.getByText("Look up a contract ID or select one of your commitments to view its details.")).toBeInTheDocument();

    resolveList(jsonResponse([]));
    expect(await screen.findByText(/Nothing locked yet/)).toBeInTheDocument();
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

    const row = await screen.findByTitle(summary.contract_id);
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

  it("names the commitment when a detail lookup fails before reaching the API", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    // Persistent rejection, not Once: api.ts's get() wraps fetch in
    // withRetry (retry.ts), so a single queued rejection is consumed by
    // attempt one and attempt two falls through to the unmocked fetch
    // (undefined), surfacing "Cannot read properties of undefined" instead
    // of the transport error this test means to assert. Rejection is what
    // fetch does on a transport-level failure, so that's what every
    // attempt should see — the same shape api/retry.test.ts uses for its
    // "persistent failure still surfaces" case.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Contract ID"), "CUNKNOWN");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    // withRetry's bounded backoff (500ms, 1s) means the error surfaces
    // after ~1.5s, past the default 1s findBy window. Timeout goes in
    // findBy's *third* argument (waitFor options) -- the second is query
    // options, where a timeout key is silently ignored.
    expect(await screen.findByRole("alert", {}, { timeout: 5_000 })).toHaveTextContent(
      "Unable to load commitment CUNKNOWN: Failed to fetch",
    );
  }, 15_000);

  it("shows a live loading state while a commitment lookup is pending", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Contract ID"), "CUNKNOWN");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Reading commitment CUNKNOWN from chain");
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
    await user.click(await screen.findByTitle(draftSummary.contract_id));
    await user.click(await screen.findByRole("button", { name: "Lock deposit" }));

    await waitFor(() => expect(screen.getByText("Locked")).toBeInTheDocument());
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_XDR", detail.buyer);

    const buildCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/tx/lock"));
    expect(buildCall).toBeDefined();
  });

  // Issue #40 finding F1: POST /transactions/submit answers 202
  // {status: "PENDING"} when confirmation outlives the API's 30 s poll.
  // That used to be treated as success: the app re-read the chain, got
  // Draft back, and showed no message, so the lock looked like a no-op
  // and the button came back for a second (doomed) submit.
  it("waits for a PENDING lock to confirm before refreshing, instead of silently showing Draft", async () => {
    const draftSummary = { ...summary, status: "Draft" };
    const draftDetail: CommitmentDetail = { ...detail, status: "Draft" };
    const lockedDetail: CommitmentDetail = { ...detail, status: "Locked" };

    fetchMock.mockResolvedValueOnce(jsonResponse([draftSummary])); // initial list
    fetchMock.mockResolvedValueOnce(jsonResponse(draftDetail)); // click row -> detail
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: null })); // CancelSection's background poll
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: null })); // ReassignBuyerSection's background poll
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_XDR" })); // buildTx
    fetchMock.mockResolvedValueOnce({ ...jsonResponse({ status: "PENDING", hash: "abc" }), status: 202 } as Response); // submitTx
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "abc" })); // GET /transactions/abc
    fetchMock.mockResolvedValueOnce(jsonResponse(lockedDetail)); // post-lock refresh

    vi.mocked(wallet.connectWallet).mockResolvedValueOnce(detail.buyer);
    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_XDR");

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByTitle(draftSummary.contract_id));
    await user.click(await screen.findByRole("button", { name: "Lock deposit" }));

    await waitFor(() => expect(screen.getByText("Locked")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/transactions/abc"))).toBe(true);
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
    await user.click(await screen.findByTitle(deliveredSummary.contract_id));
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
    await user.click(await screen.findByTitle(draftSummary.contract_id));
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
    await user.type(screen.getByLabelText("Total amount (USDC)"), "100");
    await user.clear(screen.getByLabelText("Advance 1 share (%)"));
    await user.type(screen.getByLabelText("Advance 1 share (%)"), "15");
    await user.clear(screen.getByLabelText("Advance 2 share (%)"));
    await user.type(screen.getByLabelText("Advance 2 share (%)"), "20");
    await user.clear(screen.getByLabelText("Claim window"));
    await user.type(screen.getByLabelText("Claim window"), "1");
    await user.selectOptions(screen.getByLabelText("Claim window unit"), "hours");
    await user.type(screen.getByLabelText(/Contracted quantity/), "1000");
    await user.click(screen.getByRole("checkbox", { name: /Roles & Responsibilities/ }));

    await user.click(screen.getByRole("button", { name: "Create commitment" }));

    expect(await screen.findByTitle(newContractId)).toBeInTheDocument();
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_INIT_XDR", "GNEWBUYER");

    const deployCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/commitments/deploy"));
    expect(deployCall).toBeDefined();
    const initCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/tx/initialize"));
    expect(initCall).toBeDefined();
    expect(String(initCall?.[1]?.body)).toContain("GNEWBUYER");
  }, 15_000);

  it("walks a multi-page list: a full first page, then 'Load more' for the next, control gone once exhausted", async () => {
    // Issue #226's point: the list no longer assumes one response holds
    // everything. 20 rows is exactly one full API page (App.tsx's
    // PAGE_SIZE), so the app must fetch what comes after instead of
    // rendering those 20 as the complete list.
    const fullPage = Array.from({ length: 20 }, (_, i) => ({
      ...summary,
      id: `row-${i}`,
      contract_id: `CPAGEBOUNDARY${i}`,
    }));
    const secondPage = [{ ...summary, id: "row-20", contract_id: "CPAGEBOUNDARY20" }];

    fetchMock.mockResolvedValueOnce(jsonResponse(fullPage)); // first page
    fetchMock.mockResolvedValueOnce(jsonResponse(secondPage)); // after Load more

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByTitle("CPAGEBOUNDARY0")).toBeInTheDocument();
    expect(screen.queryByTitle("CPAGEBOUNDARY20")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));

    // Appended, not replaced: page one's rows are still on screen.
    expect(await screen.findByTitle("CPAGEBOUNDARY20")).toBeInTheDocument();
    expect(screen.getByTitle("CPAGEBOUNDARY0")).toBeInTheDocument();
    // A short second page means exhausted, so the control goes away.
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();

    // The second request asked for the page after the 20 already loaded.
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("limit=20&offset=20");
  }, 15_000);
});
