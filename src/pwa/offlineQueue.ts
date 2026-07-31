/**
 * IndexedDB-backed offline action queue.
 *
 * The bar's WiFi drops twice a week. Without a queue, a CHIT sale that
 * the barman thinks they submitted vanishes silently and the member
 * never gets a phone-prompt to approve it.
 *
 * Design:
 *   - Each queued action is an opaque JSON-serialisable payload + a
 *     client-generated UUID (so de-dup is trivial) + a wall-clock
 *     timestamp + a `kind` discriminator.
 *   - Storage is IndexedDB (`mmmis-offline-queue`), not localStorage,
 *     because (a) sale payloads include a cart of items and we want
 *     headroom, and (b) localStorage is wiped less reliably across
 *     browsers. IndexedDB survives app restarts.
 *   - Flush is driven by the `online` event AND polled every 30s as a
 *     belt-and-braces (network-change events can be flaky on mobile).
 *   - On success the row is deleted. On a 4xx error (e.g. 401 auth
 *     expired) we keep the row and stop the flush — the barman can
 *     re-auth, then a manual retry flushes the queue. On a 5xx / network
 *     error we keep the row and retry with exponential backoff per row.
 *
 * The queue is intentionally small and synchronous-feeling from the
 * caller's perspective: callers do
 *
 *     await queueAction({ kind: 'chit-sale', payload: ... });
 *
 * and the function persists before resolving. A separate
 * `flushQueue()` runs the actual Supabase writes and is called by
 * `useOfflineFlush()` from a React effect.
 */

const DB_NAME = 'mmmis-offline-queue';
const DB_VERSION = 1;
const STORE = 'actions';

/**
 * `kind` matches the user-facing action the barman took, NOT the server
 * RPC we end up calling on flush. e.g. a queued 'chit-sale' action is
 * replayed by calling `create_chit_authorization` (which creates a
 * pending request that the member must still approve) — NOT by
 * `create_sale`, because the sale doesn't exist until approval lands.
 */
export type QueuedKind = 'chit-sale' | 'cash-sale' | 'expense';

export interface QueuedAction<P = unknown> {
  id: string;                // client UUID
  kind: QueuedKind;
  payload: P;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byCreatedAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store))
      .then((r) => { result = r; })
      .catch(reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('IDB tx failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IDB tx aborted'));
  });
}

/**
 * Persist an action to the queue. Resolves once the row is committed
 * (NOT once it has been flushed to the server). Returns the assigned id.
 */
export async function queueAction<P>(input: { kind: QueuedKind; payload: P }): Promise<string> {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const row: QueuedAction<P> = {
    id,
    kind: input.kind,
    payload: input.payload,
    createdAt: Date.now(),
    attempts: 0,
  };
  await tx('readwrite', (s) => new Promise<void>((resolve, reject) => {
    const req = s.put(row);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
  return id;
}

export async function listQueued(): Promise<QueuedAction[]> {
  return tx('readonly', (s) => new Promise<QueuedAction[]>((resolve, reject) => {
    const out: QueuedAction[] = [];
    const req = s.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out.sort((a, b) => a.createdAt - b.createdAt));
        return;
      }
      out.push(cursor.value as QueuedAction);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

export async function removeQueued(id: string): Promise<void> {
  await tx('readwrite', (s) => new Promise<void>((resolve, reject) => {
    const req = s.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

export async function markAttempt(id: string, errorMessage: string): Promise<void> {
  await tx('readwrite', (s) => new Promise<void>((resolve, reject) => {
    const req = s.get(id);
    req.onsuccess = () => {
      const row = req.result as QueuedAction | undefined;
      if (!row) { resolve(); return; }
      row.attempts += 1;
      row.lastError = errorMessage;
      const put = s.put(row);
      put.onsuccess = () => resolve();
      put.onerror = () => reject(put.error);
    };
    req.onerror = () => reject(req.error);
  }));
}

export async function clearQueue(): Promise<void> {
  await tx('readwrite', (s) => new Promise<void>((resolve, reject) => {
    const req = s.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}