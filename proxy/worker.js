// myX – Cloudflare Worker: synchronizace logbooku a ponorů + proxy pro Strany potápěčské.
//
// Nastavení v Cloudflare:
//   • KV namespace (např. „myx-data“) připojený jako binding  MYX_KV
//   • tajná proměnná (Secret)                                   MYX_KEY  – stejný klíč zadáš v aplikaci v Nastavení
//
// API (vše kromě /sp/ vyžaduje hlavičku X-Myx-Key):
//   GET  /sync            → { lb, ver, dives: [{ id, num, start }] }
//   PUT  /sync            ← { lb, ver }  → { ver }  (409 + aktuální stav, když mezitím zapsal někdo jiný)
//   GET  /dive/<id>       → surová data ponoru (binárně)
//   PUT  /dive/<id>       ← surová data, hlavičky X-Num, X-Start
//   GET  /sp/lok/<id>     → stránka lokality ze stranypotapecske.cz (původní bajty)
//   GET  /sp/list         → přehled lokalit ze stranypotapecske.cz (původní bajty)

const SP = "https://stranypotapecske.cz/lokality/";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Myx-Key, X-Num, X-Start",
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function proxySp(url, ctx) {
  const cache = caches.default;
  const key = new Request(url, { method: "GET" });
  let r = await cache.match(key);
  if (!r) {
    const up = await fetch(url, { headers: { "User-Agent": "myX logbook (osobni aplikace)" } });
    if (!up.ok) return new Response("Strany potápěčské: " + up.status, { status: 502, headers: CORS });
    r = new Response(await up.arrayBuffer(), { headers: { "Content-Type": up.headers.get("Content-Type") || "text/html", "Cache-Control": "max-age=86400" } });
    ctx.waitUntil(cache.put(key, r.clone()));
  }
  const out = new Response(r.body, r);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const p = url.pathname;

    // Strany potápěčské – veřejné, bez klíče
    let m = /^\/sp\/lok\/(\d{1,6})$/.exec(p);
    if (m) return proxySp(`${SP}lokaldet.asp?lok=${m[1]}`, ctx);
    if (p === "/sp/list") return proxySp(`${SP}default.asp${url.search}`, ctx);

    if (!env.MYX_KV || !env.MYX_KEY) return json({ error: "Worker nemá nastavené MYX_KV nebo MYX_KEY" }, 500);
    if (request.headers.get("X-Myx-Key") !== env.MYX_KEY) return json({ error: "Špatný klíč" }, 401);

    if (p === "/sync" && request.method === "GET") {
      const doc = (await env.MYX_KV.get("lb", "json")) || { lb: null, ver: 0 };
      const dives = [];
      let cursor;
      do {
        const l = await env.MYX_KV.list({ prefix: "d:", cursor });
        for (const k of l.keys) dives.push({ id: k.name.slice(2), num: k.metadata?.num || 0, start: k.metadata?.start || 0 });
        cursor = l.list_complete ? undefined : l.cursor;
      } while (cursor);
      return json({ lb: doc.lb, ver: doc.ver, dives });
    }
    if (p === "/sync" && request.method === "PUT") {
      const body = await request.json();
      const doc = (await env.MYX_KV.get("lb", "json")) || { lb: null, ver: 0 };
      if ((body.ver || 0) !== doc.ver) return json({ lb: doc.lb, ver: doc.ver }, 409);
      const ver = doc.ver + 1;
      await env.MYX_KV.put("lb", JSON.stringify({ lb: body.lb, ver }));
      return json({ ver });
    }
    m = /^\/dive\/([\w.-]{1,64})$/.exec(p);
    if (m && request.method === "GET") {
      const v = await env.MYX_KV.get("d:" + m[1], "arrayBuffer");
      return v ? new Response(v, { headers: { ...CORS, "Content-Type": "application/octet-stream" } }) : json({ error: "Nenalezeno" }, 404);
    }
    if (m && request.method === "PUT") {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > 2_000_000) return json({ error: "Příliš velké" }, 413);
      await env.MYX_KV.put("d:" + m[1], buf, { metadata: { num: +(request.headers.get("X-Num") || 0), start: +(request.headers.get("X-Start") || 0) } });
      return json({ ok: true });
    }
    return json({ error: "Neznámá adresa" }, 404);
  },
};
