const CACHE_NAME = "gotur-m-v2";
const PRECACHE_URLS = [
    "/stylesheets/mobile.css",
    "/scripts/mobile.js",
    "/scripts/erplogin.js",
    "/m.webmanifest",
    "/images/apple-touch-icon.png",
    "/images/android-chrome-192x192.png",
    "/images/android-chrome-512x512.png",
    "/offline-m.html"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

function isNetworkOnly(url) {
    const path = url.pathname;
    if (url.origin !== self.location.origin) return true;
    if (path === "/login" || path.startsWith("/login?")) return true;
    if (path === "/sw-m.js") return true;
    if (path === "/m.webmanifest") return true;
    if (path.startsWith("/get-") || path.startsWith("/post-") || path.startsWith("/api")) return true;
    if (path === "/permissions" || path === "/logout") return true;
    return false;
}

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    let url;
    try {
        url = new URL(request.url);
    } catch (err) {
        return;
    }

    if (isNetworkOnly(url)) return;

    if (url.pathname === "/m") {
        event.respondWith(
            fetch(request).catch(() => caches.match("/offline-m.html"))
        );
        return;
    }

    // Arayüz kodu sunucudaki sürümden geri kalmasın diye önce ağ denenir.
    if (url.pathname.startsWith("/stylesheets/") || url.pathname.startsWith("/scripts/")) {
        event.respondWith(
            fetch(request).then(response => {
                if (response && response.status === 200 && response.type === "basic") {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                }
                return response;
            }).catch(() => caches.match(request))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                if (!response || response.status !== 200 || response.type !== "basic") {
                    return response;
                }
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                return response;
            }).catch(() => caches.match("/offline-m.html"));
        })
    );
});
