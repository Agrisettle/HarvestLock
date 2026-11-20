import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KybSection } from "./KybSection";
import * as wallet from "../wallet";

// No real Freighter or anchor here. What's tested is KybSection's own
// challenge → sign → verify → refresh wiring and what it tells the buyer.
vi.mock("../wallet", () => ({
  signTransactionXdr: vi.fn(),
}));

const BUYER = "GBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const ANCHOR = "testanchor.stellar.org";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

const unverified = { account: BUYER, verified: false, current: null, latest: null };
const accepted = {
  account: BUYER,
  anchor_domain: ANCHOR,
  sep12_status: "ACCEPTED",
  sep12_customer_id: "c1",
  checked_at: "2026-11-20T00:00:00.000Z",
  expires_at: "2027-05-21T00:00:00.000Z",
};

function routeFetch(routes: Record<string, unknown | (() => unknown)>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => {
      const [method, path] = k.split(" ");
      return (init?.method ?? "GET") === method && url.includes(path!);
    });
    if (!key) return Promise.resolve(jsonResponse({ message: `unrouted ${url}` }, false));
    const value = routes[key];
    return Promise.resolve(jsonResponse(typeof value === "function" ? (value as () => unknown)() : value));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("KybSection", () => {
  it("walks challenge → wallet sign → verify, then shows the verified state", async () => {
    let verified = false;
    const fetchMock = routeFetch({
      "GET /kyb/config": { enforcement: "enforce", trustedAnchors: [ANCHOR], validityDays: 182 },
      "GET /kyb/buyers/": () => (verified ? { account: BUYER, verified: true, current: accepted, latest: accepted } : unverified),
      "POST /kyb/challenge": { transaction: "CHALLENGE_XDR", networkPassphrase: "Test SDF Network ; September 2015" },
      "POST /kyb/verify": () => {
        verified = true;
        return { ...accepted, verified: true };
      },
    });
    vi.mocked(wallet.signTransactionXdr).mockResolvedValue("SIGNED_XDR");
    const onStatusChange = vi.fn();

    render(<KybSection walletAddress={BUYER} onStatusChange={onStatusChange} />);
    expect(await screen.findByText(/Required before you can create a commitment/)).toBeInTheDocument();
    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ required: true, verified: false }));

    await userEvent.click(screen.getByRole("button", { name: "Verify with anchor" }));

    expect(await screen.findByText(/Verified by/)).toBeInTheDocument();
    expect(screen.getByText(ANCHOR)).toBeInTheDocument();
    expect(wallet.signTransactionXdr).toHaveBeenCalledWith("CHALLENGE_XDR", BUYER);
    const verifyCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/kyb/verify"))!;
    expect(JSON.parse(String(verifyCall[1]!.body))).toEqual({ account: BUYER, anchorDomain: ANCHOR, transaction: "SIGNED_XDR" });
    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ required: true, verified: true }));
  });

  it("explains a NEEDS_INFO result and offers to check again", async () => {
    routeFetch({
      "GET /kyb/config": { enforcement: "off", trustedAnchors: [ANCHOR], validityDays: 182 },
      "GET /kyb/buyers/": { account: BUYER, verified: false, current: null, latest: { ...accepted, sep12_status: "NEEDS_INFO", expires_at: null } },
    });
    render(<KybSection walletAddress={BUYER} onStatusChange={vi.fn()} />);
    expect(await screen.findByText(/Optional on this deployment/)).toBeInTheDocument();
    expect(screen.getByText(/has no completed KYB on file/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("surfaces a wallet or anchor failure without losing the form", async () => {
    routeFetch({
      "GET /kyb/config": { enforcement: "enforce", trustedAnchors: [ANCHOR], validityDays: 182 },
      "GET /kyb/buyers/": unverified,
      "POST /kyb/challenge": { transaction: "CHALLENGE_XDR", networkPassphrase: "x" },
    });
    vi.mocked(wallet.signTransactionXdr).mockRejectedValue(new Error("User declined"));
    render(<KybSection walletAddress={BUYER} onStatusChange={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Verify with anchor" }));
    expect(await screen.findByText("User declined")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify with anchor" })).toBeEnabled();
  });

  it("renders nothing when the API has no trusted anchor configured", async () => {
    const onStatusChange = vi.fn();
    routeFetch({
      "GET /kyb/config": { enforcement: "off", trustedAnchors: [], validityDays: 182 },
      "GET /kyb/buyers/": unverified,
    });
    const { container } = render(<KybSection walletAddress={BUYER} onStatusChange={onStatusChange} />);
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith({ required: false, verified: false }));
    expect(container).toBeEmptyDOMElement();
  });
});
