// Stav aplikace: ponory, logbook, poloha, synchronizace přes Worker.
import { decodeDive, peekHeader, readCloudDetails, readShearwaterDb, type CloudDetail, type Dive, type RawDive } from "../core/shearwater";
import { DEFAULT_THRESHOLDS, diveWarnings, injections, summarize } from "../core/analysis";
import { cellsOfDive } from "../core/cells";
import { loadWeather } from "./weather";
import * as db from "./db";
import { aliasKey, cleanForeign, emptyLogbook, resetLogbook, mergeLogbooks, uid, distKm, siteCoords, norm, META_V, type Alias, type Computer, type Logbook, type Meta, type Site, type Buddy, type DiveNote, type Draft, type Cell, type Battery, type WeatherSnap } from "./model";
import { syncKey, workerUrl } from "./config";

export interface Pos { lat: number; lon: number; acc: number; at: number }
export interface State {
  ready: boolean;
  metas: Meta[];           // seřazené od nejstaršího, index+1 = moje číslo ponoru
  lb: Logbook;
  pos: Pos | null; posErr: string | null;
  sync: { state: "off" | "idle" | "busy" | "error"; msg: string; at: number };
  toast: string | null;
  guest: GuestLog | null;  // prohlížený cizí log (jen pro čtení); null = vlastní data
  guestRev: number;        // mění se při přidání / odebrání cizího logu (přenačtení návrhů)
}
/** Cizí log uložený v samostatné databázi, nikdy se nesynchronizuje. */
export interface GuestLog { id: string; name: string; count: number; added: number; serial?: string; model?: string; /** u skupiny počítačů jednoho majitele: všechny jeho logy (hlavní první) */ logs?: GuestLog[] }

let st: State = {
  ready: false, metas: [], lb: emptyLogbook(), pos: null, posErr: null,
  sync: { state: "off", msg: "", at: 0 }, toast: null, guest: null, guestRev: 0,
};
const subs = new Set<() => void>();
export const getState = () => st;
export const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
function set(p: Partial<State>) { st = { ...st, ...p }; subs.forEach((f) => f()); }

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: null }), 3500);
}

const sortMetas = (m: Meta[]) => [...m].sort((a, b) => a.start - b.start);
export const myNum = (id: string) => st.metas.findIndex((m) => m.id === id) + 1;

// ---------- dekódované ponory (mezipaměť v paměti)
const diveCache = new Map<string, Promise<Dive>>();
export function loadDive(id: string): Promise<Dive> {
  let p = diveCache.get(id);
  if (!p) {
    p = db.get<RawDive>("raw", id, st.guest ? db.GUEST : undefined).then((r) => { if (!r) throw new Error("Ponor není v telefonu"); return decodeDive(r); });
    diveCache.set(id, p);
  }
  return p;
}

/** Ponor z cizího logu (pro porovnání), bez ohledu na to, zda je cizí log právě otevřený. */
export function loadGuestDive(id: string): Promise<Dive> {
  return db.get<RawDive>("raw", id, db.GUEST).then((r) => { if (!r) throw new Error("Ponor cizího logu není v telefonu"); return decodeDive(r); });
}

async function metaOf(raw: RawDive): Promise<Meta> {
  const d = await decodeDive(raw);
  // hloubka po 30 s za prvních 30 min – pro párování společných ponorů podle profilu
  const prof: number[] = []; let j = 0;
  for (let t = 0; t <= 1800 && t <= d.h.diveTimeS; t += 30) { while (j + 1 < d.s.t.length && d.s.t[j] < t) j++; prof.push(Math.round(d.s.depth[j] * 10) / 10); }
  const sum = summarize(d);
  // oranžová a červená varování (výchozí prahy) – pro tagy v seznamu ponorů
  const warns = diveWarnings(d, sum, DEFAULT_THRESHOLDS).filter((w) => w.level === "warn" || w.level === "bad").map((w) => ({ level: w.level as "warn" | "bad", title: w.title, text: w.text }));
  return { id: raw.id, num: d.h.num, start: d.h.start, h: d.h, sum, inj: injections(d).length, cells: cellsOfDive(d), v: META_V, prof, warns };
}

// ---------- start
export async function init() {
  const [metas, raws, lb] = await Promise.all([db.getAll<Meta>("meta"), db.getAll<RawDive>("raw"), db.get<Logbook>("kv", "lb")]);
  const fresh = metas.filter((m) => m.v === META_V);
  const have = new Set(fresh.map((m) => m.id));
  const missing = raws.filter((r) => !have.has(r.id));
  for (const r of missing) { const m = await metaOf(r); fresh.push(m); await db.put("meta", m); }
  set({ ready: true, metas: sortMetas(fresh), lb: lb ? mergeLogbooks(emptyLogbook(), lb) : emptyLogbook() });
  await autoLinkDrafts();
  await cleanupForeign();
  propagateExisting().catch(() => {});
  if (workerUrl() && syncKey()) syncNow();
  else set({ sync: { state: "off", msg: "Synchronizace není nastavená", at: 0 } });
}

async function saveLb(lb: Logbook) {
  if (st.guest) { toast("Cizí log je jen k prohlížení"); return; }
  set({ lb });
  await db.put("kv", lb, "lb");
  scheduleSync();
}

// ---------- import exportu Shearwater Cloud
/** Sériové číslo počítače z názvu souboru v Shearwater Cloud („Petrel 2[306E13C5]#…“). */
const serialOf = (fn?: string) => (/\[([0-9A-F]+)\]/i.exec(fn || "")?.[1] || "").toUpperCase();
/** Sériová čísla mých počítačů (z mých ponorů). */
export const serialHex = (m: Meta) => (m.h.serial || 0).toString(16).toUpperCase();
/** Moje počítače: ze sériových čísel mých ponorů a počítače cíleně označené jako moje. */
export const ownSerials = () => new Set([...ownMetas().map(serialHex).filter((x) => x !== "0"), ...Object.values(ownLb().computers || {}).filter((c) => c.mine).map((c) => c.id)]);
/** Moje počítače s počtem ponorů (Nastavení → Výbava). */
export function ownComputers(): { serial: string; model: string; count: number; from: number; to: number }[] {
  const by = new Map<string, Meta[]>();
  for (const m of ownMetas()) { const k = serialHex(m); by.set(k, [...(by.get(k) || []), m]); }
  return [...by].map(([serial, ms]) => ({ serial, model: ownLb().computers?.[serial]?.model || "Počítač", count: ms.length, from: Math.min(...ms.map((m) => m.start)), to: Math.max(...ms.map((m) => m.start)) }));
}

/**
 * Import exportu Shearwater Cloud. K mým ponorům jdou jen ponory mých počítačů (při úplně prvním importu počítač
 * s nejvíc ponory); každý jiný počítač se načte jako samostatný cizí log jen pro čtení. Logy se nikdy nekombinují.
 */
export async function importAny(file: File): Promise<{ own: number; guests: GuestLog[] }> {
  if (st.guest) closeGuest();
  const buf = new Uint8Array(await file.arrayBuffer());
  // SQLite databáze začíná „SQLite format 3“ – jiný soubor (fotka, záloha .json…) odmítnout srozumitelně
  if (new TextDecoder().decode(buf.subarray(0, 15)) !== "SQLite format 3") throw new Error("Soubor není databáze Shearwater (.db). V Shearwater Cloudu: Profil → Možnosti → Export (*.db).");
  const raws = readShearwaterDb(buf);
  if (!raws.length) { toast("V souboru nejsou žádné ponory"); return { own: 0, guests: [] }; }
  const groups = new Map<string, RawDive[]>();
  for (const r of raws) { const k = serialOf(r.fn); groups.set(k, [...(groups.get(k) || []), r]); }
  let mine = ownSerials();
  if (!mine.size && !st.metas.length) {
    const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
    mine = new Set([sorted[0][0]]);
    // první import s víc počítači: cíleně se zeptat, které jsou moje (výměna počítače)
    for (const [k, v] of sorted.slice(1)) if (k && confirm(`V souboru je víc počítačů. Je počítač ${modelOf(v)} ${k} (${v.length} ponorů) také tvůj?\n\nOK = přidat k mým ponorům, Zrušit = načíst jako log buddyho.`)) mine.add(k);
    if (mine.size > 1) { const lb = structuredClone(st.lb); lb.computers = lb.computers || {}; for (const k of mine) if (k) lb.computers[k] = { ...lb.computers[k], id: k, model: modelOf(groups.get(k)!), mine: true, updated: Date.now() }; await saveLb(lb); }
  }
  const ownRaws = [...groups].filter(([k]) => mine.has(k) || (!k && groups.size === 1 && mine.size === 0)).flatMap(([, v]) => v);
  const own = ownRaws.length ? await importOwn(buf, file.name, ownRaws) : 0;
  const guests: GuestLog[] = [];
  for (const [k, v] of groups) if (!mine.has(k) && !ownRaws.includes(v[0])) { const g = await importGuestRaws(buf, v, false); if (g) guests.push(g); }
  return { own, guests };
}

/** Původní ruční import z Přehledu – vrací počet nových vlastních ponorů. */
export async function importDb(file: File): Promise<number> {
  const r = await importAny(file);
  if (r.guests.length) toast(`Načteno jako cizí log: ${r.guests.map((g) => ownerName(g) || g.name).join(", ")}`);
  return r.own;
}

const modelOf = (v: RawDive[]) => (/^(.*?)\[/.exec(v.find((r) => r.fn)?.fn || "")?.[1] || "Počítač").trim();

/** Cizí log je ve skutečnosti můj počítač (výměna počítače): ponory přesunout k mým, převzít lokality a buddye, cizí log smazat. */
export async function adoptGuestAsOwn(log: GuestLog): Promise<number> {
  if (st.guest) closeGuest();
  const data = await db.get<{ metas: Meta[]; lb: Logbook }>("kv", log.id, db.GUEST);
  if (!data) throw new Error("Log se nepodařilo načíst");
  const pre = log.id + ":";
  const have = new Set(st.metas.map((m) => m.id));
  const added: Meta[] = [];
  const cloud = new Map<string, CloudDetail>();
  for (const gm of data.metas) {
    const raw = await db.get<RawDive>("raw", gm.id, db.GUEST);
    if (!raw) continue;
    const id = gm.id.startsWith(pre) ? gm.id.slice(pre.length) : gm.id;
    const n = data.lb.notes[gm.id];
    if (n) cloud.set(id, { site: n.siteId ? data.lb.sites[n.siteId]?.name || "" : "", buddies: n.buddyIds.map((b) => data.lb.buddies[b]?.name).filter((x): x is string => !!x), notes: n.note || "" });
    if (have.has(id)) continue;
    const own: RawDive = { ...raw, id };
    await db.put("raw", own);
    const m = await metaOf(own);
    await db.put("meta", m);
    added.push(m);
    pendingUpload.add(id);
  }
  let lb = structuredClone(st.lb);
  if (log.serial) { lb.computers = lb.computers || {}; lb.computers[log.serial] = { ...lb.computers[log.serial], id: log.serial, model: log.model || log.name, buddyId: undefined, mine: true, updated: Date.now() }; }
  lb = applyCloud(lb, cloud, new Set(added.map((m) => m.id)));
  for (const m of added) delete lb.deleted[m.id];
  await saveLb(lb);
  set({ metas: sortMetas([...st.metas, ...added]) });
  await deleteGuest(log);
  await autoLinkDrafts();
  scheduleSync();
  return added.length;
}

/** Odebere počítač z mých: smaže jeho ponory z mého logbooku (jdou pak načíst jako cizí log). */
export async function removeOwnComputer(serial: string): Promise<number> {
  if (st.guest) closeGuest();
  const gone = st.metas.filter((m) => serialHex(m) === serial);
  const lb = structuredClone(st.lb), now = Date.now();
  for (const m of gone) { await db.del("raw", m.id); await db.del("meta", m.id); delete lb.notes[m.id]; lb.deleted[m.id] = now; pendingUpload.delete(m.id); }
  if (lb.computers?.[serial]) { lb.computers[serial] = { ...lb.computers[serial], mine: false, updated: now }; }
  await saveLb(lb);
  set({ metas: st.metas.filter((m) => serialHex(m) !== serial) });
  scheduleSync();
  return gone.length;
}

async function importOwn(buf: Uint8Array, name: string, raws: RawDive[]): Promise<number> {
  await db.put("kv", { name: name || "Shearwater_Cloud.db", at: Date.now(), count: raws.length, data: buf }, "orig"); // pro sdílení buddymu
  const cloud = readCloudDetails(buf);
  if (cloud.size) { const lb = applyCloud(st.lb, cloud, new Set(raws.map((r) => r.id))); if (lb !== st.lb) await saveLb(lb); }
  const have = new Set(st.metas.map((m) => m.id));
  const added: Meta[] = [];
  for (const r of raws) {
    if (have.has(r.id)) continue;
    const ph = await peekHeader(r.blob);
    const raw: RawDive = { ...r, num: ph.num, start: ph.start, blob: r.blob.slice() };
    await db.put("raw", raw);
    const m = await metaOf(raw);
    await db.put("meta", m);
    added.push(m);
    pendingUpload.add(raw.id);
  }
  if (!added.length) return 0;
  set({ metas: sortMetas([...st.metas, ...added]) });
  await autoLinkDrafts();
  scheduleSync();
  return added.length;
}

/**
 * Převezme lokalitu, buddy a poznámku zapsané v Shearwater Cloud – jen tam, kde v myX u ponoru ještě nic není.
 * Lokality a buddy se párují podle jména, chybějící se založí.
 */
export function applyCloud(lb0: Logbook, cloud: Map<string, CloudDetail>, ids: Set<string>): Logbook {
  const lb = structuredClone(lb0);
  let changed = false;
  const now = Date.now();
  const siteBy = (name: string) => {
    const n = norm(name);
    let s = Object.values(lb.sites).find((x) => norm(x.name) === n);
    if (!s) { s = { id: uid(), name, updated: now }; lb.sites[s.id] = s; }
    return s.id;
  };
  const buddyBy = (name: string) => {
    const n = norm(name);
    let b = Object.values(lb.buddies).find((x) => norm(x.name) === n);
    if (!b) { b = { id: uid(), name, updated: now }; lb.buddies[b.id] = b; }
    return b.id;
  };
  for (const [id, c] of cloud) {
    if (!ids.has(id)) continue;
    const cur = lb.notes[id] || { buddyIds: [], note: "", updated: 0 };
    const next = { ...cur };
    if (!cur.siteId && c.site) next.siteId = siteBy(c.site);
    if (!cur.buddyIds.length && c.buddies.length) next.buddyIds = c.buddies.map(buddyBy);
    if (!cur.note && c.notes) next.note = c.notes;
    if (next.siteId !== cur.siteId || next.buddyIds !== cur.buddyIds || next.note !== cur.note) { lb.notes[id] = { ...next, updated: now }; changed = true; }
  }
  return changed ? lb : lb0;
}

// ---------- cizí logy (jen k prohlížení, oddělená databáze, bez synchronizace)
let own: { metas: Meta[]; lb: Logbook } | null = null;
/** Vlastní logbook a ponory i během prohlížení cizího logu. */
export const ownLb = (): Logbook => own?.lb ?? st.lb;
export const ownMetas = (): Meta[] => own?.metas ?? st.metas;
/** Změna mých dat – při otevřeném cizím logu se uloží stranou (neprojeví se v cizím zobrazení). */
function setOwn(p: { metas?: Meta[]; lb?: Logbook }) {
  if (own) own = { ...own, ...p }; else set(p);
}
/** Uloží změnu vlastního logbooku i během prohlížení cizího logu (synchronizace proběhne po zavření). */
async function saveOwnLb(lb: Logbook) {
  if (!st.guest) return saveLb(lb);
  own = { ...own!, lb };
  await db.put("kv", lb, "lb");
  await openGuest(st.guest); // znovu načíst cizí log s novými jmény a majitelem
}
export const ME = "__me__";
/** Moje jméno/lokalita pro jméno z cizího logu podle přiřazení nebo shody názvu; ME = „to jsem já“, null = neznámé. */
export function resolveForeign(kind: "buddy" | "site", name: string, lb: Logbook = ownLb()): string | null {
  const a = lb.aliases?.[aliasKey(kind, name)];
  if (a) return a.targetId;
  const n = norm(name);
  return Object.values(kind === "buddy" ? lb.buddies : lb.sites).find((x) => norm(x.name) === n)?.id ?? null;
}

/** Jména v cizím logu nahradí moje jména podle přiřazení (alias) nebo shody názvu. */
function withAliases(g: Logbook, mine: Logbook): Logbook {
  const map = <T extends { name: string }>(kind: "buddy" | "site", items: Record<string, T>, my: Record<string, { name: string }>) =>
    Object.fromEntries(Object.entries(items).map(([k, v]) => {
      const a = mine.aliases?.[aliasKey(kind, v.name)];
      if (a?.targetId === ME) return [k, { ...v, name: "Já" }];
      const t = a ? my[a.targetId] : undefined;
      return [k, t ? { ...v, name: t.name } : v];
    }));
  return { ...g, buddies: map("buddy", g.buddies, mine.buddies), sites: map("site", g.sites, mine.sites) };
}
/** Jména buddyů a lokalit z cizích logů, která nemám přiřazená ani shodná s mými (počet ponorů, ve kterých se vyskytují). */
export async function foreignNames(kind: "buddy" | "site"): Promise<{ name: string; n: number; logs: string[] }[]> {
  const lb = ownLb(), my = new Set(Object.values(kind === "buddy" ? lb.buddies : lb.sites).map((x) => norm(x.name)));
  const owners = new Set(Object.values(lb.computers || {}).map((c) => (c.buddyId ? norm(lb.buddies[c.buddyId]?.name || "") : "")));
  const out = new Map<string, { name: string; n: number; logs: Set<string> }>();
  for (const log of await guestLogs()) {
    const d = await db.get<{ lb: Logbook }>("kv", log.id, db.GUEST);
    if (!d) continue;
    const items = kind === "buddy" ? d.lb.buddies : d.lb.sites;
    for (const note of Object.values(d.lb.notes)) {
      for (const id of kind === "buddy" ? note.buddyIds : note.siteId ? [note.siteId] : []) {
        const name = items[id]?.name; if (!name) continue;
        const k = norm(name);
        if (my.has(k) || lb.aliases?.[aliasKey(kind, name)] || (kind === "buddy" && owners.has(k))) continue;
        const e = out.get(k) || { name, n: 0, logs: new Set<string>() };
        e.n++; e.logs.add(ownerName(log) || log.name); out.set(k, e);
      }
    }
  }
  return [...out.values()].sort((a, b) => b.n - a.n).map((x) => ({ name: x.name, n: x.n, logs: [...x.logs] }));
}
/** Jméno z cizího logu: založit jako mého buddyho/lokalitu (targetId = null), nebo přiřadit k existujícímu. */
export async function adoptForeign(kind: "buddy" | "site", name: string, targetId: string | null, keepName?: string): Promise<number> {
  const lb = structuredClone(ownLb());
  let id = targetId;
  if (!id && kind === "buddy" && norm(name) === "ja") id = ME;
  if (!id) {
    id = uid();
    if (kind === "buddy") lb.buddies[id] = { id, name, updated: Date.now() };
    else lb.sites[id] = { id, name, updated: Date.now() };
  } else if (id !== ME && keepName && keepName.trim()) { // zvolený název po sloučení
    const t = kind === "buddy" ? lb.buddies[id] : lb.sites[id];
    if (t && t.name !== keepName.trim()) { t.name = keepName.trim(); t.updated = Date.now(); }
  }
  const key = aliasKey(kind, name);
  lb.aliases = { ...(lb.aliases || {}), [key]: { id: key, kind, name, targetId: id, updated: Date.now() } as Alias };
  const n = await propagate(lb);
  await saveOwnLb(lb);
  return n;
}

/**
 * Propíše přiřazená jména z cizích logů do mých ponorů: lokalitu k ponorům bez lokality, buddyho ke společným ponorům
 * (vždy můj název). Upravuje lb na místě, vrací počet změněných ponorů.
 */
async function propagate(lb: Logbook): Promise<number> {
  const ix = await guestIndexLoad();
  let changed = 0;
  for (const m of ownMetas()) {
    for (const { log, metas, lb: g } of ix) {
      const gm = nearestPair(metas, m)[0];
      const gn = gm && g.notes[gm.id];
      if (!gn) continue;
      const owner = log.serial ? lb.computers?.[log.serial]?.buddyId : undefined;
      const note = lb.notes[m.id] || { buddyIds: [], note: "", updated: 0 };
      let next = note;
      if (owner && owner !== ME && lb.buddies[owner] && !next.buddyIds.includes(owner)) next = { ...next, buddyIds: [...next.buddyIds, owner] };
      // lokalita: přiřazení (alias) nebo přesná shoda s mojí lokalitou → vždy moje lokalita
      const sn = gn.siteId ? g.sites[gn.siteId]?.name : undefined;
      const sid = sn ? resolveForeign("site", sn, lb) : null;
      if (!next.siteId && sid && sid !== ME && lb.sites[sid]) next = { ...next, siteId: sid };
      for (const b of gn.buddyIds) {
        const bn = g.buddies[b]?.name; if (!bn) continue;
        const bid = resolveForeign("buddy", bn, lb);
        if (!bid || bid === ME || bid === owner || !lb.buddies[bid] || next.buddyIds.includes(bid)) continue;
        if (owner && norm(lb.buddies[owner]?.name || "") === norm(bn)) continue;
        next = { ...next, buddyIds: [...next.buddyIds, bid] };
      }
      if (next !== note) { lb.notes[m.id] = { ...next, updated: Date.now() }; changed++; }
    }
  }
  return changed;
}
/** Jednorázový úklid: data cizích logů, která se dřív omylem dostala do mého logbooku (synchronizace během otevírání cizího logu). */
async function cleanupForeign() {
  if (await db.get("kv", "cleanForeign1")) return;
  const r = cleanForeign(st.lb, new Set(st.metas.map((m) => m.id)));
  if (r.notes) { await saveLb(r.lb); toast(`Uklizeno z cizích logů: ${r.notes} záznamů${r.names.length ? `, ${r.names.length} jmen` : ""}`); }
  await db.put("kv", 1, "cleanForeign1");
}
/** Jednorázově propíše už dřív provedená přiřazení (po aktualizaci aplikace). */
export async function propagateExisting() {
  if (st.guest || (await db.get("kv", "aliasProp3"))) return;
  const lb = structuredClone(ownLb());
  const n = await propagate(lb);
  if (n) { await saveLb(lb); toast(`Doplněno z logů buddyů k ${n} ponorům`); }
  await db.put("kv", 1, "aliasProp3");
}

/** Návrhy od buddyů k mému ponoru: lokalita a buddy zapsaní v jejich logu u stejného ponoru. */
export interface Suggest { who: string; site: { name: string; mine: string | null } | null; buddies: { name: string; mine: string | null }[] }
export async function suggestionsFor(m: Meta): Promise<Suggest[]> {
  const lb = ownLb(), note = lb.notes[m.id];
  const out: Suggest[] = [];
  for (const { log, metas, lb: g } of await guestIndexLoad()) {
    const gm = nearestPair(metas, m)[0];
    if (!gm) continue;
    const gn = g.notes[gm.id];
    if (!gn) continue;
    const owner = log.serial ? lb.computers?.[log.serial]?.buddyId : undefined;
    const site = gn.siteId && g.sites[gn.siteId] ? { name: g.sites[gn.siteId].name, mine: resolveForeign("site", g.sites[gn.siteId].name, lb) } : null;
    const buddies = gn.buddyIds.map((b) => g.buddies[b]?.name).filter((x): x is string => !!x)
      .map((name) => ({ name, mine: resolveForeign("buddy", name, lb) }))
      .filter((x) => x.mine !== ME && x.mine !== owner && !(x.mine && note?.buddyIds.includes(x.mine)) && !(owner && norm(lb.buddies[owner]?.name || "") === norm(x.name)));
    if (site || buddies.length) out.push({ who: ownerName(log) || log.name, site, buddies });
  }
  return out;
}
/** Přiřadí k mému ponoru lokalitu / buddyho z logu buddyho (neznámé jméno založí a zapamatuje). */
export async function applySuggestion(diveId: string, kind: "site" | "buddy", name: string) {
  let id = resolveForeign(kind, name);
  if (!id) { await adoptForeign(kind, name, null); id = resolveForeign(kind, name); }
  if (!id || id === ME) return;
  const n = ownLb().notes[diveId] || { buddyIds: [], note: "", updated: 0 };
  await setNote(diveId, kind === "site" ? { siteId: id } : { buddyIds: [...new Set([...n.buddyIds, id])] });
}

/** Načtené cizí logy s jejich ponory (pro hledání společných ponorů). */
let guestIndex: { log: GuestLog; metas: Meta[]; lb: Logbook; alts: Meta[] }[] | null = null;
/** Data jednoho cizího logu (jednoho počítače); přepočítá metadata po změně verze výpočtů. */
async function guestData(log: GuestLog): Promise<{ metas: Meta[]; lb: Logbook } | null> {
  const data = await db.get<{ metas: Meta[]; lb: Logbook }>("kv", log.id, db.GUEST);
  if (!data) return null;
  if (data.metas.some((m) => m.v !== META_V)) {
    const fresh: Meta[] = [];
    for (const m of data.metas) { const raw = await db.get<RawDive>("raw", m.id, db.GUEST); if (raw) fresh.push(await metaOf(raw)); }
    data.metas = fresh;
    await db.put("kv", data, log.id, db.GUEST);
  }
  return data;
}
/** Logy jednotlivých počítačů (bez seskupení podle majitele). */
let guestRaw: { log: GuestLog; metas: Meta[]; lb: Logbook }[] | null = null;
export async function guestRawIndex(): Promise<{ log: GuestLog; metas: Meta[]; lb: Logbook }[]> {
  if (guestRaw) return guestRaw;
  const out: { log: GuestLog; metas: Meta[]; lb: Logbook }[] = [];
  for (const log of await guestLogs()) { const d = await guestData(log); if (d) out.push({ log, metas: d.metas, lb: d.lb }); }
  guestRaw = out;
  return out;
}
export const compLabel = (log: GuestLog) => `${log.model || "Počítač"}${log.serial ? " " + log.serial : ""}`;
/**
 * Seskupí logy počítačů podle majitele (víc počítačů jednoho buddyho = jeden účastník).
 * Hlavní počítač: označený u majitele, jinak ten s nejvíc ponory. Ponor ze záložního počítače, který se páruje
 * s ponorem hlavního (současné použití), se nezobrazí zvlášť – hlavní ponor dostane odkaz `alt`.
 */
export function groupGuests(raw: { log: GuestLog; metas: Meta[]; lb: Logbook }[], lb: Logbook): { log: GuestLog; metas: Meta[]; lb: Logbook; alts: Meta[] }[] {
  const groups = new Map<string, typeof raw>();
  for (const x of raw) { const b = x.log.serial ? lb.computers?.[x.log.serial]?.buddyId : undefined; const k = b ? "b:" + b : "l:" + x.log.id; groups.set(k, [...(groups.get(k) || []), x]); }
  return [...groups.values()].map((g) => {
    const prim = (x: (typeof raw)[0]) => (x.log.serial && lb.computers?.[x.log.serial]?.primary ? 1 : 0);
    g = [...g].sort((a, b) => prim(b) - prim(a) || b.metas.length - a.metas.length);
    const multi = g.length > 1;
    const metas: Meta[] = g[0].metas.map((m) => (multi ? { ...m, comp: compLabel(g[0].log) } : m));
    const alts: Meta[] = [];
    for (const x of g.slice(1)) for (const m of x.metas) {
      const mm = { ...m, comp: compLabel(x.log) };
      const p = nearestPair(metas.filter((q) => !q.alt), mm)[0];
      if (p && Math.abs(p.start - mm.start) <= PAIR_S) { p.alt = mm.id; alts.push(mm); } else metas.push(mm);
    }
    const mlb = g.reduce((acc, x) => ({ ...acc, notes: { ...acc.notes, ...x.lb.notes }, sites: { ...acc.sites, ...x.lb.sites }, buddies: { ...acc.buddies, ...x.lb.buddies } }), { ...g[0].lb });
    const log: GuestLog = multi ? { ...g[0].log, count: metas.length, logs: g.map((x) => x.log) } : g[0].log;
    return { log, metas: sortMetas(metas), lb: mlb, alts };
  });
}
/** Cizí logy seskupené podle majitele (pro párování, srovnání, převzaté údaje). */
export async function guestIndexLoad(): Promise<{ log: GuestLog; metas: Meta[]; lb: Logbook; alts: Meta[] }[]> {
  if (guestIndex) return guestIndex;
  guestIndex = groupGuests(await guestRawIndex(), ownLb());
  return guestIndex;
}
/** Max. rozdíl začátků pro spárování podle profilu – hodiny se rozcházejí o minuty a kolem změny letního času i o hodinu. */
export const PAIR_S = 5400;
/** Bez profilu (nelze porovnat) se páruje jen podle času do ±20 min. */
const PAIR_TIME_S = 1200;
/** Shoda profilů v prvních 10 minutách mého ponoru (RMSE v m) při nejlepším posunu ±10 min, nebo null. */
export function profileMatch(m: Meta, g: Meta): number | null {
  if (!m.prof || !g.prof || m.prof.length < 6 || g.prof.length < 6) return null;
  let best = Infinity;
  for (let k = -20; k <= 20; k++) { // posun buddyho v krocích 30 s
    let e = 0, n = 0;
    for (let i = 0; i <= 20 && i < m.prof.length; i++) { const j = i + k; if (j < 0 || j >= g.prof.length) continue; e += (m.prof[i] - g.prof[j]) ** 2; n++; }
    if (n >= 14) best = Math.min(best, Math.sqrt(e / n));
  }
  return isFinite(best) ? best : null;
}
/** Společný ponor buddyho: začátek do ±90 min (posun hodin i o hodinu) a shoda profilu v prvních 10 minutách (≤ 3 m);
 *  bez profilu jen podle času do ±20 min. Z více kandidátů vyhrává nejlepší shoda profilu. */
export function nearestPair(metas: Meta[], m: Meta): Meta[] {
  let best: Meta | null = null, bestE = Infinity;
  for (const g of metas) {
    if (Math.abs(g.start - m.start) > PAIR_S) continue;
    const e = profileMatch(m, g) ?? (Math.abs(g.start - m.start) <= PAIR_TIME_S ? 2.9 : Infinity); // bez profilu jen podle času
    if (e <= 3 && e < bestE) { best = g; bestE = e; }
  }
  return best ? [best] : [];
}
/** Odhad odchylky hodin počítače buddyho z časů začátku společných ponorů (s, + = jdou napřed). */
export async function clockDrift(serial: string): Promise<{ at: number; diff: number }[]> {
  const ix = (await guestRawIndex()).find((x) => x.log.serial === serial);
  if (!ix) return [];
  return ownMetas().flatMap((m) => nearestPair(ix.metas, m).map((g) => ({ at: m.start, diff: g.start - m.start })));
}

/** Ponory buddyho z cizích logů, které časově odpovídají ponoru (začátek do ±15 min). */
export async function buddyDivesFor(m: Meta): Promise<{ log: GuestLog; meta: Meta; owner: string | null }[]> {
  const lb = ownLb();
  return (await guestIndexLoad()).flatMap(({ log, metas }) => nearestPair(metas, m).map((g) => {
    const c = log.serial ? lb.computers?.[log.serial] : undefined;
    return { log, meta: g, owner: c?.buddyId ? lb.buddies[c.buddyId]?.name ?? null : null };
  }));
}
export const ownerName = (log: GuestLog): string | null => {
  const lb = ownLb(); const c = log.serial ? lb.computers?.[log.serial] : undefined;
  return c?.buddyId ? lb.buddies[c.buddyId]?.name ?? null : null;
};
/** Přiřadí cizí počítač (sériové číslo) buddymu; nové jméno založí jako buddyho. Doplní buddyho ke společným ponorům. */
export async function setComputerOwner(log: GuestLog, buddy: { id?: string; name?: string } | null) {
  if (!log.serial) return;
  const lb = structuredClone(ownLb());
  lb.computers = lb.computers || {};
  let bid = buddy?.id;
  if (!bid && buddy?.name) {
    const n = norm(buddy.name);
    bid = Object.values(lb.buddies).find((b) => norm(b.name) === n)?.id;
    if (!bid) { bid = uid(); lb.buddies[bid] = { id: bid, name: buddy.name.trim(), updated: Date.now() }; }
  }
  const c: Computer = { ...lb.computers[log.serial], id: log.serial, model: log.model || log.name, buddyId: bid, updated: Date.now() };
  lb.computers[log.serial] = c;
  if (bid) { // doplnit buddyho k mým ponorům, které se časově shodují s ponory z jeho počítače
    const g = (await guestRawIndex()).find((x) => x.log.id === log.id)?.metas || [];
    for (const m of ownMetas()) {
      if (!nearestPair(g, m).length) continue;
      const n = lb.notes[m.id] || { buddyIds: [], note: "", updated: 0 };
      if (!n.buddyIds.includes(bid)) lb.notes[m.id] = { ...n, buddyIds: [...n.buddyIds, bid], updated: Date.now() };
    }
  }
  guestIndex = null;
  await saveOwnLb(lb);
  set({ guestRev: st.guestRev + 1 });
}
/** Hlavní počítač majitele (ze kterého se bere ponor, když potápěl se dvěma počítači současně). */
export async function setPrimaryComputer(serial: string) {
  const lb = structuredClone(ownLb());
  const c = lb.computers?.[serial]; if (!c) return;
  for (const x of Object.values(lb.computers || {})) if (x.buddyId && x.buddyId === c.buddyId && x.primary) { x.primary = false; x.updated = Date.now(); }
  c.primary = true; c.updated = Date.now();
  guestIndex = null;
  await saveOwnLb(lb);
  set({ guestRev: st.guestRev + 1 });
}
export async function guestLogs(): Promise<GuestLog[]> {
  return ((await db.get<GuestLog[]>("kv", "logs", db.GUEST)) || []).sort((a, b) => b.added - a.added);
}
export async function importGuest(file: File): Promise<GuestLog | null> {
  const r = await importAny(file);
  if (r.own) toast(`Přidáno ${r.own} tvých ponorů (tvůj počítač)`);
  if (r.guests[0]) await openGuest(r.guests[0]);
  return r.guests[0] || null;
}
async function importGuestRaws(buf: Uint8Array, raws: RawDive[], open = true): Promise<GuestLog | null> {
  if (!raws.length) return null;
  const fn = raws.find((r) => r.fn)?.fn || "";
  const model = (/^(.*?)\[/.exec(fn)?.[1] || "Počítač").trim();
  const serial = serialOf(fn);
  const id = uid();
  const metas: Meta[] = [];
  for (const r of raws) {
    try {
      const ph = await peekHeader(r.blob);
      const raw: RawDive = { ...r, id: `${id}:${r.id}`, num: ph.num, start: ph.start, blob: r.blob.slice() };
      await db.put("raw", raw, undefined, db.GUEST);
      metas.push(await metaOf(raw));
    } catch { /* poškozený ponor přeskočit */ }
  }
  const ids = new Set(raws.map((r) => r.id));
  const cloud = new Map([...readCloudDetails(buf)].filter(([k]) => ids.has(k)).map(([k, v]) => [`${id}:${k}`, v]));
  const lb = applyCloud(emptyLogbook(), cloud, new Set(metas.map((m) => m.id)));
  await db.put("kv", { metas, lb }, id, db.GUEST);
  const log: GuestLog = { id, name: `${model}${serial ? " " + serial : ""}`, count: metas.length, added: Date.now(), serial: serial || undefined, model };
  // starší log ze stejného počítače nahradit, ať se nehromadí duplicity
  for (const old of (await guestLogs()).filter((l) => log.serial && l.serial === log.serial)) await deleteGuest(old);
  await db.put("kv", [log, ...(await guestLogs())], "logs", db.GUEST);
  guestIndex = null; guestRaw = null;
  set({ guestRev: st.guestRev + 1 });
  const known = log.serial ? ownLb().computers?.[log.serial] : undefined;
  if (known?.buddyId) await setComputerOwner(log, { id: known.buddyId }); // stejný počítač už má majitele
  if (open) await openGuest(log);
  return log;
}
/** Původní soubor posledního importu (export Shearwater Cloud) – pro sdílení buddymu. */
export async function lastExport(): Promise<{ name: string; at: number; count: number; data: Uint8Array } | undefined> {
  return db.get("kv", "orig");
}

/** Soubor sdílený do aplikace (Web Share Target) – načte se jako cizí log. Vrací log a jeho nejnovější ponor. */
/** Soubor s víc cizími počítači: zeptat se, zda patří jednomu člověku, a přiřadit jim stejného majitele. */
export async function askSameOwner(logs: GuestLog[]) {
  const withSerial = logs.filter((l) => l.serial);
  if (withSerial.length < 2) return;
  if (!confirm(`V souboru jsou ${withSerial.length} různé počítače (${withSerial.map(compLabel).join(", ")}). Patří stejnému člověku?`)) return;
  const known = withSerial.map((l) => ownerName(l)).find(Boolean);
  const name = prompt("Jméno majitele (buddyho):", known || "");
  if (!name?.trim()) return;
  for (const l of withSerial) await setComputerOwner(l, { name: name.trim() });
  toast(`Počítače spojeny pod majitele ${name.trim()}`);
}

export async function takeShared(): Promise<{ log: GuestLog | null; last: Meta | null; mine: Meta | null; own: number } | null> {
  if (!("caches" in self)) return null;
  const c = await caches.open("myx-share");
  const r = await c.match("shared.db");
  if (!r) return null;
  await c.delete("shared.db");
  const name = decodeURIComponent(r.headers.get("X-Name") || "sdileny.db");
  const file = new File([await r.blob()], name);
  const res = await importAny(file);
  const log = res.guests[0] || null;
  if (res.guests.length > 1) await askSameOwner(res.guests);
  if (!log) return { log: null, last: [...st.metas].sort((a, b) => b.start - a.start)[0] || null, mine: null, own: res.own };
  await openGuest(log);
  const last = [...st.metas].sort((a, b) => b.start - a.start)[0] || null;
  const mine = last ? ownMetas().find((m) => nearestPair([last], m).length > 0) || null : null;
  return { log, last, mine, own: res.own };
}

export async function openGuest(log: GuestLog) {
  const ix = await guestIndexLoad();
  const g = ix.find((x) => x.log.id === log.id || x.log.logs?.some((l) => l.id === log.id));
  if (!g) { toast("Cizí log se nepodařilo načíst"); return; }
  if (!own) own = { metas: st.metas, lb: st.lb };
  diveCache.clear();
  // nastavení (limity, objemy lahví) zůstávají vlastní, čidla a baterie cizí log nemá; jména přeložit podle mých přiřazení
  set({ guest: g.log, metas: g.metas, lb: withAliases({ ...g.lb, settings: own.lb.settings }, own.lb) });
}
export function closeGuest() {
  if (!own) return;
  diveCache.clear();
  set({ guest: null, metas: own.metas, lb: own.lb });
  own = null;
  scheduleSync();
}
export async function deleteGuest(log: GuestLog) {
  if (st.guest?.id === log.id) closeGuest();
  const data = await db.get<{ metas: Meta[] }>("kv", log.id, db.GUEST);
  for (const m of data?.metas || []) await db.del("raw", m.id, db.GUEST);
  await db.del("kv", log.id, db.GUEST);
  await db.put("kv", (await guestLogs()).filter((l) => l.id !== log.id), "logs", db.GUEST);
  guestIndex = null; guestRaw = null;
  set({ guestRev: st.guestRev + 1 });
}

// ---------- rozpracované ponory (založené na lokalitě) a jejich spárování s logem
const H = 3600;
/** Ponory z počítače, které časově odpovídají rozpracovanému ponoru (začátek −3 h až +6 h od založení). */
export function draftCandidates(dr: Draft): Meta[] {
  const linked = new Set(Object.values(st.lb.drafts).map((d) => d.diveId).filter(Boolean));
  return st.metas.filter((m) => !linked.has(m.id) && m.start >= dr.created - 3 * H && m.start <= dr.created + 6 * H)
    .sort((a, b) => Math.abs(a.start - dr.created) - Math.abs(b.start - dr.created));
}

async function autoLinkDrafts() {
  for (const dr of Object.values(st.lb.drafts)) {
    if (dr.diveId) continue;
    const c = draftCandidates(dr);
    if (c.length === 1) await linkDraft(dr.id, c[0].id, true);
  }
}

export async function linkDraft(draftId: string, diveId: string, auto = false) {
  const lb = structuredClone(st.lb);
  const dr = lb.drafts[draftId];
  if (!dr) return;
  const cur = lb.notes[diveId];
  lb.notes[diveId] = {
    siteId: cur?.siteId || dr.siteId,
    buddyIds: [...new Set([...(cur?.buddyIds || []), ...dr.buddyIds])],
    note: [cur?.note, dr.note].filter(Boolean).join("\n"),
    rating: dr.rating || cur?.rating,
    weather: dr.weather || cur?.weather,
    updated: Date.now(),
  };
  delete lb.drafts[draftId];
  lb.deleted[draftId] = Date.now();
  await saveLb(lb);
  if (auto) toast(`Rozpracovaný ponor spárován s ponorem č. ${myNum(diveId)}`);
}

export async function createDraft(): Promise<string> {
  const pos = st.pos && Date.now() - st.pos.at < 10 * 60000 ? st.pos : await locate();
  const near = pos ? nearestSite(pos) : null;
  const id = uid();
  const dr: Draft = { id, created: localNow(), lat: pos?.lat, lon: pos?.lon, siteId: near && near.km <= 2 ? near.site.id : undefined, buddyIds: [], note: "", updated: Date.now() };
  const lb = structuredClone(st.lb);
  lb.drafts[id] = dr;
  await saveLb(lb);
  if (pos) loadWeather(pos.lat, pos.lon).then((w) => {
    const snap: WeatherSnap = { at: Date.now(), temp: w.now.temp, wind: w.now.wind, gust: w.now.gust, cloud: w.now.cloud, pressure: w.now.pressure, precip: w.now.precip, code: w.now.code };
    if (st.lb.drafts[id]) updateDraft(id, { weather: snap });
  }).catch(() => {});
  return id;
}

export function updateDraft(id: string, patch: Partial<Draft>) {
  const lb = structuredClone(st.lb);
  if (!lb.drafts[id]) return Promise.resolve();
  lb.drafts[id] = { ...lb.drafts[id], ...patch, updated: Date.now() };
  return saveLb(lb);
}

export async function deleteDraft(id: string) {
  const lb = structuredClone(st.lb);
  delete lb.drafts[id];
  lb.deleted[id] = Date.now();
  await saveLb(lb);
}

// ---------- O₂ čidla
export async function saveCell(c: Partial<Cell> & { pos: 1 | 2 | 3; installed: string }): Promise<Cell> {
  const lb = structuredClone(st.lb);
  const cell: Cell = { maker: "", lifeM: 12, ...(c.id ? lb.cells[c.id] : {}), ...c, id: c.id || uid(), updated: Date.now() } as Cell;
  delete (cell as { photos?: unknown }).photos;
  // nové čidlo na pozici uzavře to dosavadní
  if (!c.id) for (const o of Object.values(lb.cells)) if (o.pos === cell.pos && !o.removed && o.installed <= cell.installed) lb.cells[o.id] = { ...o, removed: cell.installed, reason: o.reason || "Výměna", updated: Date.now() };
  lb.cells[cell.id] = cell;
  await saveLb(lb);
  return cell;
}
export async function deleteCell(id: string) {
  const lb = structuredClone(st.lb);
  delete lb.cells[id];
  lb.deleted[id] = Date.now();
  await saveLb(lb);
}
export async function saveBattery(b: Partial<Battery> & { pos: 1 | 2; installed: string }): Promise<Battery> {
  const lb = structuredClone(st.lb);
  const bat: Battery = { maker: "", ...(b.id ? lb.batteries[b.id] : {}), ...b, id: b.id || uid(), updated: Date.now() } as Battery;
  if (!b.id) for (const o of Object.values(lb.batteries)) if (o.pos === bat.pos && !o.removed && o.installed <= bat.installed) lb.batteries[o.id] = { ...o, removed: bat.installed, updated: Date.now() };
  lb.batteries[bat.id] = bat;
  await saveLb(lb);
  return bat;
}
export async function deleteBattery(id: string) {
  const lb = structuredClone(st.lb);
  delete lb.batteries[id];
  lb.deleted[id] = Date.now();
  await saveLb(lb);
}

export function answerCellPrompt(key: string, answer: "change" | "cal") {
  const lb = structuredClone(st.lb);
  lb.answered[key] = { answer, updated: Date.now() };
  return saveLb(lb);
}

export const localNow = () => Math.floor(Date.now() / 1000) - new Date().getTimezoneOffset() * 60;

// ---------- logbook
export function setNote(diveId: string, patch: Partial<DiveNote>) {
  const lb = structuredClone(st.lb);
  lb.notes[diveId] = Object.assign({ buddyIds: [], note: "" }, lb.notes[diveId], patch, { updated: Date.now() });
  return saveLb(lb);
}

export function findSiteByName(name: string): Site | undefined {
  const n = norm(name);
  return Object.values(st.lb.sites).find((s) => norm(s.name) === n);
}
export function findBuddyByName(name: string): Buddy | undefined {
  const n = norm(name);
  return Object.values(st.lb.buddies).find((s) => norm(s.name) === n);
}

export async function upsertSite(s: Partial<Site> & { name: string }): Promise<Site> {
  const lb = structuredClone(ownLb());
  const site: Site = { ...(s.id ? lb.sites[s.id] : {}), ...s, id: s.id || uid(), updated: Date.now() } as Site;
  lb.sites[site.id] = site;
  await saveOwnLb(lb);
  return site;
}
export async function upsertBuddy(b: Partial<Buddy> & { name: string }): Promise<Buddy> {
  const lb = structuredClone(ownLb());
  const buddy: Buddy = { ...(b.id ? lb.buddies[b.id] : {}), ...b, id: b.id || uid(), updated: Date.now() } as Buddy;
  lb.buddies[buddy.id] = buddy;
  await saveOwnLb(lb);
  return buddy;
}

/** Sloučí lokalitu/parťáka `from` do `into` (ponory se přepíšou, `from` se smaže). */
export async function mergeInto(kind: "site" | "buddy", from: string, into: string, name?: string) {
  const lb = structuredClone(ownLb());
  const now = Date.now();
  for (const [id, n] of Object.entries(lb.notes)) {
    if (kind === "site" && n.siteId === from) lb.notes[id] = { ...n, siteId: into, updated: now };
    if (kind === "buddy" && n.buddyIds.includes(from)) lb.notes[id] = { ...n, buddyIds: [...new Set(n.buddyIds.map((b) => (b === from ? into : b)))], updated: now };
  }
  for (const [id, dr] of Object.entries(lb.drafts)) {
    if (kind === "site" && dr.siteId === from) lb.drafts[id] = { ...dr, siteId: into };
    if (kind === "buddy" && dr.buddyIds.includes(from)) lb.drafts[id] = { ...dr, buddyIds: [...new Set(dr.buddyIds.map((b) => (b === from ? into : b)))] };
  }
  for (const [k, a] of Object.entries(lb.aliases || {})) if (a.targetId === from) lb.aliases![k] = { ...a, targetId: into, updated: now };
  if (kind === "buddy") for (const [k, c] of Object.entries(lb.computers || {})) if (c.buddyId === from) lb.computers![k] = { ...c, buddyId: into, updated: now };
  const target = kind === "site" ? lb.sites[into] : lb.buddies[into];
  if (target && name && name.trim() && name.trim() !== target.name) { target.name = name.trim(); target.updated = now; }
  // původní název si zapamatuj jako přiřazení k cíli (jména z logů buddyů se pak propíšou sem)
  const old = kind === "site" ? lb.sites[from] : lb.buddies[from];
  if (old && norm(old.name) !== norm(target?.name || "")) { const key = aliasKey(kind, old.name); lb.aliases = { ...(lb.aliases || {}), [key]: { id: key, kind, name: old.name, targetId: into, updated: now } as Alias }; }
  if (kind === "site") delete lb.sites[from]; else delete lb.buddies[from];
  lb.deleted[from] = now;
  const n = await propagate(lb);
  await saveOwnLb(lb);
  if (n) toast(`Doplněno z logů buddyů k ${n} ponorům`);
}
export async function remove(kind: "site" | "buddy", id: string) {
  const lb = structuredClone(ownLb());
  const now = Date.now();
  for (const [did, n] of Object.entries(lb.notes)) {
    if (kind === "site" && n.siteId === id) lb.notes[did] = { ...n, siteId: undefined, updated: now };
    if (kind === "buddy" && n.buddyIds.includes(id)) lb.notes[did] = { ...n, buddyIds: n.buddyIds.filter((b) => b !== id), updated: now };
  }
  if (kind === "site") delete lb.sites[id]; else delete lb.buddies[id];
  lb.deleted[id] = now;
  await saveOwnLb(lb);
}
export async function saveSettings(p: Partial<Logbook["settings"]>) {
  const lb = structuredClone(st.lb);
  lb.settings = { ...lb.settings, ...p, updated: Date.now() };
  await saveLb(lb);
}

// ---------- poloha
export function locate(): Promise<Pos | null> {
  return new Promise((res) => {
    if (!navigator.geolocation) { set({ posErr: "Telefon neposkytuje polohu" }); return res(null); }
    navigator.geolocation.getCurrentPosition(
      (p) => { const pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }; set({ pos, posErr: null }); res(pos); },
      (e) => { set({ posErr: e.code === 1 ? "Přístup k poloze není povolený" : "Polohu se nepodařilo zjistit" }); res(null); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 },
    );
  });
}

export function nearestSite(pos = st.pos): { site: Site; km: number } | null {
  if (!pos) return null;
  let best: { site: Site; km: number } | null = null;
  for (const s of Object.values(st.lb.sites)) {
    const c = siteCoords(s);
    if (!c) continue;
    const km = distKm(pos, c);
    if (!best || km < best.km) best = { site: s, km };
  }
  return best;
}

// ---------- synchronizace
const pendingUpload = new Set<string>();
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncing = false;
let lastSyncErr = "";
export function scheduleSync() {
  if (!workerUrl() || !syncKey() || st.guest) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1500);
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(workerUrl() + path, { ...init, headers: { ...(init?.headers || {}), "X-Myx-Key": syncKey() } });
  if (r.status === 401) throw new Error("Špatný klíč synchronizace");
  return r;
}

export async function syncNow(): Promise<void> {
  if (st.guest) return;
  if (!workerUrl() || !syncKey()) { set({ sync: { state: "off", msg: "Synchronizace není nastavená", at: 0 } }); return; }
  if (syncing || !navigator.onLine) { if (!navigator.onLine) set({ sync: { ...st.sync, state: "idle", msg: "Bez připojení – odešle se později" } }); return; }
  syncing = true;
  set({ sync: { ...st.sync, state: "busy", msg: "Synchronizuji…" } });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await api("/sync");
      if (!r.ok) throw new Error(`Worker: ${r.status}`);
      const remote = (await r.json()) as { lb: Logbook | null; ver: number; dives: { id: string; num: number; start: number }[] };
      // ponory: stáhnout chybějící, nahrát nové – vždy jen moje (i kdyby se mezitím otevřel cizí log)
      const local = new Set(ownMetas().map((m) => m.id));
      const remoteIds = new Set(remote.dives.map((d) => d.id));
      const got: Meta[] = [];
      for (const d of remote.dives) {
        if (local.has(d.id) || d.id.includes(":") || ownLb().deleted?.[d.id]) continue;
        const b = await api(`/dive/${encodeURIComponent(d.id)}`);
        if (!b.ok) continue;
        const raw: RawDive = { id: d.id, num: d.num, start: d.start, blob: new Uint8Array(await b.arrayBuffer()) };
        await db.put("raw", raw);
        const m = await metaOf(raw);
        await db.put("meta", m);
        got.push(m);
      }
      if (got.length) { setOwn({ metas: sortMetas([...ownMetas(), ...got]) }); if (!st.guest) await autoLinkDrafts(); }
      for (const m of ownMetas()) {
        if (remoteIds.has(m.id) && !pendingUpload.has(m.id)) continue;
        const raw = await db.get<RawDive>("raw", m.id);
        if (!raw) continue;
        const u = await api(`/dive/${encodeURIComponent(m.id)}`, { method: "PUT", body: raw.blob as BodyInit, headers: { "X-Num": String(raw.num), "X-Start": String(raw.start) } });
        if (u.ok) pendingUpload.delete(m.id);
      }
      // logbook – vždy můj, nikdy cizí
      const mine = ownLb();
      const merged = remote.lb ? mergeLogbooks(mine, remote.lb) : mine;
      const p = await api("/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lb: merged, ver: remote.ver }) });
      if (p.status === 409) continue; // mezitím změna z jiného zařízení – znovu
      if (!p.ok) throw new Error(`Worker: ${p.status}`);
      const next = mergeLogbooks(merged, ownLb());
      await db.put("kv", next, "lb");
      if (own) { own = { ...own, lb: next }; if (st.guest) await openGuest(st.guest); } else st = { ...st, lb: next };
      lastSyncErr = "";
      set({ sync: { state: "idle", msg: "Synchronizováno", at: Date.now() } });
      return;
    }
    throw new Error("Konflikt synchronizace, zkus to znovu");
  } catch (e) {
    const msg = (e as Error).message || "Chyba synchronizace";
    if (msg !== lastSyncErr) toast("Synchronizace selhala: " + msg);
    lastSyncErr = msg;
    set({ sync: { state: "error", msg, at: Date.now() } });
  } finally {
    syncing = false;
  }
}

/** Úplný reset logbooku (viz resetLogbook) + odebrání cizích logů; záloha na Workeru se přepíše. */
export async function resetAll(): Promise<void> {
  if (st.guest) closeGuest();
  for (const g of await guestLogs()) await deleteGuest(g);
  const lb = resetLogbook(st.lb);
  set({ lb });
  await db.put("kv", lb, "lb");
  if (workerUrl() && syncKey()) {
    try {
      for (let i = 0; i < 3; i++) {
        const r = await api("/sync");
        if (!r.ok) throw new Error(`Worker: ${r.status}`);
        const { ver } = (await r.json()) as { ver: number };
        const p = await api("/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lb, ver }) });
        if (p.status === 409) continue;
        if (!p.ok) throw new Error(`Worker: ${p.status}`);
        set({ sync: { state: "idle", msg: "Synchronizováno (reset)", at: Date.now() } });
        return;
      }
      throw new Error("Konflikt synchronizace");
    } catch (e) { toast("Reset na Workeru selhal: " + (e as Error).message + " – při další synchronizaci se smazání propíše."); }
  }
}

// ---------- záloha do souboru
export async function exportBackup(): Promise<Blob> {
  const raws = await db.getAll<RawDive>("raw");
  const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const data = { app: "myX", v: 1, lb: st.lb, dives: raws.map((r) => ({ id: r.id, num: r.num, start: r.start, blob: b64(r.blob) })) };
  return new Blob([JSON.stringify(data)], { type: "application/json" });
}
export async function importBackup(file: File): Promise<number> {
  const j = JSON.parse(await file.text());
  if (j.app !== "myX") throw new Error("Není to záloha myX");
  const have = new Set(st.metas.map((m) => m.id));
  const added: Meta[] = [];
  for (const d of j.dives) {
    if (have.has(d.id)) continue;
    const bin = Uint8Array.from(atob(d.blob), (c) => c.charCodeAt(0));
    const raw: RawDive = { id: d.id, num: d.num, start: d.start, blob: bin };
    await db.put("raw", raw);
    const m = await metaOf(raw);
    await db.put("meta", m);
    added.push(m);
    pendingUpload.add(d.id);
  }
  set({ metas: sortMetas([...st.metas, ...added]) });
  // obnovené položky mají přednost i před dřívějším smazáním (např. po resetu logbooku)
  const now = Date.now(), b = j.lb as Logbook, del = { ...st.lb.deleted };
  for (const k of ["sites", "buddies", "notes", "drafts", "aliases", "computers"] as const) {
    const m = (b[k] || {}) as Record<string, { updated: number }>;
    for (const [id, v] of Object.entries(m)) { if (del[id]) { delete del[id]; m[id] = { ...v, updated: now }; } }
  }
  await saveLb(mergeLogbooks({ ...st.lb, deleted: del }, { ...b, deleted: {} }));
  return added.length;
}

export async function wipeLocal() {
  await db.clearAll();
  diveCache.clear();
  set({ metas: [], lb: emptyLogbook() });
}
