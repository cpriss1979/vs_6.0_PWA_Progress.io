// firebase-init.js — shared Firebase v10 ESM init (CDN modules)

// App
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

// Auth
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Firestore + caching strategies
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    memoryLocalCache
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Your project config (unchanged) ---
const firebaseConfig = {
    apiKey: "AIzaSyAIB1E3TL9EchtDDvFL69AnP7x9_OlDwj4",
    authDomain: "threesidesapp.firebaseapp.com",
    projectId: "threesidesapp",
    storageBucket: "threesidesapp.appspot.com",
    messagingSenderId: "203058316349",
    appId: "1:203058316349:web:d6c53c82310aa1a03b9654",
};
// --------------------------------------------------

// Idempotent app init (safe if multiple pages import this)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Auth (keep users signed in across refreshes + use device language)
const auth = getAuth(app);
try { auth.useDeviceLanguage && auth.useDeviceLanguage(); } catch { }
// Don’t block page load; if it fails, auth still works with default persistence.
setPersistence(auth, browserLocalPersistence).catch(() => { });

// Firestore with Safari-safe realtime:
// - persistent cache w/ multi-tab sync when IndexedDB is available
// - auto long-poll detection (fixes Safari networking quirks)
// - graceful fallback to in-memory cache (Private Mode, etc.)
let db;
try {
    db = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        }),
    });
} catch (e) {
    db = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
        localCache: memoryLocalCache()
    });
    console.warn("[firebase-init] Falling back to memoryLocalCache:", e?.message || e);
}

console.info("[firebase-init] loaded");
export { app, auth, db };
