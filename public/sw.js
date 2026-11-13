// Service worker: aplikace se načte i bez internetu. Verzi doplní build.sh – každé nasazení má vlastní mezipaměť.
const VER = "__VER__";
const CACHE = "myx-" + VER;
const SHELL = ["./", "index.html", "main.js?v=" + VER, "main.css?v=" + VER, "config.js?v=" + VER, "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k.startsWith("myx-")).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // nejdřív síť (bez HTTP mezipaměti), bez sítě uložená kopie
  e.respondWith(fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" })
    .then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
