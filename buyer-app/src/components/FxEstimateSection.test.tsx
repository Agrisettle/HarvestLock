import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FxEstimateSection } from "./FxEstimateSection";
import type { CommitmentDetail } from "../api";
import { expectNoA11yViolations } from "../a11y";

const CONTRACT_ID = "CDJGUBCZIDNNWXW2I5PQ6AIOTRR34ISWIZCUK2QDF5XURZANDAVJLMQY";

const base: CommitmentDetail = {
  status: "Locked",
  buyer: "GBUYER",
  cooperative: "GCOOP",
  warehouse_operator: "GWH",
  token: "CTOKEN",
  total_amount: "6500000000",
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

// The contract's own worked example: ₦1,000,000 at price 66_700_000_000
// (decimals 14) is 667 USDC; ±5% is 633.65 – 700.35.
const ngnConfig = {
  oracleContract: "CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W",
  priceAsset: "NGN",
  maxAgeSecs: "86400",
  denominatedAmount: "10000000000000",
};

function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FxEstimateSection", () => {
  it("renders nothing for a plain deal with no oracle config", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ config: null }));
    const { container } = render(<FxEstimateSection commitment={base} contractId={CONTRACT_ID} />);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows the live estimate as a ±5% range, labelled an estimate, assuming full delivery before delivery", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ config: ngnConfig }))
      .mockResolvedValueOnce(json({ price: "66700000000", timestamp: "1795000000" }));
    const { container } = render(<FxEstimateSection commitment={base} contractId={CONTRACT_ID} />);

    expect(await screen.findByText(/633\.65 – 700\.35/)).toBeInTheDocument();
    expect(screen.getByText(/assuming full delivery at the top grade/)).toBeInTheDocument();
    expect(screen.getByText("Estimate, not a quote.")).toBeInTheDocument();
    expect(screen.getByText(/±5%/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(`http://localhost:3000/commitments/${CONTRACT_ID}/oracle-rate`);
    await expectNoA11yViolations(container);
  });

  it("uses the real settlement_bps once delivered", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ config: ngnConfig }))
      .mockResolvedValueOnce(json({ price: "66700000000", timestamp: "1795000000" }));
    render(
      <FxEstimateSection commitment={{ ...base, status: "Delivered", settlement_bps: 9_000 }} contractId={CONTRACT_ID} />,
    );

    // 600.30 midpoint, ±5% -> 570.285 – 630.315
    expect(await screen.findByText(/570\.285 – 630\.315/)).toBeInTheDocument();
    expect(screen.getByText(/at the delivered quantity and grade/)).toBeInTheDocument();
  });

  it("says why there's no estimate when the oracle quote is stale, instead of showing a number", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ config: ngnConfig }))
      .mockResolvedValueOnce(json({ error: "OracleStale" }, 409));
    render(<FxEstimateSection commitment={base} contractId={CONTRACT_ID} />);

    expect(await screen.findByText(/Live NGN rate unavailable right now/)).toHaveTextContent("OracleStale");
    expect(screen.queryByText(/Estimate, not a quote/)).not.toBeInTheDocument();
  });

  it("shows the real resolved figure, with no live read, once fx_resolved", async () => {
    render(
      <FxEstimateSection
        commitment={{ ...base, status: "Delivered", fx_resolved: true, fx_adjusted_total: "6670000000", fx_shortfall_amount: "170000000" }}
        contractId={CONTRACT_ID}
      />,
    );

    expect(screen.getByText("667.00")).toBeInTheDocument();
    expect(screen.getByText(/FX shortfall to top up: 17\.00\./)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders nothing and reads nothing for a cancelled commitment", () => {
    const { container } = render(<FxEstimateSection commitment={{ ...base, status: "Cancelled" }} contractId={CONTRACT_ID} />);
    expect(container).toBeEmptyDOMElement();
    expect(fetch).not.toHaveBeenCalled();
  });
});
