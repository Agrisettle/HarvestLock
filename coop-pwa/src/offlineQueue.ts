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
 * One object store, no version-migration story yet -- this is the
 * first thing in this app that uses IndexedDB at all.
 */

const DB_NAME = "harvestlock-coop-offline-queue";
const DB_VERSION = 1;
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
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** True for the specific failure mode this queue exists to handle — no network reached at all, not a rejection the server actually returned. */
export function isOfflineError(err: unknown): boolean {
  return err instanceof TypeError;
}

export async function enqueueClaim(contractId: string, tranche: 1 | 2): Promise<number> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
      const req = store.add({ contractId, tranche, queuedAt: Date.now() });
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
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
