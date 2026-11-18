/**
 * PRD §7/§16.3's "connectivity loss at depot" edge case: a cooperative
 * rep taps "Claim" with no network, the request can't even leave the
 * device. Queuing the *intent* (which tranche, for which contract) in
 * IndexedDB — not a pre-signed transaction — is the deliberate design
 * here, not an oversight: every build here goes through
 * api/src/stellar/tx.ts's `buildInvokeTransaction`, which sets a 60-
 * second transaction timeout (`.setTimeout(60)`) — nowhere near long
 * enough to survive a real depot connectivity gap, and a signed-but-
 * stale envelope would also silently go bad the moment any *other*
 * transaction moves the source account's sequence number in the
 * meantime. Queuing the intent instead means reconnecting always
 * rebuilds fresh (a current sequence number, a fresh 60s window) and
 * still needs the cooperative's own wallet to sign it — Freighter needs
 * the user present for that regardless, so "sign automatically in the
 * background" was never actually on the table here.
 *
 * One object store. v2 adds a unique index on [contractId, tranche] so
 * tapping Claim twice while offline queues a single item; the upgrade
 * drops any duplicates a v1 database already holds before building it.
 */

const DB_NAME = "harvestlock-coop-offline-queue";
const DB_VERSION = 2;
const CLAIM_INDEX = "contract-tranche";
const STORE_NAME = "pending-claims";

export interface QueuedClaim {
  id: number;
  contractId: string;
  tranche: 1 | 2;
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      const store =
        oldVersion < 1
          ? db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true })
          : req.transaction!.objectStore(STORE_NAME);
      if (oldVersion < 2) {
        // v1 -> v2: keep the first queued item per (contractId, tranche),
        // drop later duplicates, then build the unique index.
        const seen = new Set<string>();
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            store.createIndex(CLAIM_INDEX, ["contractId", "tranche"], { unique: true });
            return;
          }
          const { contractId, tranche } = cursor.value as QueuedClaim;
          const key = `${contractId}:${tranche}`;
          if (seen.has(key)) cursor.delete();
          else seen.add(key);
          cursor.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Thrown by api.ts when `fetch` itself rejects — the request never got an
 * HTTP response. It extends TypeError (what fetch rejects with) so
 * existing `instanceof TypeError` checks keep working, but only errors
 * api.ts wraps count as offline: a TypeError from a bug elsewhere in the
 * build/sign/submit chain is a real error and must surface.
 */
export class OfflineError extends TypeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OfflineError";
  }
}

/** True for the specific failure mode this queue exists to handle — no network reached at all, not a rejection the server actually returned. */
export function isOfflineError(err: unknown): boolean {
  return err instanceof OfflineError;
}

export async function enqueueClaim(contractId: string, tranche: 1 | 2): Promise<number> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
      // One queued item per (contractId, tranche): a second tap while
      // offline returns the existing item's id instead of adding another.
      const existing = store.index(CLAIM_INDEX).getKey([contractId, tranche]);
      existing.onsuccess = () => {
        if (existing.result !== undefined) {
          resolve(existing.result as number);
          return;
        }
        const req = store.add({ contractId, tranche, queuedAt: Date.now() });
        req.onsuccess = () => resolve(req.result as number);
        req.onerror = () => reject(req.error);
      };
      existing.onerror = () => reject(existing.error);
    });
  } finally {
    db.close();
  }
}

export async function listQueuedClaims(): Promise<QueuedClaim[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as QueuedClaim[]);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function removeQueuedClaim(id: number): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
