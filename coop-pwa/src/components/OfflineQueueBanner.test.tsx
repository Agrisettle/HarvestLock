import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfflineQueueBanner } from "./OfflineQueueBanner";
import { expectNoA11yViolations } from "../a11y";
import type { QueuedClaim } from "../offlineQueue";

const claims = [
  { id: 1, contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", tranche: 1 as const, queuedAt: 1788245397000 },
  { id: 2, contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", tranche: 2 as const, queuedAt: 1788245397000 },
] satisfies QueuedClaim[];

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
});
