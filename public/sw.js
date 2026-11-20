// Service worker: aplikace se načte i bez internetu. Verzi doplní build.sh – každé nasazení má vlastní mezipaměť.
const VER = "__VER__";
const CACHE = "myx-" + VER;
const SHELL = ["./", "index.html", "main.js?v=" + VER, "main.css?v=" + VER, "config.js?v=" + VER, "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png", "icons/myx-logbook.svg", "icons/favicon.ico"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== "myx-share" && k.startsWith("myx-")).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Sdílený soubor (export Shearwater Cloud z Quick Share, WhatsAppu…): uloží se do mezipaměti a aplikace ho po otevření načte jako cizí log.
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method === "POST" && u.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      try {
        const f = (await e.request.formData()).get("file");
        if (f && typeof f !== "string") {
          const c = await caches.open("myx-share");
          await c.put("shared.db", new Response(f, { headers: { "X-Name": encodeURIComponent(f.name || "sdileny.db") } }));
        }
      } catch (_) { /* nic */ }
      return Response.redirect("./?shared=1", 303);
    })());
    return;
  }
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // nejdřív síť (bez HTTP mezipaměti), bez sítě uložená kopie
  e.respondWith(fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" })
    .then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())))); // náhradní stránka jen při otevírání aplikace, ne místo obrázků
});
