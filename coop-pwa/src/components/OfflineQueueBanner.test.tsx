import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OfflineQueueBanner } from "./OfflineQueueBanner";
import type { QueuedClaim } from "../offlineQueue";
import { expectNoA11yViolations } from "../test-setup";

const sampleClaims: QueuedClaim[] = [
  {
    id: 1,
    contractId: "CDJGUBCZIDNNWXW2I5PQ6AIOTRR34ISWIZCUK2QDF5XURZANDAVJLMQY",
    tranche: 1,
    queuedAt: 1788245397000,
  },
  {
    id: 2,
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    tranche: 2,
    queuedAt: 1788245400000,
  },
];

describe("OfflineQueueBanner", () => {
  it("renders nothing when queuedClaims is empty", () => {
    const { container } = render(
      <OfflineQueueBanner queuedClaims={[]} retryingId={null} onRetry={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders queued claims with accessibility compliance", async () => {
    const onRetry = vi.fn();
    const { container } = render(
      <OfflineQueueBanner queuedClaims={sampleClaims} retryingId={null} onRetry={onRetry} />,
    );

    expect(screen.getByText(/2 claims couldn't reach the network and are waiting to retry/)).toBeInTheDocument();
    expect(screen.getByText("Advance 1 —")).toBeInTheDocument();
    expect(screen.getByText("Advance 2 —")).toBeInTheDocument();

    await expectNoA11yViolations(container);
  });

  it("calls onRetry when Retry button is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <OfflineQueueBanner queuedClaims={sampleClaims} retryingId={null} onRetry={onRetry} />,
    );

    const retryButtons = screen.getAllByRole("button", { name: "Retry" });
    await user.click(retryButtons[0]);
    expect(onRetry).toHaveBeenCalledWith(sampleClaims[0]);
  });

  it("shows Retrying state and disables buttons while a retry is in flight", async () => {
    const { container } = render(
      <OfflineQueueBanner queuedClaims={sampleClaims} retryingId={1} onRetry={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
    await expectNoA11yViolations(container);
  });
});
