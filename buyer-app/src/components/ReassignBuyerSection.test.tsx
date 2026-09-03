import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReassignBuyerSection } from "./ReassignBuyerSection";
import type { CommitmentDetail } from "../api";
import * as wallet from "../wallet";

// Same mocking shape as CancelSection.test.tsx -- no real Freighter
// extension exists in this environment; what's verified here is
// ReassignBuyerSection's own propose/approve/finalize wiring, not
// Freighter itself.
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

const newBuyer = "GNEWBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

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

describe("ReassignBuyerSection", () => {
  it("renders nothing when no wallet is connected", () => {
    const { container } = render(
      <ReassignBuyerSection commitment={baseCommitment} contractId="CXXX" walletAddress={null} onReassigned={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once the commitment is Delivered -- past reassign_buyer()'s reachable range", () => {
    const delivered = { ...baseCommitment, status: "Delivered" };
    const { container } = render(
      <ReassignBuyerSection commitment={delivered} contractId="CXXX" walletAddress={baseCommitment.buyer} onReassigned={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a connected wallet that's neither the current buyer nor a pending signer", () => {
    fetchMock.mockResolvedValue(jsonResponse({ proposal: null }));
    const { container } = render(
      <ReassignBuyerSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress="GSOMEONE_UNRELATEDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
        onReassigned={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the propose form for the current buyer with no active proposal, and proposing shows the waiting state", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: null })); // initial poll
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "prop-1",
        contract_id: "CXXX",
        method: "reassign_buyer",
        proposer_address: baseCommitment.buyer,
        status: "pending",
        pending_entries: [
          { address: baseCommitment.cooperative, entry_xdr: "COOP_ENTRY_XDR" },
          { address: newBuyer, entry_xdr: "NEWBUYER_ENTRY_XDR" },
        ],
        ready_xdr: null,
      }),
    ); // proposeReassignBuyer response

    const user = userEvent.setup();
    render(
      <ReassignBuyerSection commitment={baseCommitment} contractId="CXXX" walletAddress={baseCommitment.buyer} onReassigned={vi.fn()} />,
    );

    const input = await screen.findByLabelText("Reassign to a new buyer");
    await user.type(input, newBuyer);
    await user.click(screen.getByRole("button", { name: "Propose reassignment" }));

    expect(await screen.findByText(/waiting for the cooperative and the new buyer to approve/i)).toBeInTheDocument();
    // Both the initial poll (GET) and the propose call (POST) hit the same
    // URL -- distinguish by method, not just the path.
    const proposeCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/tx/reassign-buyer/propose") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(proposeCall).toBeDefined();
    expect(String(proposeCall?.[1]?.body)).toContain(newBuyer);
  });

  it("shows an approve button for a pending signer, and approving signs via signAuthEntry then waits for the other signer", async () => {
    const pendingProposal = {
      id: "prop-1",
      contract_id: "CXXX",
      method: "reassign_buyer",
      proposer_address: baseCommitment.buyer,
      status: "pending",
      pending_entries: [
        { address: baseCommitment.cooperative, entry_xdr: "COOP_ENTRY_XDR" },
        { address: newBuyer, entry_xdr: "NEWBUYER_ENTRY_XDR" },
      ],
      ready_xdr: null,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: pendingProposal })); // initial poll
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...pendingProposal,
        status: "pending",
        pending_entries: [{ address: newBuyer, entry_xdr: "NEWBUYER_ENTRY_XDR" }],
      }),
    ); // sign response -- cooperative's entry no longer pending, still waiting on new buyer

    vi.mocked(wallet.signAuthEntry).mockResolvedValueOnce("SIGNED_COOP_ENTRY_XDR");

    const user = userEvent.setup();
    render(
      <ReassignBuyerSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress={baseCommitment.cooperative}
        onReassigned={vi.fn()}
      />,
    );

    const approveButton = await screen.findByRole("button", { name: "Approve reassignment" });
    await user.click(approveButton);

    expect(wallet.signAuthEntry).toHaveBeenCalledWith("COOP_ENTRY_XDR", baseCommitment.cooperative);
    // The server response no longer lists the cooperative in pending_entries
    // once they've signed -- `justApproved` local state is what keeps this
    // viewer in the "waiting" state instead of the component vanishing.
    expect(await screen.findByText(/waiting for the other party to approve too/i)).toBeInTheDocument();
  });

  it("shows a finalize button when ready and the connected wallet is the proposer, and finalizing signs + submits + calls onReassigned", async () => {
    const readyProposal = {
      id: "prop-1",
      contract_id: "CXXX",
      method: "reassign_buyer",
      proposer_address: baseCommitment.buyer,
      status: "ready",
      pending_entries: [],
      ready_xdr: "READY_XDR",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: readyProposal })); // initial poll
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "abc" })); // submitTx

    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_READY_XDR");
    const onReassigned = vi.fn();

    const user = userEvent.setup();
    render(
      <ReassignBuyerSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress={baseCommitment.buyer}
        onReassigned={onReassigned}
      />,
    );

    const finalizeButton = await screen.findByRole("button", { name: "Finalize reassignment" });
    await user.click(finalizeButton);

    await waitFor(() => expect(onReassigned).toHaveBeenCalled());
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("READY_XDR", baseCommitment.buyer);
    const submitCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/transactions/submit"));
    expect(submitCall).toBeDefined();
    expect(String(submitCall?.[1]?.body)).toContain("prop-1"); // completeProposalId included
  });

  it("shows an error banner, not a crash, if approving is rejected", async () => {
    const pendingProposal = {
      id: "prop-1",
      contract_id: "CXXX",
      method: "reassign_buyer",
      proposer_address: baseCommitment.buyer,
      status: "pending",
      pending_entries: [{ address: baseCommitment.cooperative, entry_xdr: "COOP_ENTRY_XDR" }],
      ready_xdr: null,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: pendingProposal }));
    vi.mocked(wallet.signAuthEntry).mockRejectedValueOnce(new Error("User declined to sign"));

    const user = userEvent.setup();
    render(
      <ReassignBuyerSection
        commitment={baseCommitment}
        contractId="CXXX"
        walletAddress={baseCommitment.cooperative}
        onReassigned={vi.fn()}
      />,
    );

    const approveButton = await screen.findByRole("button", { name: "Approve reassignment" });
    await user.click(approveButton);

    expect(await screen.findByText("User declined to sign")).toBeInTheDocument();
  });
});
