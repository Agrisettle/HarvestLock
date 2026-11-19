import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { enqueueClaim, listQueuedClaims, removeQueuedClaim, isOfflineError, OfflineError } from "./offlineQueue";

// A fresh in-memory IndexedDB per test -- fake-indexeddb/auto (loaded in
// test-setup.ts) installs one shared instance globally, which would let
// one test's queued claims bleed into the next. Same reasoning
// test-setup.ts's afterEach(cleanup) documents for React trees, applied
// to storage instead of the DOM.
beforeEach(() => {
  indexedDB = new IDBFactory();
});

describe("offlineQueue", () => {
  it("isOfflineError is true only for the OfflineError api.ts wraps around a failed fetch", () => {
    expect(isOfflineError(new OfflineError("Failed to fetch"))).toBe(true);
    // A TypeError from a bug in the build/sign/submit chain is not "offline".
    expect(isOfflineError(new TypeError("Cannot read properties of undefined"))).toBe(false);
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

  it("enqueueing the same contract and tranche twice keeps a single item", async () => {
    const first = await enqueueClaim("CTESTCONTRACT1", 1);
    const second = await enqueueClaim("CTESTCONTRACT1", 1);

    expect(second).toBe(first);
    expect(await listQueuedClaims()).toHaveLength(1);
  });

  it("upgrades a v1 database in place, keeping existing items and collapsing v1 duplicates", async () => {
    // Build a v1 database by hand: same store, no index, duplicates allowed.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("harvestlock-coop-offline-queue", 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore("pending-claims", { keyPath: "id", autoIncrement: true });
        store.add({ contractId: "CTESTCONTRACT1", tranche: 1, queuedAt: 1 });
        store.add({ contractId: "CTESTCONTRACT1", tranche: 1, queuedAt: 2 });
        store.add({ contractId: "CTESTCONTRACT2", tranche: 2, queuedAt: 3 });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    const queued = await listQueuedClaims();
    expect(queued.map((c) => [c.contractId, c.tranche, c.queuedAt])).toEqual([
      ["CTESTCONTRACT1", 1, 1],
      ["CTESTCONTRACT2", 2, 3],
    ]);
    // The new unique index is live after the upgrade.
    expect(await enqueueClaim("CTESTCONTRACT2", 2)).toBe(queued[1]!.id);
  });
});
