// outbox.js (ES module with multi-tab safe claims)
const DB_NAME = "three-sides-outbox";
const STORE = "outbox";
const CLAIM_TTL_MS = 3 * 60 * 1000; // 3 minutes; stale claims auto-expire
const _clientId = (() => {
    // persistent per-tab id for the life of the page
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
})();

let _getUid = null;   // () => uid string or null
let _upload = null;   // async (payload) => void

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idb(mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const out = fn(store);
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
    });
}

const Outbox = {
    async put(item) { return idb("readwrite", s => s.put(item)); },
    async del(id) { return idb("readwrite", s => s.delete(id)); },
    async get(id) { return idb("readonly", s => s.get(id)); },
    async list() {
        return idb("readonly", s => new Promise(res => {
            const items = [];
            const req = s.openCursor();
            req.onsuccess = (e) => {
                const c = e.target.result;
                if (c) { items.push(c.value); c.continue(); } else { res(items); }
            };
        }));
    },
    // Atomically claim an item so only one tab uploads it.
    async claim(id) {
        return idb("readwrite", (s) => new Promise((resolve, reject) => {
            const getReq = s.get(id);
            getReq.onsuccess = () => {
                const it = getReq.result;
                if (!it) return resolve(false);
                const now = Date.now();
                const claimedBy = it.claimedBy || null;
                const claimedAt = it.claimedAt || 0;
                const expired = claimedAt && (now - claimedAt > CLAIM_TTL_MS);

                if (!claimedBy || expired) {
                    it.claimedBy = _clientId;
                    it.claimedAt = now;
                    const putReq = s.put(it);
                    putReq.onsuccess = () => resolve(true);
                    putReq.onerror = () => reject(putReq.error);
                } else {
                    resolve(false);
                }
            };
            getReq.onerror = () => reject(getReq.error);
        }));
    },
    async release(id) {
        return idb("readwrite", (s) => new Promise((resolve, reject) => {
            const getReq = s.get(id);
            getReq.onsuccess = () => {
                const it = getReq.result;
                if (!it) return resolve(); // already gone
                if (it.claimedBy === _clientId) {
                    delete it.claimedBy;
                    delete it.claimedAt;
                    const putReq = s.put(it);
                    putReq.onsuccess = () => resolve();
                    putReq.onerror = () => reject(putReq.error);
                } else {
                    resolve(); // another tab owns it now; do nothing
                }
            };
            getReq.onerror = () => reject(getReq.error);
        }));
    }
};

async function requestBackgroundSync() {
    try {
        const reg = await navigator.serviceWorker.ready;
        if ("sync" in reg) await reg.sync.register("outbox-sync");
    } catch {/* ignore */ }
}

export function initOutbox(getUidFn, uploadFn) {
    _getUid = getUidFn;   // () => uid
    _upload = uploadFn;   // async (payload) => void

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", (ev) => {
            if (ev.data && ev.data.type === "SYNC_OUTBOX") {
                flushOutbox();
            }
        });
    }
    window.addEventListener("online", flushOutbox);
    window.addEventListener("focus", flushOutbox);

    flushOutbox(); // best-effort on init
}

export async function queueOrWrite(payload) {
    const uid = _getUid?.();
    if (!uid) throw new Error("Not logged in");

    if (navigator.onLine) {
        try {
            await _upload(payload);
            return "wrote-now";
        } catch {
            // fall through to queue
        }
    }

    const item = {
        id: `${payload.kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        uid,
        payload,
        ts: Date.now()
        // claimedBy / claimedAt added only when flushing
    };
    await Outbox.put(item);
    await requestBackgroundSync();
    return "queued";
}

/* Concurrency guard per tab (prevents overlapping flushes in THIS tab).
   Cross-tab duplication is prevented by the claim/release above. */
let _flushing = false;

export async function flushOutbox() {
    if (_flushing) return;
    _flushing = true;
    try {
        const uid = _getUid?.();
        if (!uid || !navigator.onLine) return;

        const items = await Outbox.list();
        for (const item of items) {
            if (item.uid !== uid) continue;

            // Try to claim it; if we don't win, skip.
            const gotIt = await Outbox.claim(item.id).catch(() => false);
            if (!gotIt) continue;

            try {
                await _upload(item.payload);
                await Outbox.del(item.id);
            } catch {
                // Put it back for another attempt later
                await Outbox.release(item.id).catch(() => { });
            }
        }
    } finally {
        _flushing = false;
    }
}
