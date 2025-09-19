// sw.js — 3-Sides Planner (v29)
// Drop-in: preserves your structure, adds robustness for PWABuilder + GH Pages

(() => {
    // --- Guard: only run when actually in a Service Worker context ---
    const isSW =
        typeof ServiceWorkerGlobalScope !== "undefined" &&
        self instanceof ServiceWorkerGlobalScope;
    if (!isSW) return;

    // ----- Versioned cache name derived from sw.js?v=NUMBER -----
    // e.g. "8" when sw.js?v=8. Keep your default "0" if not provided.
    const regURL = new URL(self.location.href);
    const SWV = regURL.searchParams.get("v") || "0";
    const CACHE_PREFIX = "3-sides-planner-v";
    const CACHE_NAME = `${CACHE_PREFIX}${SWV}`;

    // Scope-aware helper for absolute same-origin URLs (GitHub Pages safe)
    const scope =
        (self.registration && self.registration.scope) ||
        self.location.origin + "/";
    const P = (p) => new URL(p, scope).toString();

    // ----- Precache: include your app shell and static assets here -----
    // Add any page you want to reliably work offline.
    const CORE = [
        // HTML pages
        "index.html",
        "about.html",
        "theme.html",
        "wellness.html",
        "wellnessPlan.html",
        "pet.html",
        "journal.html",
        "toolkit-hub.html",   // main Toolkit hub
        "toolkit.html",       // include if you sometimes link to this older name
        "letter.html",
        "support.html",
        "important-numbers.html",
        "login.html",
        "register.html",
        "privacy.html",

        // CSS / JS
        "style.css",
        "mainTheme.css",
        "sw-register.js",
        "firebase-init.js",
        "outbox.js",          // Background Sync helper for pages

        // Images / icons / media
        "relax.png",
        "favicon-16.png",
        "favicon-32.png",
        "icon-192.png",
        "icon-512.png",
        "icon-192-maskable.png",
        "icon-512-maskable.png",
        "pet-baby.png",
        "pet-child.png",
        "pet-teen.png",
        "pet-adult.png",
        "forest.png",
        "chime.mp3",          // used in support page

        // Manifest (unversioned to avoid drift)
        "manifest.webmanifest",
    ].map(P);

    // Allow the page to tell us to activate immediately
    self.addEventListener("message", (event) => {
        const t = event?.data?.type;
        if (t === "SKIP_WAITING") self.skipWaiting();
        // no-op for other messages; SYNC_OUTBOX is sent *from* the SW (see below)
    });

    // ----- Install: precache essentials (best-effort; don't fail whole install) -----
    self.addEventListener("install", (event) => {
        event.waitUntil(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                await Promise.all(
                    CORE.map(async (url) => {
                        try {
                            // 'no-cache' bypasses HTTP caches when updating the SW
                            const res = await fetch(url, { cache: "no-cache" });
                            if (res.ok || res.type === "opaque") {
                                await cache.put(url, res.clone());
                            } else {
                                console.warn("[SW] Skipped (status)", res.status, url);
                            }
                        } catch (e) {
                            console.warn("[SW] Skipped (fetch)", url, e);
                        }
                    })
                );
                // Helps first update; we also claim in activate
                self.skipWaiting();
            })()
        );
    });

    // ----- Activate: cleanup old caches + claim clients + enable nav preload -----
    self.addEventListener("activate", (event) => {
        event.waitUntil(
            (async () => {
                // Remove older versions
                const names = await caches.keys();
                await Promise.all(
                    names.map((n) =>
                        n !== CACHE_NAME && n.startsWith(CACHE_PREFIX)
                            ? caches.delete(n)
                            : Promise.resolve()
                    )
                );

                // (Chrome) Navigation preload can speed first-load
                if ("navigationPreload" in self.registration) {
                    try {
                        await self.registration.navigationPreload.enable();
                    } catch { /* ignore */ }
                }

                await self.clients.claim(); // take control immediately
            })()
        );
    });

    // ----- Strategy helpers -----
    const isHTMLNav = (req) =>
        req.mode === "navigate" ||
        (req.method === "GET" &&
            (req.headers.get("accept") || "").includes("text/html"));

    async function networkFirstForPage(event) {
        const cache = await caches.open(CACHE_NAME);
        try {
            // Prefer the preloaded response if available
            const preload = await event.preloadResponse;
            if (preload) {
                cache.put(event.request, preload.clone());
                return preload;
            }

            const net = await fetch(event.request);
            if (net && net.ok) cache.put(event.request, net.clone());
            return net;
        } catch {
            // Offline / error → fallback to cached page or home
            // Handle start_url with query string by ignoring search when matching
            const cached =
                (await cache.match(event.request)) ||
                (await caches.match(P("index.html"), { ignoreSearch: true }));
            return cached || Response.error();
        }
    }

    async function staleWhileRevalidate(event) {
        const req = event.request;
        const cache = await caches.open(CACHE_NAME);

        const cached = await cache.match(req, { ignoreSearch: false });

        const fetchAndUpdate = fetch(req)
            .then((res) => {
                if (res && (res.ok || res.type === "opaque")) {
                    cache.put(req, res.clone());
                }
                return res;
            })
            .catch(() => null);

        if (cached) {
            // Return cache immediately; refresh in the background
            fetchAndUpdate.catch(() => { });
            return cached;
        }

        const net = await fetchAndUpdate;
        if (net) return net;
        return Response.error();
    }

    // ----- Fetch routing -----
    self.addEventListener("fetch", (event) => {
        const req = event.request;

        // Ignore non-GET & extension/browser-internal requests
        if (req.method !== "GET") return;
        if (
            req.url.startsWith("chrome-extension://") ||
            req.url.startsWith("safari-extension://") ||
            req.url.startsWith("moz-extension://")
        ) return;

        // 🔕 Skip caching for Firebase/Google infra traffic (long-poll, auth, analytics)
        try {
            const host = new URL(req.url).hostname;
            const BYPASS_HOSTS = [
                "googleapis.com",
                "gstatic.com",
                "firebaseinstallations.googleapis.com",
                "googletagmanager.com",
                "analytics.google.com",
                "www.google-analytics.com"
            ];
            if (BYPASS_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
                return; // let the network handle it (don’t intercept/cache)
            }
        } catch {
            /* if URL parsing fails, just fall through */
        }

        // HTML navigations → network-first (with preload), fallback to cached or index.html
        if (isHTMLNav(req)) {
            event.respondWith(networkFirstForPage(event));
            return;
        }

        // Everything else → stale-while-revalidate
        event.respondWith(staleWhileRevalidate(event));
    });

    // =========================
    // BACKGROUND SYNC (one-off)
    // =========================
    // When connectivity returns, wake any open pages so THEY can flush the outbox
    // via Firebase/Firestore (auth/SDK live in the page).
    self.addEventListener("sync", (event) => {
        if (event.tag === "outbox-sync") {
            event.waitUntil(handleOutboxSync());
        }
    });

    async function handleOutboxSync() {
        const clientsList = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
        });
        for (const client of clientsList) {
            client.postMessage({ type: "SYNC_OUTBOX" });
        }
        // If you later create a SW-owned REST queue, you can flush it here as well.
    }
})();
