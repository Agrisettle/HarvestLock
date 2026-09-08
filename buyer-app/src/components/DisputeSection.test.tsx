import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DisputeSection } from "./DisputeSection";
import type { CommitmentDetail } from "../api";
import * as wallet from "../wallet";

// Same mocking shape as CancelSection.test.tsx/ReassignBuyerSection.test.tsx
// -- no real Freighter extension exists in this environment; what's
// verified here is DisputeSection's own flag / propose / approve /
// finalize wiring, not Freighter itself.
vi.mock("../wallet", () => ({
  signAuthEntry: vi.fn(),
  signTransactionXdr: vi.fn(),
}));

const baseCommitment: CommitmentDetail = {
  status: "Locked",
  buyer: "GBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  cooperative: "GCOOPXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  warehouse_operator: "GWHXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  token: "CTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
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
  vi.mocked(wallet.signAuthEntry).mockReset();
  vi.mocked(wallet.signTransactionXdr).mockReset();
});

describe("DisputeSection", () => {
  it("renders nothing when no wallet is connected", () => {
    const { container } = render(
      <DisputeSection commitment={baseCommitment} contractId="CXXX" walletAddress={null} onDisputeChanged={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a connected wallet that isn't a party to the commitment", () => {
    const { container } = render(
      <DisputeSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress="GSOMEONE_UNRELATEDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
        onDisputeChanged={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while Draft -- flag_dispute()'s reachable range starts at Locked", () => {
    const draft = { ...baseCommitment, status: "Draft" };
    const { container } = render(
      <DisputeSection commitment={draft} contractId="CXXX" walletAddress={baseCommitment.buyer} onDisputeChanged={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the flag button for the warehouse operator too, not just buyer/cooperative", async () => {
    render(
      <DisputeSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress={baseCommitment.warehouse_operator}
        onDisputeChanged={vi.fn()}
      />,
    );
    expect(await screen.findByRole("button", { name: "Flag a dispute" })).toBeInTheDocument();
  });

  it("flagging builds, signs, and submits, then calls onDisputeChanged", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_FLAG_XDR" })); // buildFlagDisputeTx
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "abc" })); // submitTx
    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_FLAG_XDR");
    const onDisputeChanged = vi.fn();

    const user = userEvent.setup();
    render(
      <DisputeSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress={baseCommitment.cooperative}
        onDisputeChanged={onDisputeChanged}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Flag a dispute" }));

    await waitFor(() => expect(onDisputeChanged).toHaveBeenCalled());
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_FLAG_XDR", baseCommitment.cooperative);
    const buildCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/tx/flag-dispute"));
    expect(buildCall).toBeDefined();
    expect(String(buildCall?.[1]?.body)).toContain(baseCommitment.cooperative);
  });

  it("shows an error banner, not a crash, if flagging is rejected", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_FLAG_XDR" }));
    vi.mocked(wallet.signTransactionXdr).mockRejectedValueOnce(new Error("User declined to sign"));

    const user = userEvent.setup();
    render(
      <DisputeSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress={baseCommitment.buyer}
        onDisputeChanged={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Flag a dispute" }));
    expect(await screen.findByText("User declined to sign")).toBeInTheDocument();
  });

  it("once Disputed, shows the frozen message and a propose-resolution button, and proposing shows the waiting state", async () => {
    const disputed = { ...baseCommitment, status: "Disputed", dispute_pre_status: "Locked" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: null })); // initial poll
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "prop-1",
        contract_id: "CXXX",
        method: "resolve_dispute",
        proposer_address: baseCommitment.warehouse_operator,
        status: "pending",
        pending_entries: [
          { address: baseCommitment.buyer, entry_xdr: "BUYER_ENTRY_XDR" },
          { address: baseCommitment.cooperative, entry_xdr: "COOP_ENTRY_XDR" },
        ],
        ready_xdr: null,
      }),
    ); // proposeResolveDispute response

    const user = userEvent.setup();
    render(
      <DisputeSection
        commitment={disputed}
        contractId="CXXX"
        walletAddress={baseCommitment.warehouse_operator}
        onDisputeChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText(/every other action is frozen until it's resolved/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Propose resolving this dispute" }));

    expect(await screen.findByText(/waiting for the other two parties to approve/i)).toBeInTheDocument();
    const proposeCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/tx/resolve-dispute/propose") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(proposeCall).toBeDefined();
    expect(String(proposeCall?.[1]?.body)).toContain(baseCommitment.warehouse_operator);
  });

  it("shows an approve button for a pending signer, and approving signs via signAuthEntry then waits for the remaining party", async () => {
    const disputed = { ...baseCommitment, status: "Disputed", dispute_pre_status: "Locked" };
    const pendingProposal = {
      id: "prop-1",
      contract_id: "CXXX",
      method: "resolve_dispute",
      proposer_address: baseCommitment.warehouse_operator,
      status: "pending",
      pending_entries: [
        { address: baseCommitment.buyer, entry_xdr: "BUYER_ENTRY_XDR" },
        { address: baseCommitment.cooperative, entry_xdr: "COOP_ENTRY_XDR" },
      ],
      ready_xdr: null,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: pendingProposal })); // initial poll
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...pendingProposal,
        pending_entries: [{ address: baseCommitment.cooperative, entry_xdr: "COOP_ENTRY_XDR" }],
      }),
    ); // sign response -- buyer's entry no longer pending, still waiting on cooperative

    vi.mocked(wallet.signAuthEntry).mockResolvedValueOnce("SIGNED_BUYER_ENTRY_XDR");

    const user = userEvent.setup();
    render(
      <DisputeSection
        commitment={disputed}
        contractId="CXXX"
        walletAddress={baseCommitment.buyer}
        onDisputeChanged={vi.fn()}
      />,
    );

    const approveButton = await screen.findByRole("button", { name: "Approve resolution" });
    await user.click(approveButton);

    expect(wallet.signAuthEntry).toHaveBeenCalledWith("BUYER_ENTRY_XDR", baseCommitment.buyer);
    expect(await screen.findByText(/waiting for the remaining party to approve too/i)).toBeInTheDocument();
  });

  it("shows a finalize button when ready and the connected wallet is the proposer, and finalizing signs + submits + calls onDisputeChanged", async () => {
    const disputed = { ...baseCommitment, status: "Disputed", dispute_pre_status: "Locked" };
    const readyProposal = {
      id: "prop-1",
      contract_id: "CXXX",
      method: "resolve_dispute",
      proposer_address: baseCommitment.cooperative,
      status: "ready",
      pending_entries: [],
      ready_xdr: "READY_XDR",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: readyProposal })); // initial poll
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "abc" })); // submitTx

    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_READY_XDR");
    const onDisputeChanged = vi.fn();

    const user = userEvent.setup();
    render(
      <DisputeSection
        commitment={disputed}
        contractId="CXXX"
        walletAddress={baseCommitment.cooperative}
        onDisputeChanged={onDisputeChanged}
      />,
    );

    const finalizeButton = await screen.findByRole("button", { name: "Finalize resolution" });
    await user.click(finalizeButton);

    await waitFor(() => expect(onDisputeChanged).toHaveBeenCalled());
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("READY_XDR", baseCommitment.cooperative);
    const submitCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/transactions/submit"));
    expect(submitCall).toBeDefined();
    expect(String(submitCall?.[1]?.body)).toContain("prop-1"); // completeProposalId included
  });
});
