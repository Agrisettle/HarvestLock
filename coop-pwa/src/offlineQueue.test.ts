import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { enqueueClaim, listQueuedClaims, removeQueuedClaim, isOfflineError } from "./offlineQueue";

// A fresh in-memory IndexedDB per test -- fake-indexeddb/auto (loaded in
// test-setup.ts) installs one shared instance globally, which would let
// one test's queued claims bleed into the next. Same reasoning
// test-setup.ts's afterEach(cleanup) documents for React trees, applied
// to storage instead of the DOM.
beforeEach(() => {
  indexedDB = new IDBFactory();
});

describe("offlineQueue", () => {
  it("isOfflineError is true for a TypeError (fetch's own signal for network failure) and false otherwise", () => {
    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOfflineError(new Error("/tx/claim_advance_1 -> 500: something went wrong"))).toBe(false);
    expect(isOfflineError("not even an Error")).toBe(false);
  });

  it("enqueues a claim and lists it back", async () => {
    const id = await enqueueClaim("CTESTCONTRACT1", 1);
    expect(typeof id).toBe("number");

    const queued = await listQueuedClaims();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ id, contractId: "CTESTCONTRACT1", tranche: 1 });
    expect(typeof queued[0]!.queuedAt).toBe("number");
  });

  it("keeps multiple queued claims independent, including two for the same contract", async () => {
    await enqueueClaim("CTESTCONTRACT1", 1);
    await enqueueClaim("CTESTCONTRACT1", 2);
    await enqueueClaim("CTESTCONTRACT2", 1);

    const queued = await listQueuedClaims();
    expect(queued).toHaveLength(3);
    expect(queued.filter((c) => c.contractId === "CTESTCONTRACT1")).toHaveLength(2);
  });

  it("removeQueuedClaim removes only the targeted entry", async () => {
    const firstId = await enqueueClaim("CTESTCONTRACT1", 1);
    const secondId = await enqueueClaim("CTESTCONTRACT2", 2);

    await removeQueuedClaim(firstId);

    const queued = await listQueuedClaims();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.id).toBe(secondId);
  });

  it("listQueuedClaims returns an empty array when nothing is queued", async () => {
    expect(await listQueuedClaims()).toEqual([]);
  });
});
