import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationLedgerSection } from "./AllocationLedgerSection";
import type { CommitmentDetail } from "../api";
import * as wallet from "../wallet";

// Same mocking shape as CancelSection.test.tsx/ReassignBuyerSection.test.tsx
// -- no real Freighter extension exists in this environment; what's
// verified here is this component's own build/sign/submit wiring.
vi.mock("../wallet", () => ({
  signTransactionXdr: vi.fn(),
}));

const baseCommitment: CommitmentDetail = {
  status: "Draft",
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

// Mirrors api/src/server.ts's "let the contract error propagate"
// convention -- getAllocationLedger (api.ts) recognizes this exact shape
// and turns it into `null`, not a thrown error.
function allocationNotSetResponse() {
  return jsonResponse(
    { statusCode: 500, error: "Internal Server Error", message: "contract simulation failed for get_allocation: HostError: Error(Contract, #23)" },
    false,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(wallet.signTransactionXdr).mockReset();
});

describe("AllocationLedgerSection", () => {
  it("renders nothing for a non-cooperative viewer when no ledger has been set", async () => {
    fetchMock.mockResolvedValueOnce(allocationNotSetResponse());
    const { container } = render(
      <AllocationLedgerSection commitment={baseCommitment} contractId="CXXX" walletAddress={baseCommitment.buyer} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once the commitment is past Draft and no ledger exists -- set_allocation is pre-lock only", async () => {
    fetchMock.mockResolvedValueOnce(allocationNotSetResponse());
    const locked = { ...baseCommitment, status: "Locked" };
    const { container } = render(
      <AllocationLedgerSection commitment={locked} contractId="CXXX" walletAddress={baseCommitment.cooperative} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the record-allocation form for the cooperative pre-lock when no ledger has been set", async () => {
    fetchMock.mockResolvedValueOnce(allocationNotSetResponse());
    render(
      <AllocationLedgerSection commitment={baseCommitment} contractId="CXXX" walletAddress={baseCommitment.cooperative} />,
    );
    expect(await screen.findByText("Record member allocation")).toBeInTheDocument();
  });

  it("shows the recorded ledger (hashes + shares, never a phone number) once one exists, for any viewer", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ members: [{ memberHash: "abcdef0123456789", shareBps: 6000 }] }),
    );
    render(<AllocationLedgerSection commitment={baseCommitment} contractId="CXXX" walletAddress={null} />);

    expect(await screen.findByText("Allocation ledger")).toBeInTheDocument();
    expect(screen.getByText("60.00%")).toBeInTheDocument();
    expect(screen.getByText(/abcdef012345/)).toBeInTheDocument();
    expect(screen.queryByText("Record member allocation")).not.toBeInTheDocument();
  });

  it("adds and removes member rows", async () => {
    fetchMock.mockResolvedValueOnce(allocationNotSetResponse());
    const user = userEvent.setup();
    render(
      <AllocationLedgerSection commitment={baseCommitment} contractId="CXXX" walletAddress={baseCommitment.cooperative} />,
    );
    await screen.findByText("Record member allocation");

    expect(screen.getAllByLabelText(/phone number/i)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(screen.getAllByLabelText(/phone number/i)).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.getAllByLabelText(/phone number/i)).toHaveLength(1);

    // The last remaining row can't be removed -- set_allocation needs at
    // least one member, same reasoning as CreateCommitmentForm's grade
    // price schedule needing at least one entry.
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("rejects shares summing to over 10000 bps before touching the network", async () => {
    fetchMock.mockResolvedValueOnce(allocationNotSetResponse());
    const user = userEvent.setup();
    render(
      <AllocationLedgerSection commitment={baseCommitment} contractId="CXXX" walletAddress={baseCommitment.cooperative} />,
    );
    await screen.findByText("Record member allocation");

    await user.type(screen.getByLabelText("Member 1 phone number"), "+2348000000001");
    await user.type(screen.getByLabelText("Member 1 share (basis points)"), "6000");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Member 2 phone number"), "+2348000000002");
    await user.type(screen.getByLabelText("Member 2 share (basis points)"), "5000");

    await user.click(screen.getByRole("button", { name: "Record allocation" }));

    expect(await screen.findByText(/over the 10000 \(100%\) ceiling/)).toBeInTheDocument();
    // Only the initial allocation-ledger read should have hit the network --
    // validation failing client-side means set-allocation was never built.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds, signs, and submits set_allocation, then reloads the recorded ledger", async () => {
    fetchMock.mockResolvedValueOnce(allocationNotSetResponse()); // initial read
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        xdr: "UNSIGNED_SET_ALLOCATION_XDR",
        members: [{ phoneNumber: "+2348000000001", shareBps: 6000, salt: "abcd", memberHash: "feedface01234567" }],
      }),
    ); // buildSetAllocationTx
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "xyz" })); // submitTx
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ members: [{ memberHash: "feedface01234567", shareBps: 6000 }] }),
    ); // reload after submit

    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_SET_ALLOCATION_XDR");

    const user = userEvent.setup();
    render(
      <AllocationLedgerSection commitment={baseCommitment} contractId="CXXX" walletAddress={baseCommitment.cooperative} />,
    );
    await screen.findByText("Record member allocation");

    await user.type(screen.getByLabelText("Member 1 phone number"), "+2348000000001");
    await user.type(screen.getByLabelText("Member 1 share (basis points)"), "6000");
    await user.click(screen.getByRole("button", { name: "Record allocation" }));

    expect(await screen.findByText("Allocation ledger")).toBeInTheDocument();
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("UNSIGNED_SET_ALLOCATION_XDR", baseCommitment.cooperative);

    const buildCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/tx/set-allocation"));
    expect(buildCall).toBeDefined();
    expect(String(buildCall?.[1]?.body)).toContain("+2348000000001");

    const submitCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/transactions/submit"));
    expect(submitCall).toBeDefined();
    // The staged member (salt + memberHash) is passed back so the API can
    // persist the phone-number mapping now that the on-chain call landed.
    expect(String(submitCall?.[1]?.body)).toContain("feedface01234567");
  });

  it("shows an error banner, not a crash, if submitting is rejected", async () => {
    fetchMock.mockResolvedValueOnce(allocationNotSetResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        xdr: "UNSIGNED_SET_ALLOCATION_XDR",
        members: [{ phoneNumber: "+2348000000001", shareBps: 6000, salt: "abcd", memberHash: "feedface01234567" }],
      }),
    );
    vi.mocked(wallet.signTransactionXdr).mockRejectedValueOnce(new Error("User declined to sign"));

    const user = userEvent.setup();
    render(
      <AllocationLedgerSection commitment={baseCommitment} contractId="CXXX" walletAddress={baseCommitment.cooperative} />,
    );
    await screen.findByText("Record member allocation");

    await user.type(screen.getByLabelText("Member 1 phone number"), "+2348000000001");
    await user.type(screen.getByLabelText("Member 1 share (basis points)"), "6000");
    await user.click(screen.getByRole("button", { name: "Record allocation" }));

    expect(await screen.findByText("User declined to sign")).toBeInTheDocument();
  });
});
