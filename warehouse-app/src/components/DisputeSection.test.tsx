import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DisputeSection } from "./DisputeSection";
import type { CommitmentDetail } from "../api";
import * as wallet from "../wallet";
import { expectNoA11yViolations } from "../a11y";

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
    // Announced via role="alert", not just painted above the button the user just activated.
    expect(screen.getByRole("alert")).toHaveTextContent("User declined to sign");
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
    const { container } = render(
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
    // The propose button unmounts, so this live region is what tells a
    // screen-reader user the proposal went through.
    expect(screen.getByRole("status")).toHaveTextContent(/waiting for the other two parties to approve/i);
    const proposeCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/tx/resolve-dispute/propose") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(proposeCall).toBeDefined();
    expect(String(proposeCall?.[1]?.body)).toContain(baseCommitment.warehouse_operator);
    await expectNoA11yViolations(container);
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "FRESH_READY_XDR" })); // refresh-ready
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "SUCCESS", hash: "abc" })); // submitTx

    vi.mocked(wallet.signTransactionXdr).mockResolvedValueOnce("SIGNED_READY_XDR");
    const onDisputeChanged = vi.fn();

    const user = userEvent.setup();
    const { container } = render(
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
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("FRESH_READY_XDR", baseCommitment.cooperative);
    const submitCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/transactions/submit"));
    expect(submitCall).toBeDefined();
    expect(String(submitCall?.[1]?.body)).toContain("prop-1"); // completeProposalId included
    await expectNoA11yViolations(container);
  });

  describe("DisputeSection keyboard navigation (Issue #101)", () => {
    it("is fully keyboard operable: tab reaches the flag button directly, and the disputed-state propose button next", async () => {
      const user = userEvent.setup();
      const { container, rerender } = render(
        <DisputeSection
          commitment={baseCommitment}
          contractId="CXXX"
          walletAddress={baseCommitment.buyer}
          onDisputeChanged={vi.fn()}
        />,
      );

      // Flag state: exactly one control, and it's the first tab stop.
      const flag = await screen.findByRole("button", { name: "Flag a dispute" });
      await user.tab();
      expect(flag).toHaveFocus();
      await expectNoA11yViolations(container);

      // Disputed state: the frozen-status paragraph is not focusable, so the
      // propose button is the first (and only) tab stop -- no skipped stop
      // that silently swallows focus.
      fetchMock.mockResolvedValue(jsonResponse({ proposal: null }));
      rerender(
        <DisputeSection
          commitment={{ ...baseCommitment, status: "Disputed", dispute_pre_status: "Locked" }}
          contractId="CXXX"
          walletAddress={baseCommitment.buyer}
          onDisputeChanged={vi.fn()}
        />,
      );

      const propose = await screen.findByRole("button", { name: "Propose resolving this dispute" });
      flag.blur();
      await user.tab();
      expect(propose).toHaveFocus();
      await expectNoA11yViolations(container);
    });

    it("allows shift-tab backwards navigation without focus traps in pending approval state", async () => {
      const user = userEvent.setup();
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
      fetchMock.mockResolvedValue(jsonResponse({ proposal: pendingProposal }));

      const { container } = render(
        <DisputeSection
          commitment={disputed}
          contractId="CXXX"
          walletAddress={baseCommitment.buyer}
          onDisputeChanged={vi.fn()}
        />,
      );

      const approve = await screen.findByRole("button", { name: "Approve resolution" });
      await user.tab();
      expect(approve).toHaveFocus();

      await user.tab({ shift: true });
      expect(approve).not.toHaveFocus();
      await expectNoA11yViolations(container);
    });
  });

  describe("DisputeSection color contrast & ARIA labeling (Issue #102)", () => {
    it("announces error banners with role='alert' when actions fail", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: "UNSIGNED_FLAG_XDR" }));
      vi.mocked(wallet.signTransactionXdr).mockRejectedValueOnce(new Error("Transaction rejected by wallet"));

      const user = userEvent.setup();
      render(
        <DisputeSection
          commitment={baseCommitment}
          contractId="CXXX"
          walletAddress={baseCommitment.buyer}
          onDisputeChanged={vi.fn()}
        />,
      );

      const flag = await screen.findByRole("button", { name: "Flag a dispute" });
      await user.click(flag);

      const alert = await screen.findByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Transaction rejected by wallet");
    });

    it("announces status updates via role='status' live regions across proposal lifecycle", async () => {
      const disputed = { ...baseCommitment, status: "Disputed", dispute_pre_status: "Locked" };

      // 1. Proposer waiting for others
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
      fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: pendingProposal }));

      const { unmount } = render(
        <DisputeSection
          commitment={disputed}
          contractId="CXXX1"
          walletAddress={baseCommitment.warehouse_operator}
          onDisputeChanged={vi.fn()}
        />,
      );

      const proposerStatus = await screen.findByRole("status");
      expect(proposerStatus).toHaveTextContent(/waiting for the other two parties to approve/i);
      unmount();

      // 2. Pending signer viewing prompt
      fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: pendingProposal }));
      const { unmount: unmount2 } = render(
        <DisputeSection
          commitment={disputed}
          contractId="CXXX2"
          walletAddress={baseCommitment.buyer}
          onDisputeChanged={vi.fn()}
        />,
      );
      expect(await screen.findByRole("status")).toHaveTextContent(/party wants to resolve this dispute/i);
      unmount2();

      // 3. Ready proposal waiting for proposer
      const readyProposal = {
        ...pendingProposal,
        status: "ready",
        pending_entries: [],
      };
      fetchMock.mockResolvedValueOnce(jsonResponse({ proposal: readyProposal }));

      render(
        <DisputeSection
          commitment={disputed}
          contractId="CXXX3"
          walletAddress={baseCommitment.buyer}
          onDisputeChanged={vi.fn()}
        />,
      );
      expect(await screen.findByRole("status")).toHaveTextContent(/waiting for the proposer to finalize/i);
    });

    it("verifies contrast ratios meet WCAG AA requirements", () => {
      const lum = (hex: string) => {
        const rgb = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => parseInt(c, 16) / 255);
        const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrastRatio = (hex1: string, hex2: string) => {
        const [l1, l2] = [lum(hex1), lum(hex2)].sort((a, b) => b - a);
        return (l1 + 0.05) / (l2 + 0.05);
      };

      const voidBg = "#0b120f";
      const voidRaised = "#121a16";
      const bone = "#f3f1e9";
      const boneDim = "#c9c6ba";
      const voidLineStrong = "#5c6b62";

      // Text contrast on cards (WCAG AA: >= 4.5:1)
      expect(contrastRatio(bone, voidRaised)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(boneDim, voidRaised)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(bone, voidBg)).toBeGreaterThanOrEqual(4.5);

      // Secondary action button visual edge contrast (WCAG AA SC 1.4.11: >= 3.0:1)
      expect(contrastRatio(voidLineStrong, voidRaised)).toBeGreaterThanOrEqual(3.0);
      expect(contrastRatio(voidLineStrong, voidBg)).toBeGreaterThanOrEqual(3.0);
    });
  });
});
