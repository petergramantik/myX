// Stav aplikace: ponory, logbook, poloha, synchronizace přes Worker.
import { decodeDive, peekHeader, readShearwaterDb, type Dive, type RawDive } from "../core/shearwater";
import { injections, summarize } from "../core/analysis";
import * as db from "./db";
import { emptyLogbook, mergeLogbooks, uid, distKm, siteCoords, norm, type Logbook, type Meta, type Site, type Buddy, type DiveNote } from "./model";
import { syncKey, workerUrl } from "./config";

export interface Pos { lat: number; lon: number; acc: number; at: number }
export interface State {
  ready: boolean;
  metas: Meta[];           // seřazené od nejstaršího, index+1 = moje číslo ponoru
  lb: Logbook;
  pos: Pos | null; posErr: string | null;
  sync: { state: "off" | "idle" | "busy" | "error"; msg: string; at: number };
  toast: string | null;
}

let st: State = {
  ready: false, metas: [], lb: emptyLogbook(), pos: null, posErr: null,
  sync: { state: "off", msg: "", at: 0 }, toast: null,
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
    p = db.get<RawDive>("raw", id).then((r) => { if (!r) throw new Error("Ponor není v telefonu"); return decodeDive(r); });
    diveCache.set(id, p);
  }
  return p;
}

async function metaOf(raw: RawDive): Promise<Meta> {
  const d = await decodeDive(raw);
  return { id: raw.id, num: d.h.num, start: d.h.start, h: d.h, sum: summarize(d), inj: injections(d).length };
}

// ---------- start
export async function init() {
  const [metas, raws, lb] = await Promise.all([db.getAll<Meta>("meta"), db.getAll<RawDive>("raw"), db.get<Logbook>("kv", "lb")]);
  const have = new Set(metas.map((m) => m.id));
  const missing = raws.filter((r) => !have.has(r.id));
  for (const r of missing) { const m = await metaOf(r); metas.push(m); await db.put("meta", m); }
  set({ ready: true, metas: sortMetas(metas), lb: lb ? mergeLogbooks(emptyLogbook(), lb) : emptyLogbook() });
  if (workerUrl() && syncKey()) syncNow();
  else set({ sync: { state: "off", msg: "Synchronizace není nastavená", at: 0 } });
}

async function saveLb(lb: Logbook) {
  set({ lb });
  await db.put("kv", lb, "lb");
  scheduleSync();
}

// ---------- import exportu Shearwater Cloud
export async function importDb(file: File): Promise<number> {
  const raws = readShearwaterDb(new Uint8Array(await file.arrayBuffer()));
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
  // ponory z posledních 24 h: lokalita podle aktuální polohy
  const near = nearestSite();
  if (near && near.km <= 2) {
    const nowLocal = localNow();
    const lb = structuredClone(st.lb);
    for (const m of added) if (nowLocal - m.start < 86400 && !lb.notes[m.id]?.siteId) lb.notes[m.id] = Object.assign({ buddyIds: [], note: "" }, lb.notes[m.id], { siteId: near.site.id, updated: Date.now() });
    await saveLb(lb);
  } else scheduleSync();
  return added.length;
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
  const lb = structuredClone(st.lb);
  const site: Site = { ...(s.id ? lb.sites[s.id] : {}), ...s, id: s.id || uid(), updated: Date.now() } as Site;
  lb.sites[site.id] = site;
  await saveLb(lb);
  return site;
}
export async function upsertBuddy(b: Partial<Buddy> & { name: string }): Promise<Buddy> {
  const lb = structuredClone(st.lb);
  const buddy: Buddy = { ...(b.id ? lb.buddies[b.id] : {}), ...b, id: b.id || uid(), updated: Date.now() } as Buddy;
  lb.buddies[buddy.id] = buddy;
  await saveLb(lb);
  return buddy;
}

/** Sloučí lokalitu/parťáka `from` do `into` (ponory se přepíšou, `from` se smaže). */
export async function mergeInto(kind: "site" | "buddy", from: string, into: string) {
  const lb = structuredClone(st.lb);
  const now = Date.now();
  for (const [id, n] of Object.entries(lb.notes)) {
    if (kind === "site" && n.siteId === from) lb.notes[id] = { ...n, siteId: into, updated: now };
    if (kind === "buddy" && n.buddyIds.includes(from)) lb.notes[id] = { ...n, buddyIds: [...new Set(n.buddyIds.map((b) => (b === from ? into : b)))], updated: now };
  }
  if (kind === "site") delete lb.sites[from]; else delete lb.buddies[from];
  lb.deleted[from] = now;
  await saveLb(lb);
}
export async function remove(kind: "site" | "buddy", id: string) {
  const lb = structuredClone(st.lb);
  const now = Date.now();
  for (const [did, n] of Object.entries(lb.notes)) {
    if (kind === "site" && n.siteId === id) lb.notes[did] = { ...n, siteId: undefined, updated: now };
    if (kind === "buddy" && n.buddyIds.includes(id)) lb.notes[did] = { ...n, buddyIds: n.buddyIds.filter((b) => b !== id), updated: now };
  }
  if (kind === "site") delete lb.sites[id]; else delete lb.buddies[id];
  lb.deleted[id] = now;
  await saveLb(lb);
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
export function scheduleSync() {
  if (!workerUrl() || !syncKey()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1500);
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(workerUrl() + path, { ...init, headers: { ...(init?.headers || {}), "X-Myx-Key": syncKey() } });
  if (r.status === 401) throw new Error("Špatný klíč synchronizace");
  return r;
}

export async function syncNow(): Promise<void> {
  if (!workerUrl() || !syncKey()) { set({ sync: { state: "off", msg: "Synchronizace není nastavená", at: 0 } }); return; }
  if (syncing || !navigator.onLine) { if (!navigator.onLine) set({ sync: { ...st.sync, state: "idle", msg: "Bez připojení – odešle se později" } }); return; }
  syncing = true;
  set({ sync: { ...st.sync, state: "busy", msg: "Synchronizuji…" } });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await api("/sync");
      if (!r.ok) throw new Error(`Worker: ${r.status}`);
      const remote = (await r.json()) as { lb: Logbook | null; ver: number; dives: { id: string; num: number; start: number }[] };
      // ponory: stáhnout chybějící, nahrát nové
      const local = new Set(st.metas.map((m) => m.id));
      const remoteIds = new Set(remote.dives.map((d) => d.id));
      const got: Meta[] = [];
      for (const d of remote.dives) {
        if (local.has(d.id)) continue;
        const b = await api(`/dive/${encodeURIComponent(d.id)}`);
        if (!b.ok) continue;
        const raw: RawDive = { id: d.id, num: d.num, start: d.start, blob: new Uint8Array(await b.arrayBuffer()) };
        await db.put("raw", raw);
        const m = await metaOf(raw);
        await db.put("meta", m);
        got.push(m);
      }
      if (got.length) set({ metas: sortMetas([...st.metas, ...got]) });
      for (const m of st.metas) {
        if (remoteIds.has(m.id) && !pendingUpload.has(m.id)) continue;
        const raw = await db.get<RawDive>("raw", m.id);
        if (!raw) continue;
        const u = await api(`/dive/${encodeURIComponent(m.id)}`, { method: "PUT", body: raw.blob as BodyInit, headers: { "X-Num": String(raw.num), "X-Start": String(raw.start) } });
        if (u.ok) pendingUpload.delete(m.id);
      }
      // logbook
      const merged = remote.lb ? mergeLogbooks(st.lb, remote.lb) : st.lb;
      const p = await api("/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lb: merged, ver: remote.ver }) });
      if (p.status === 409) continue; // mezitím změna z jiného zařízení – znovu
      if (!p.ok) throw new Error(`Worker: ${p.status}`);
      st = { ...st, lb: mergeLogbooks(merged, st.lb) };
      await db.put("kv", st.lb, "lb");
      set({ sync: { state: "idle", msg: "Synchronizováno", at: Date.now() } });
      return;
    }
    throw new Error("Konflikt synchronizace, zkus to znovu");
  } catch (e) {
    set({ sync: { state: "error", msg: (e as Error).message || "Chyba synchronizace", at: Date.now() } });
  } finally {
    syncing = false;
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
  await saveLb(mergeLogbooks(st.lb, j.lb));
  return added.length;
}

export async function wipeLocal() {
  await db.clearAll();
  diveCache.clear();
  set({ metas: [], lb: emptyLogbook() });
}
