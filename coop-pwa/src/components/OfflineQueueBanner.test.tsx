import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { OfflineQueueBanner } from "./OfflineQueueBanner";
import { enqueueClaim, listQueuedClaims, type QueuedClaim } from "../offlineQueue";
import { expectNoA11yViolations } from "../a11y";

const claims = [
  { id: 1, contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", tranche: 1 as const, queuedAt: 1788245397000 },
  { id: 2, contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", tranche: 2 as const, queuedAt: 1788245397000 },
] satisfies QueuedClaim[];

beforeEach(() => {
  indexedDB = new IDBFactory();
});

function BannerHydratedFromStorage() {
  const [queuedClaims, setQueuedClaims] = useState<QueuedClaim[] | null>(null);
  useEffect(() => {
    listQueuedClaims().then(setQueuedClaims);
  }, []);
  if (queuedClaims === null) return null;
  return <OfflineQueueBanner queuedClaims={queuedClaims} retryingId={null} onRetry={() => {}} />;
}

describe("OfflineQueueBanner", () => {
  it("renders nothing for an empty queue", () => {
    const { container } = render(<OfflineQueueBanner queuedClaims={[]} retryingId={null} onRetry={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists queued claims with no axe violations", async () => {
    const { container } = render(<OfflineQueueBanner queuedClaims={claims} retryingId={null} onRetry={() => {}} />);
    expect(screen.getByText(/2 claims couldn't reach the network/)).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("shows a queued claim after a full reload, read back from IndexedDB rather than in-memory state", async () => {
    const contractId = "CDJGUBCZIDNNWXW2I5PQ6AIOTRR34ISWIZCUK2QDF5XURZANDAVJLMQY";
    await enqueueClaim(contractId, 2);

    const beforeReload = render(<BannerHydratedFromStorage />);
    expect(await screen.findByText(/1 claim couldn't reach the network/)).toBeInTheDocument();
    expect(screen.getByText(/Advance 2/)).toBeInTheDocument();
    expect(screen.getByTitle(contractId)).toBeInTheDocument();

    beforeReload.unmount();
    render(<BannerHydratedFromStorage />);

    expect(await screen.findByText(/1 claim couldn't reach the network/)).toBeInTheDocument();
    expect(screen.getByText(/Advance 2/)).toBeInTheDocument();
    expect(screen.getByTitle(contractId)).toBeInTheDocument();
  });
});

describe("OfflineQueueBanner keyboard navigation audit (Issue #93)", () => {
  it("renders interactive elements with explicit type='button'", () => {
    render(
      <OfflineQueueBanner
        queuedClaims={claims}
        retryingId={null}
        retryErrors={{ 1: "Network timed out" }}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute("type", "button");
    });
  });

  it("allows sequential tab navigation through interactive buttons without focus traps", async () => {
    const user = userEvent.setup();
    render(
      <OfflineQueueBanner
        queuedClaims={[claims[0]]}
        retryingId={null}
        retryErrors={{ 1: "Network timed out" }}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const copyBtn = screen.getByRole("button", { name: "Copy" });
    const retryBtn = screen.getByRole("button", { name: /^Retry/ });
    const dismissBtn = screen.getByRole("button", { name: /^Dismiss/ });

    await user.tab();
    expect(copyBtn).toHaveFocus();

    await user.tab();
    expect(retryBtn).toHaveFocus();

    await user.tab();
    expect(dismissBtn).toHaveFocus();
  });

  it("triggers onRetry and onDismiss via keyboard activation", async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(
      <OfflineQueueBanner
        queuedClaims={[claims[0]]}
        retryingId={null}
        retryErrors={{ 1: "Network timed out" }}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );

    const retryBtn = screen.getByRole("button", { name: /^Retry/ });
    const dismissBtn = screen.getByRole("button", { name: /^Dismiss/ });

    await user.tab(); // copy
    await user.tab(); // retry
    expect(retryBtn).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledWith(claims[0]);

    await user.tab(); // dismiss
    expect(dismissBtn).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onDismiss).toHaveBeenCalledWith(claims[0]);
  });
});

describe("OfflineQueueBanner color contrast & ARIA labeling (Issue #94)", () => {
  it("provides live region role='status' on the queue banner", () => {
    const { container } = render(
      <OfflineQueueBanner queuedClaims={claims} retryingId={null} onRetry={vi.fn()} />,
    );
    const banner = container.querySelector(".offline-queue-banner");
    expect(banner).toHaveAttribute("role", "status");
  });

  it("provides accessible names conveying tranche and contract context", () => {
    render(
      <OfflineQueueBanner
        queuedClaims={[claims[0]]}
        retryingId={null}
        retryErrors={{ 1: "Network timed out" }}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const retryBtn = screen.getByRole("button", {
      name: `Retry Advance 1 — ${claims[0].contractId}`,
    });
    expect(retryBtn).toBeInTheDocument();

    const dismissBtn = screen.getByRole("button", {
      name: `Dismiss Advance 1 — ${claims[0].contractId}`,
    });
    expect(dismissBtn).toBeInTheDocument();
  });

  it("sets aria-busy during active retry operation", () => {
    const { rerender } = render(
      <OfflineQueueBanner queuedClaims={[claims[0]]} retryingId={null} onRetry={vi.fn()} />,
    );

    const retryBtn = screen.getByRole("button", { name: /Advance 1/ });
    expect(retryBtn).toHaveAttribute("aria-busy", "false");

    rerender(
      <OfflineQueueBanner queuedClaims={[claims[0]]} retryingId={1} onRetry={vi.fn()} />,
    );
    const busyBtn = screen.getByRole("button", { name: /Advance 1/ });
    expect(busyBtn).toHaveAttribute("aria-busy", "true");
  });

  it("announces retry failure errors with role='alert'", () => {
    render(
      <OfflineQueueBanner
        queuedClaims={[claims[0]]}
        retryingId={null}
        retryErrors={{ 1: "Network request timed out" }}
        onRetry={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Network request timed out");
  });

  it("verifies contrast ratios meet WCAG AA requirements for OfflineQueueBanner styling tokens", () => {
    const lum = (hex: string) => {
      const rgb = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => parseInt(c, 16) / 255);
      const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrastRatio = (hex1: string, hex2: string) => {
      const [l1, l2] = [lum(hex1), lum(hex2)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    // Composite rgba(212, 169, 55, 0.1) on #0b120f
    const bannerBg = "#1f2113";
    const bone = "#f3f1e9";
    const boneDim = "#c9c6ba";
    const boneFaint = "#8a897f";
    const gold = "#d4a937";
    const goldBright = "#eec765";

    // Text contrast on banner background (WCAG AA: >= 4.5:1)
    expect(contrastRatio(bone, bannerBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(boneDim, bannerBg)).toBeGreaterThanOrEqual(4.5);

    // UI boundary and focus indicator contrast on banner background (WCAG SC 1.4.11: >= 3.0:1)
    expect(contrastRatio(boneFaint, bannerBg)).toBeGreaterThanOrEqual(3.0); // Secondary button border
    expect(contrastRatio(gold, bannerBg)).toBeGreaterThanOrEqual(3.0); // Focused button border
    expect(contrastRatio(goldBright, bannerBg)).toBeGreaterThanOrEqual(3.0);
  });
});
