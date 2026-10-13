// On-device storage using IndexedDB. One record holds the whole app state.

const DB_NAME = 'study-planner';
const STORE = 'kv';
const KEY = 'state';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function loadState() {
  return tx('readonly', (s) => s.get(KEY)).then((v) => v ?? null);
}

export function saveState(state) {
  // Structured clone keeps it simple; strip anything non-cloneable via JSON.
  return tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(state)), KEY));
}

export function clearState() {
  return tx('readwrite', (s) => s.delete(KEY));
}

/** Ask the browser not to evict our data. Safe to call repeatedly. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* not supported */ }
  return false;
}
