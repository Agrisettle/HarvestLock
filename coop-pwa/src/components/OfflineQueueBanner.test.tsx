import { describe, it, expect, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { OfflineQueueBanner } from "./OfflineQueueBanner";
import { enqueueClaim, listQueuedClaims, type QueuedClaim } from "../offlineQueue";
import { expectNoA11yViolations } from "../a11y";

const claims = [
  { id: 1, contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", tranche: 1 as const, queuedAt: 1788245397000 },
  { id: 2, contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", tranche: 2 as const, queuedAt: 1788245397000 },
] satisfies QueuedClaim[];

beforeEach(() => {
  // A fresh in-memory IndexedDB per test, same reasoning as
  // offlineQueue.test.ts/App.test.tsx: fake-indexeddb/auto installs one
  // shared instance globally, so without this a claim queued here could
  // leak into another test.
  indexedDB = new IDBFactory();
});

/**
 * OfflineQueueBanner itself is presentational -- App.tsx is what reads the
 * persisted queue on mount. Mirror just that hydration step so this test
 * can prove a shown claim survives losing all React state, rather than
 * only passing back a prop that was already in memory.
 */
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

    // Simulate a full page reload: tear down the whole tree, including the
    // component state that held the queue read above, then mount a fresh
    // one. Nothing survives except IndexedDB.
    beforeReload.unmount();
    render(<BannerHydratedFromStorage />);

    expect(await screen.findByText(/1 claim couldn't reach the network/)).toBeInTheDocument();
    expect(screen.getByText(/Advance 2/)).toBeInTheDocument();
    expect(screen.getByTitle(contractId)).toBeInTheDocument();
  });
});
