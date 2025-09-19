// sw-register.js
(() => {
    if (!("serviceWorker" in navigator)) return;

    // Only run on http/https (works on localhost)
    if (!/^https?:$/.test(location.protocol)) {
        console.log("[SW] Not registering on non-HTTP(S) origin.");
        return;
    }

    // Bump this ONLY when sw.js itself changes
    const SW_VERSION = 10; // ⬅️ bump when you edit sw.js

    // Compute the repo base robustly:
    // - On GitHub Pages project sites: "/<repo>/"
    // - Else: fall back to current directory ("/" on localhost)
    function computeBase() {
        const { hostname, pathname } = location;
        if (hostname.endsWith("github.io")) {
            const seg = pathname.split("/").filter(Boolean)[0]; // repo name
            return seg ? `/${seg}/` : "/";
        }
        // Non-GitHub hosts: current folder
        return new URL(".", location).pathname;
    }

    const BASE = computeBase();                 // e.g. "/three-sides.io/" or "/"
    const SW_URL = `${BASE}sw.js?v=${SW_VERSION}`;
    const SCOPE = BASE;

    // Auto-reload the page when a new SW takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
    });

    function track(reg) {
        if (!reg) return;

        // If an updated worker is already waiting, activate it now
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });

        // When a new SW is found, encourage it to activate ASAP
        reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
                if (nw.state === "installed") {
                    if (navigator.serviceWorker.controller) {
                        console.log("[SW] New version installed; activating…");
                        (reg.waiting || nw).postMessage({ type: "SKIP_WAITING" });
                    } else {
                        console.log("[SW] First install complete; offline ready.");
                    }
                }
            });
        });

        // Check for updates when tab becomes visible (helps Safari)
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") reg.update().catch(() => { });
        });

        // If the page is restored from BFCache, also check for updates
        window.addEventListener("pageshow", (e) => {
            if (e.persisted) reg.update().catch(() => { });
        });

        // Periodic background check (hourly)
        setInterval(() => reg.update().catch(() => { }), 60 * 60 * 1000);
    }

    // ---- Background Sync helper ----
    async function registerOutboxSync() {
        try {
            const readyReg = await navigator.serviceWorker.ready;
            // Some browsers (e.g., Safari today) won't have 'sync'
            if ("sync" in readyReg) {
                await readyReg.sync.register("outbox-sync");
                console.log("[SW] Background Sync registered: outbox-sync");
            } else {
                console.log("[SW] Background Sync not supported; relying on online/focus fallbacks");
            }
        } catch (e) {
            console.log("[SW] Background Sync registration failed", e);
        }
    }

    // Register after load so it never blocks first paint
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register(SW_URL, { scope: SCOPE })
            .then((reg) => {
                console.log("[SW] Registered at", reg.scope, "->", SW_URL);
                track(reg);
                return navigator.serviceWorker.ready;
            })
            .then(() => {
                // Kick off Background Sync registration once the SW is ready
                registerOutboxSync();
            })
            .catch((err) => console.error("[SW] Register error", err));
    });

    // Re-register sync when we come back online (helps if the tag was cleared)
    window.addEventListener("online", () => {
        registerOutboxSync();
    });
})();
