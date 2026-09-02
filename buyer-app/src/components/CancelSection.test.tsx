import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CancelSection } from "./CancelSection";
import type { CommitmentDetail } from "../api";
import * as wallet from "../wallet";

// Same mocking shape as App.test.tsx -- no real Freighter extension exists
// in this environment; what's verified here is CancelSection's own
// propose/approve/finalize wiring, not Freighter itself.
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

describe("CancelSection", () => {
  it("renders nothing when no wallet is connected", () => {
    const { container } = render(
      <CancelSection commitment={baseCommitment} contractId="CXXX" walletAddress={null} onCancelled={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once the commitment is Delivered -- past cancel()'s reachable range", () => {
    const delivered = { ...baseCommitment, status: "Delivered" };
    const { container } = render(
      <CancelSection commitment={delivered} contractId="CXXX" walletAddress={baseCommitment.buyer} onCancelled={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a connected wallet that's neither the buyer nor the cooperative", () => {
    fetchMock.mockResolvedValue(jsonResponse({ proposal: null }));
    const { container } = render(
      <CancelSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress="GSOMEONE_UNRELATEDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
        onCancelled={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 'Cancel this commitment' when there's no active proposal, and proposing shows the waiting state", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: null })); // initial poll
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "prop-1",
        contract_id: "CXXX",
        proposer_address: baseCommitment.buyer,
        status: "pending",
        pending_entries: [{ address: baseCommitment.cooperative, entry_xdr: "ENTRY_XDR" }],
        ready_xdr: null,
      }),
    ); // proposeCancel response

    const user = userEvent.setup();
    render(
      <CancelSection commitment={baseCommitment} contractId="CXXX" walletAddress={baseCommitment.buyer} onCancelled={vi.fn()} />,
    );

    const proposeButton = await screen.findByRole("button", { name: "Cancel this commitment" });
    await user.click(proposeButton);

    expect(await screen.findByText(/waiting for the other party to approve/i)).toBeInTheDocument();
    const proposeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/tx/cancel/propose"));
    expect(proposeCall).toBeDefined();
  });

  it("shows an approve button when the connected wallet has a pending entry, and approving signs it via signAuthEntry", async () => {
    const pendingProposal = {
      id: "prop-1",
      contract_id: "CXXX",
      proposer_address: baseCommitment.buyer,
      status: "pending",
      pending_entries: [{ address: baseCommitment.cooperative, entry_xdr: "ENTRY_XDR" }],
      ready_xdr: null,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: pendingProposal })); // initial poll
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...pendingProposal, status: "ready", pending_entries: [], ready_xdr: "READY_XDR" }),
    ); // sign response, now ready

    vi.mocked(wallet.signAuthEntry).mockResolvedValueOnce("SIGNED_ENTRY_XDR");

    const user = userEvent.setup();
    render(
      <CancelSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress={baseCommitment.cooperative}
        onCancelled={vi.fn()}
      />,
    );

    const approveButton = await screen.findByRole("button", { name: "Approve cancellation" });
    await user.click(approveButton);

    expect(wallet.signAuthEntry).toHaveBeenCalledWith("ENTRY_XDR", baseCommitment.cooperative);
    // Now ready, but this viewer isn't the proposer -- they wait, they
    // don't get a Finalize button (only the proposer does).
    expect(await screen.findByText(/waiting for the proposer to finalize/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finalize cancellation" })).not.toBeInTheDocument();
  });

  it("shows a finalize button when ready and the connected wallet is the proposer, and finalizing signs + submits + calls onCancelled", async () => {
    const readyProposal = {
      id: "prop-1",
      contract_id: "CXXX",
      proposer_address: baseCommitment.buyer,
      status: "ready",
      pending_entries: [],
      ready_xdr: "READY_XDR",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: readyProposal })); // initial poll
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "abc" })); // submitTx

    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_READY_XDR");
    const onCancelled = vi.fn();

    const user = userEvent.setup();
    render(
      <CancelSection commitment={baseCommitment} contractId="CXXX" walletAddress={baseCommitment.buyer} onCancelled={onCancelled} />,
    );

    const finalizeButton = await screen.findByRole("button", { name: "Finalize cancellation" });
    await user.click(finalizeButton);

    await waitFor(() => expect(onCancelled).toHaveBeenCalled());
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("READY_XDR", baseCommitment.buyer);
    const submitCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/transactions/submit"));
    expect(submitCall).toBeDefined();
    expect(String(submitCall?.[1]?.body)).toContain("prop-1"); // completeProposalId included
  });

  it("shows an error banner, not a crash, if approving is rejected", async () => {
    const pendingProposal = {
      id: "prop-1",
      contract_id: "CXXX",
      proposer_address: baseCommitment.buyer,
      status: "pending",
      pending_entries: [{ address: baseCommitment.cooperative, entry_xdr: "ENTRY_XDR" }],
      ready_xdr: null,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: pendingProposal }));
    vi.mocked(wallet.signAuthEntry).mockRejectedValueOnce(new Error("User declined to sign"));

    const user = userEvent.setup();
    render(
      <CancelSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress={baseCommitment.cooperative}
        onCancelled={vi.fn()}
      />,
    );

    const approveButton = await screen.findByRole("button", { name: "Approve cancellation" });
    await user.click(approveButton);

    expect(await screen.findByText("User declined to sign")).toBeInTheDocument();
  });
});
