// Stav aplikace: ponory, logbook, poloha, synchronizace přes Worker.
import { ask, askText, choose } from "./dialog";
import { mergeDives, segGroups } from "../core/segments";
import { writeSqlite } from "../core/sqlitew";
import { SqliteFile } from "../core/sqlite";
import { peekHeader, readCloudDetails, readCloudNumbers, type CloudDetail, type Dive, type Header, type RawDive } from "../core/shearwater";
import { DEFAULT_THRESHOLDS, diveWarnings, injections, summarize } from "../core/analysis";
import { cellsOfDive } from "../core/cells";
import { loadWeather, weatherAt } from "./weather";
import * as db from "./db";
import { decodeAny, readAny } from "../core/decoders";
import { RIGS, defaultRig, diveType, isSupported, rigsForMode, type Rig } from "../core/rig";
import { isCC } from "../core/rig";
import { gearOnboardApply, gearRecompute, rbNextName, type RbRole } from "./gearSync";
import { aliasKey, cleanForeign, emptyLogbook, resetLogbook, mergeLogbooks, uid, distKm, siteCoords, norm, META_V, type Alias, type GearTank, type GearReg, type Computer, type Logbook, type Meta, type Site, type Buddy, type DiveNote, type Draft, type Cell, type Battery, type WeatherSnap } from "./model";
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
  /** dev: cizí log otevřený „jako můj“ – změny jen v paměti do restartu */ temp?: GuestLog | null;
  guestRev: number;        // mění se při přidání / odebrání cizího logu (přenačtení návrhů)
  /** ponory nepodporovaného typu (mód + přístroj) – uložené, ale nezobrazují se */ hidden: Meta[];
}
/** Cizí log uložený v samostatné databázi, nikdy se nesynchronizuje. */
export interface GuestLog { id: string; name: string; count: number; added: number; serial?: string; model?: string; /** u skupiny počítačů jednoho majitele: všechny jeho logy (hlavní první) */ logs?: GuestLog[] }

let st: State = {
  ready: false, metas: [], lb: emptyLogbook(), pos: null, posErr: null,
  sync: { state: "off", msg: "", at: 0 }, toast: null, guest: null, guestRev: 0, hidden: [],
};
const subs = new Set<() => void>();
export const getState = () => st;
export const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
function set(p: Partial<State>) {
  // ponory nepodporovaného typu se odloží stranou (zůstávají uložené); „hidden“ v p = nový kontext (jiný log)
  if (p.metas) {
    const lb = own?.lb ?? p.lb ?? st.lb, vis: Meta[] = [], hid = new Map(("hidden" in p ? p.hidden! : st.hidden).map((m) => [m.id, m]));
    for (const m of p.metas) { if (supportedMeta(m, lb)) vis.push(m); else hid.set(m.id, m); }
    for (const m of vis) hid.delete(m.id);
    p = { ...p, metas: vis, hidden: [...hid.values()] };
  }
  st = { ...st, ...p }; subs.forEach((f) => f());
}
/** Ponor podporovaného typu (mód + typ přístroje). */
function supportedMeta(m: Meta, lb: Logbook): boolean { return isSupported(m.h, rigInfo(m.h.serial, m.id, m.h, lb).rig); }
/** Po změně typu přístroje: znovu rozdělit ponory na zobrazené a skryté. */
function repartition() { set({ metas: sortMetas([...st.metas, ...st.hidden]), hidden: [] }); }

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: null }), 3500);
}

const sortMetas = (m: Meta[]) => [...m].sort((a, b) => a.start - b.start);
export const myNum = (id: string) => diveHeads().findIndex((m) => m.id === segInfo().head.get(id)) + 1;

// ---------- dekódované ponory (mezipaměť v paměti)
const diveCache = new Map<string, Promise<Dive>>();
function loadPart(id: string): Promise<Dive> {
  return db.get<RawDive>("raw", id, st.guest || st.temp ? db.GUEST : undefined).then((r) => { if (!r) throw new Error("Ponor není v telefonu"); return decodeAny(r, DEC); });
}
export function loadDive(id: string): Promise<Dive> {
  const parts = segInfo().parts.get(id);
  const key = parts && parts.length > 1 ? parts.map((m) => m.id).join("+") : id;
  let p = diveCache.get(key);
  if (!p) {
    p = parts && parts.length > 1 ? Promise.all(parts.map((m) => loadPart(m.id))).then(mergeDives) : loadPart(id);
    diveCache.set(key, p);
  }
  return p;
}

// ---------- spojené ponory (víc záznamů = jeden ponor)
let segCache: { metas: Meta[]; gap: number; ov: Record<string, boolean>; r: ReturnType<typeof segGroups<Meta>> } | null = null;
/** Seskupení zobrazených záznamů do ponorů (podle čísla z Cloudu, povrchového intervalu a ručních voleb). */
export function segInfo() {
  const gap = ownLb().settings.segGap ?? 30, ov = ownLb().settings.segOv || {};
  if (segCache && segCache.metas === st.metas && segCache.gap === gap && segCache.ov === ov) return segCache.r;
  const r = segGroups(st.metas, gap, ov);
  segCache = { metas: st.metas, gap, ov, r };
  return r;
}
/** Ponory k zobrazení: hlavy skupin (první záznam), seřazené od nejstaršího. */
export function diveHeads(): Meta[] { const { parts } = segInfo(); return st.metas.filter((m) => parts.has(m.id)); }
let viewCache: { r: unknown; v: Meta[] } | null = null;
/** Ponory k zobrazení se souhrnem spojených částí (max. hloubka, čas pod vodou, plyny, varování). */
export function viewMetas(): Meta[] {
  const r = segInfo();
  if (viewCache && viewCache.r === r) return viewCache.v;
  const v = diveHeads().map((m) => {
    const ps = r.parts.get(m.id)!;
    if (ps.length < 2) return m;
    const gases = new Map<string, { mix: string; s: number }>();
    for (const p of ps) for (const g of p.sum.gases || []) { const x = gases.get(g.mix) || { ...g, s: 0 }; x.s += g.s; gases.set(g.mix, x); }
    return { ...m, parts: ps, h: { ...m.h, maxDepth: Math.max(...ps.map((p) => p.h.maxDepth)), diveTimeS: ps.reduce((a, p) => a + p.h.diveTimeS, 0) },
      sum: { ...m.sum, gases: [...gases.values()] as typeof m.sum.gases }, warns: ps.flatMap((p) => p.warns || []) } as Meta;
  });
  viewCache = { r, v };
  return v;
}
/** Ruční spojení s předchozím (true), rozdělení (false) nebo návrat k automatice (null). */
export async function setSegOverride(id: string, v: boolean | null) {
  const lb = structuredClone(ownLb());
  const ov = { ...(lb.settings.segOv || {}) };
  if (v == null) delete ov[id]; else ov[id] = v;
  lb.settings = { ...lb.settings, segOv: ov, updated: Date.now() };
  diveCache.clear();
  await saveOwnLb(lb);
  if (st.guest) set({ lb: { ...st.lb, settings: { ...st.lb.settings, segOv: ov } } });
}

/** „Baterii jsem vyměnil“ – skryje upozornění na baterii počítače do dalšího ponoru (null = zrušit). */
export async function setBatSwap(serial: number, on: boolean) {
  const lb = structuredClone(ownLb());
  const m = { ...(lb.settings.batSwap || {}) };
  if (on) m[String(serial)] = localNow(); else delete m[String(serial)];
  lb.settings = { ...lb.settings, batSwap: m, updated: Date.now() };
  await saveOwnLb(lb);
}

/** Ponor z cizího logu (pro porovnání), bez ohledu na to, zda je cizí log právě otevřený. */
export function loadGuestDive(id: string): Promise<Dive> {
  return db.get<RawDive>("raw", id, db.GUEST).then((r) => { if (!r) throw new Error("Ponor cizího logu není v telefonu"); return decodeAny(r, DEC); });
}

async function metaOf(raw: RawDive): Promise<Meta> {
  const d = await decodeAny(raw, DEC);
  // hloubka po 30 s za prvních 30 min – pro párování společných ponorů podle profilu
  const prof: number[] = []; let j = 0;
  for (let t = 0; t <= 1800 && t <= d.h.diveTimeS; t += 30) { while (j + 1 < d.s.t.length && d.s.t[j] < t) j++; prof.push(Math.round(d.s.depth[j] * 10) / 10); }
  const sum = summarize(d);
  // oranžová a červená varování (výchozí prahy) – pro tagy v seznamu ponorů
  const warns = diveWarnings(d, sum, DEFAULT_THRESHOLDS).filter((w) => w.level === "warn" || w.level === "bad").map((w) => ({ level: w.level as "warn" | "bad", title: w.title, text: w.text }));
  const model = (/^(.*?)\[/.exec(raw.fn || "")?.[1] || "").trim() || undefined;
  return { id: raw.id, num: d.h.num, start: d.h.start, h: d.h, sum, inj: injections(d).length, cells: cellsOfDive(d), v: META_V, prof, warns, cnum: raw.cnum, model };
}

/**
 * Jednorázový převod: externí lahve zadané u ponoru (karty Diluent / O₂) → lahve v sekci Před a po ponoru;
 * ruční spotřeba (l) se zruší – vypíšou se ponory, kde byla, aby šly doplnit tlaky.
 */
async function migrateGasNotes() {
  const lb = structuredClone(st.lb);
  let changed = false;
  const manual: string[] = [];
  for (const [id, n] of Object.entries(lb.notes)) {
    const ext = (n.ext || []).filter((e) => e.gas === "dil" || e.gas === "o2");
    if (!ext.length && !n.useManual) continue;
    changed = true;
    if (ext.length) {
      const tanks = [...(n.prep?.tanks || [])];
      for (const e of ext) tanks.push({ id: e.id, role: e.gas as "dil" | "o2", name: /^S\d+$/.test(e.kind) ? e.kind : "Jiná", vol: /^S\d+$/.test(e.kind) ? undefined : e.vol, gas: e.gas === "o2" ? "O₂" : "", bar: e.start, end: e.end });
      n.prep = { ...(n.prep || {}), tanks };
      n.ext = (n.ext || []).filter((e) => e.gas === "sup");
    }
    if (n.useManual) { if (n.useManual.dil != null || n.useManual.o2 != null) manual.push(myNum(id) ? `č. ${myNum(id)}` : id); delete n.useManual; }
    n.updated = Date.now();
  }
  if (!changed) return;
  await saveLb(lb);
  if (manual.length) setTimeout(() => toast(`Ruční spotřeba plynu se už nepoužívá – byla u ponorů ${manual.slice(0, 10).join(", ")}${manual.length > 10 ? "…" : ""}. Případně doplň lahve v Před a po ponoru.`), 5000);
}

// ---------- start
export async function init() {
  const [metas, raws, lb] = await Promise.all([db.getAll<Meta>("meta"), db.getAll<RawDive>("raw"), db.get<Logbook>("kv", "lb")]);
  const fresh = metas.filter((m) => m.v === META_V);
  const have = new Set(fresh.map((m) => m.id));
  const missing = raws.filter((r) => !have.has(r.id));
  for (const r of missing) { try { const m = await metaOf(r); fresh.push(m); await db.put("meta", m); } catch { /* nečitelný ponor přeskočit */ } }
  set({ ready: true, hidden: [], metas: sortMetas(fresh), lb: lb ? mergeLogbooks(emptyLogbook(), lb) : emptyLogbook() });
  await autoLinkDrafts();
  await migrateGasNotes();
  await cleanupForeign();
  propagateExisting().catch(() => {});
  if (syncOn()) syncNow();
  else set({ sync: { state: "off", msg: db.IS_DEV ? "V dev verzi se nesynchronizuje" : "Synchronizace není nastavená", at: 0 } });
}

async function saveLb(lb: Logbook) {
  if (st.guest) { toast("Cizí log je jen k prohlížení"); return; }
  // tlaky lahví ve Výstroji z historie (kontroly + ponory)
  if (lb.tanks && !st.temp) gearRecompute(lb, ownMetas());
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
/** Model počítače podle sériového čísla (bez ID – to se ukazuje jen v Databázi). */
function modelFor(ser: number): string {
  const hex = ser.toString(16).toUpperCase(), g = st.guest ?? st.temp; // i cizí log otevřený „jako můj“
  const gl = g ? (g.logs || [g]).find((l) => l.serial === hex) : undefined;
  return gl?.model || st.lb.computers?.[hex]?.model || ownLb().computers?.[hex]?.model || tempSaved?.lb.computers?.[hex]?.model
    || st.metas.find((m) => m.h.serial === ser && m.model)?.model || "Počítač";
}
/** Typ přístroje, zásobní plyn a poměr pSCR pro ponor: změna u ponoru → nastavení počítače → výchozí podle módu. */
export function rigInfo(serial: number, diveId: string, h: Header, lb: Logbook = ownLb()): { rig?: Rig; supplyO2?: number; ratio: number; byDive: boolean } {
  const c = lb.computers?.[serial.toString(16).toUpperCase()], o = c?.dives?.[diveId];
  const fits = (r?: Rig) => (r && rigsForMode(h.mode).includes(r) ? r : undefined); // výchozí typ počítače jen pro ponory, kde dává smysl
  return { rig: fits(o?.rig) ?? fits(c?.rig) ?? defaultRig(h), supplyO2: o?.supplyO2 ?? c?.supplyO2, ratio: c?.pscrRatio ?? 8, byDive: !!(o?.rig || o?.supplyO2) };
}
/** Volby dekódování z nastavení počítačů (role nepojmenovaných vysílačů – i u cizích logů z mého logbooku). */
const DEC = { aiDil: (ser: number) => computerCfg(ser)?.aiDil };
/** Nastaví, který nepojmenovaný vysílač (T1/T2) je diluent, a přepočítá ponory tohoto počítače. */
export async function setAiDil(serial: number, v: "T1" | "T2" | null) {
  const hex = serial.toString(16).toUpperCase(), lb = structuredClone(ownLb());
  lb.computers = lb.computers || {};
  const c = { ...lb.computers[hex], id: hex, model: lb.computers[hex]?.model || modelFor(serial), updated: Date.now() } as Computer;
  if (v) c.aiDil = v; else delete c.aiDil;
  lb.computers[hex] = c;
  await saveOwnLb(lb);
  diveCache.clear();
  await recomputeSerial(serial);
  // uložené souhrny cizích logů tohoto počítače přepočítat při dalším otevření
  for (const l of (await guestLogs()).flatMap((g) => g.logs || [g])) if (l.serial === hex) {
    const d = await db.get<{ metas: Meta[]; lb: Logbook }>("kv", l.id, db.GUEST);
    if (d) await db.put("kv", { ...d, metas: d.metas.map((m) => (m.h.serial === serial ? { ...m, v: 0 } : m)) }, l.id, db.GUEST);
  }
  guestRaw = null;
  set({ guestRev: st.guestRev + 1 });
}
/** Přepočítá uložené souhrny ponorů jednoho počítače (vlastní i otevřený cizí log). */
async function recomputeSerial(serial: number) {
  const guest = !!(st.guest || st.temp), store = guest ? db.GUEST : undefined;
  const all = [...st.metas, ...(st.hidden || [])].filter((m) => m.h.serial === serial);
  const fresh = new Map<string, Meta>();
  for (const m of all) {
    const r = await db.get<RawDive>("raw", m.id, store); if (!r) continue;
    try { const n = { ...(await metaOf(r)), comp: m.comp, alt: m.alt }; fresh.set(m.id, n); if (!guest) await db.put("meta", n); } catch { /* nečitelný */ }
  }
  if (fresh.size) set({ metas: st.metas.map((m) => fresh.get(m.id) ?? m) });
}
/** Nastavení počítače z mého logbooku (typ přístroje, scrubber…). */
export const computerCfg = (serial: number): Computer | undefined => ownLb().computers?.[serial.toString(16).toUpperCase()];
/** Uloží nastavení přístroje u počítače (do mého logbooku – zálohuje se). */
export async function setComputerRig(serial: number, patch: Partial<Pick<Computer, "rig" | "supplyO2" | "pscrRatio" | "scrubFill" | "scrubMin" | "ccr">>) {
  const hex = serial.toString(16).toUpperCase(), lb = structuredClone(ownLb());
  lb.computers = lb.computers || {};
  lb.computers[hex] = { ...lb.computers[hex], id: hex, model: lb.computers[hex]?.model || modelFor(serial), ...patch, updated: Date.now() };
  await saveOwnLb(lb);
  if ("rig" in patch) repartition();
}
/** Změna typu přístroje nebo zásobního plynu u jednoho ponoru (null = podle počítače). */
export async function setDiveRig(serial: number, diveId: string, patch: { rig?: Rig | null; supplyO2?: number | null }) {
  const hex = serial.toString(16).toUpperCase(), lb = structuredClone(ownLb());
  lb.computers = lb.computers || {};
  const c = { ...lb.computers[hex], id: hex, model: lb.computers[hex]?.model || modelFor(serial), updated: Date.now() } as Computer;
  const o = { ...(c.dives?.[diveId] || {}) } as { rig?: Rig; supplyO2?: number };
  if (patch.rig !== undefined) { if (patch.rig) o.rig = patch.rig; else delete o.rig; }
  if (patch.supplyO2 !== undefined) { if (patch.supplyO2) o.supplyO2 = patch.supplyO2; else delete o.supplyO2; }
  c.dives = { ...(c.dives || {}) };
  if (o.rig || o.supplyO2) c.dives[diveId] = o; else delete c.dives[diveId];
  lb.computers[hex] = c;
  await saveOwnLb(lb);
  if (patch.rig !== undefined) repartition();
}
/** Volby typu přístroje: nepodporované jsou vidět, ale zašedlé. */
export const rigChoices = (cur?: Rig, mode?: string) => RIGS.filter((r) => !mode || rigsForMode(mode).includes(r.id)).map((r) => ({ key: r.id, label: r.label + (r.active ? "" : " – zatím nepodporováno"), note: r.note, disabled: !r.active, primary: r.id === cur }));
/** Rozpis ponorů počítače podle typu (mód + přístroj): „65× Gauge (pSCR), 5× OC – skryté“. */
export function typeBreakdown(metas: Meta[], lb: Logbook = ownLb()): { text: string; hidden: number; main?: string } {
  const by = new Map<string, { n: number; ok: boolean }>();
  for (const m of metas) { const r = rigInfo(m.h.serial, m.id, m.h, lb).rig, k = diveType(m.h, r), x = by.get(k) || { n: 0, ok: isSupported(m.h, r) }; x.n++; by.set(k, x); }
  const xs = [...by].sort((a, b) => b[1].n - a[1].n);
  return { text: xs.map(([k, x]) => `${x.n}× ${k}${x.ok ? "" : " – skryté, zatím nepodporováno"}`).join(", "), hidden: xs.filter(([, x]) => !x.ok).reduce((a, [, x]) => a + x.n, 0), main: xs[0]?.[0] };
}
/** Po importu: jen informace, jak se ponory zobrazí (typ přístroje podle módu, převládající typ počítače). */
function informTypes(metas: Meta[], model?: string) {
  const sers = [...new Set(metas.map((m) => m.h.serial))];
  const parts = sers.map((ser) => `${model || modelFor(ser)}: ${typeBreakdown(metas.filter((m) => m.h.serial === ser)).text}`);
  if (parts.length) setTimeout(() => toast(`${parts.join(" · ")}. Typ přístroje změníš v B&L → DB u počítače (Akce) nebo u ponoru.`), 4000); // po hlášce o importu
}

/** Název počítače pro zobrazení: model, u dvou stejných modelů pořadí („Petrel 2 (druhý)“). */
export function compName(ser: number): string {
  const model = modelFor(ser);
  const same = [...new Set(st.metas.map((m) => m.h.serial))].filter((x) => modelFor(x) === model);
  if (same.length < 2) return model;
  return `${model} (${["první", "druhý", "třetí", "čtvrtý"][same.indexOf(ser)] ?? same.indexOf(ser) + 1 + "."})`;
}
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
  if (buf[0] === 0x7b && new TextDecoder().decode(buf.subarray(0, 12)).includes("myxbt")) return importBtFile(buf);
  // SQLite databáze začíná „SQLite format 3“ – jiný soubor (fotka, záloha .json…) odmítnout srozumitelně
  if (new TextDecoder().decode(buf.subarray(0, 15)) !== "SQLite format 3") throw new Error("Soubor není databáze Shearwater (.db). V Shearwater Cloudu: Profil → Možnosti → Export (*.db).");
  const raws = readAny(buf);
  if (!raws.length) { toast("V souboru nejsou žádné ponory"); return { own: 0, guests: [] }; }
  const groups = new Map<string, RawDive[]>();
  for (const r of raws) { const k = serialOf(r.fn); groups.set(k, [...(groups.get(k) || []), r]); }
  let mine = ownSerials();
  if (!mine.size && !st.metas.length) {
    const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
    mine = new Set([sorted[0][0]]);
    // první import s víc počítači: cíleně se zeptat, které jsou moje (výměna počítače)
    for (const [k, v] of sorted.slice(1)) if (k && await ask(`V souboru je víc počítačů. Je počítač ${modelOf(v)} ${k} (${v.length} ponorů) také tvůj?`, { ok: "Je můj", cancel: "Je cizí" })) mine.add(k);
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
  if (!isMyxShare(buf)) await db.put("kv", { name: name || "Shearwater_Cloud.db", at: Date.now(), count: raws.length, data: buf }, "orig"); // pro sdílení celého logu
  const cloud = cloudPlus(buf);
  if (cloud.size) { const lb = applyCloud(st.lb, cloud, new Set(raws.map((r) => r.id))); if (lb !== st.lb) await saveLb(lb); }
  const have = new Set(st.metas.map((m) => m.id));
  const cnums = readCloudNumbers(buf);
  // číslo ponoru z Cloudu doplnit i k už načteným ponorům (spojené ponory se stejným číslem)
  const upd: Meta[] = [];
  for (const m of st.metas) { const n = cnums.get(m.id); if (n != null && m.cnum !== n) { const raw = await db.get<RawDive>("raw", m.id); if (raw) { await db.put("raw", { ...raw, cnum: n }); } const mm = { ...m, cnum: n }; await db.put("meta", mm); upd.push(mm); } }
  if (upd.length) set({ metas: st.metas.map((m) => upd.find((x) => x.id === m.id) || m) });
  return addRaws(raws, cnums);
}

/** Plán stažení z počítače: čí je, které ponory už jsou v telefonu, kolik stáhnout a kam uložit. */
export interface DownloadPlan { mine: boolean; known: Set<number>; limit: number; guest?: GuestLog; owner?: { id?: string; name?: string } | null; label: string }

/**
 * Rozhodne podle sériového čísla: můj počítač (nebo můj log je prázdný) → můj log, všechny nové ponory;
 * cizí → DB jeho majitele (existující podle počítače, jinak nabídne založit) a ve výchozím stavu jen poslední ponor.
 */
export async function downloadPlan(serial: number, model: string, total: number): Promise<DownloadPlan | null> {
  const hex = serial.toString(16).toUpperCase();
  const mine = ownSerials().has(hex) || (!ownMetas().length && !ownHidden().length);
  if (mine) return { mine, known: new Set([...ownMetas(), ...ownHidden()].filter((m) => m.h.serial === serial).map((m) => m.h.start)), limit: Infinity, label: "tvůj log" };
  const guest = (await guestLogs()).flatMap((g) => g.logs || [g]).find((l) => l.serial === hex);
  const old = guest ? await db.get<{ metas: Meta[] }>("kv", guest.id, db.GUEST) : undefined;
  const who = guest ? ownerName(guest) || logName(guest) : "";
  const k = await choose(`Počítač ${model} ${hex} není tvůj${guest ? ` – patří k DB ${who}` : ""}. V počítači je ${total} ponorů. Co stáhnout?`, [
    { key: "1", label: "Jen poslední ponor", primary: true },
    { key: "all", label: "Všechny nové ponory" },
  ]);
  if (!k) return null;
  let owner: DownloadPlan["owner"] = null;
  if (!guest) {
    // nová DB pro majitele počítače – přiřadit k buddymu
    const buds = Object.values(ownLb().buddies).sort((a, b) => a.name.localeCompare(b.name, "cs")).slice(0, 8);
    const b = await choose(`Pro počítač ${model} ${hex} zatím nemáš DB. Komu patří?`, [...buds.map((x) => ({ key: x.id, label: x.name })), { key: "_new", label: "Jiný buddy…", primary: !buds.length }]);
    if (!b) return null;
    if (b === "_new") { const n = await askText("Jméno majitele počítače:"); if (!n?.trim()) return null; owner = { name: n.trim() }; } else owner = { id: b };
  }
  return { mine: false, known: new Set((old?.metas || []).map((m) => m.start)), limit: k === "1" ? 1 : Infinity, guest, owner, label: guest ? `DB ${who}` : "nová DB" };
}

/** Uloží stažené ponory podle plánu; vrací počet nových. */
export async function saveDownloaded(plan: DownloadPlan, raws: RawDive[]): Promise<number> {
  if (!raws.length) return 0;
  if (plan.mine) return addRaws(raws);
  const before = plan.guest ? (await db.get<{ metas: Meta[] }>("kv", plan.guest.id, db.GUEST))?.metas.length ?? 0 : 0;
  const log = await importGuestRaws(new Uint8Array(0), raws, false);
  if (!log) return 0;
  if (!plan.guest) { if (plan.owner) await setComputerOwner(log, plan.owner); plan.guest = log; plan.owner = null; }
  const after = (await db.get<{ metas: Meta[] }>("kv", log.id, db.GUEST))?.metas.length ?? 0;
  return after - before;
}

/** Soubor z aplikace „myX Petrel“ (stažení z Petrelu 2 přes klasický Bluetooth): JSON s nativními daty ponorů. */
async function importBtFile(buf: Uint8Array): Promise<{ own: number; guests: GuestLog[] }> {
  const j = JSON.parse(new TextDecoder().decode(buf)) as { myxbt: number; serial: string; model: string; dives: { fp: number; num?: number; data: string }[] };
  const { wrapBlob } = await import("../core/swproto");
  const serial = parseInt(j.serial, 16) >>> 0, hex = serial.toString(16).toUpperCase();
  const plan = await downloadPlan(serial, j.model, j.dives.length);
  if (!plan) return { own: 0, guests: [] };
  const list = [...j.dives].sort((a, b) => b.fp - a.fp).filter((d) => !plan.known.has(d.fp)).slice(0, plan.limit);
  const raws: RawDive[] = [];
  for (const d of list) {
    const nat = Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0));
    const dt = new Date(d.fp * 1000);
    raws.push({ id: `ble-${serial.toString(16)}-${d.fp}`, num: d.num || 0, start: d.fp, blob: await wrapBlob(nat), fn: `${j.model}[${hex}]#${d.num || 0} ${dt.getUTCFullYear()}-${dt.getUTCMonth() + 1}-${dt.getUTCDate()} (Bluetooth)` });
  }
  const n = await saveDownloaded(plan, raws);
  if (plan.mine) return { own: n, guests: [] };
  toast(n ? `Přidáno ${n} ${n === 1 ? "ponor" : "ponorů"} do ${plan.label}` : "Žádné nové ponory");
  return { own: 0, guests: plan.guest ? [plan.guest] : [] };
}

/** Klíč ponoru nezávislý na zdroji (Cloud / Bluetooth): sériové číslo počítače + začátek. */
const diveKey = (m: { h: { serial: number; start: number } }) => `${m.h.serial}:${m.h.start}`;

/** Uloží nové ponory (z importu Cloudu nebo z Bluetooth); duplicity podle id i podle počítače a začátku. */
async function addRaws(raws: RawDive[], cnums: Map<string, number> = new Map()): Promise<number> {
  const have = new Set(st.metas.map((m) => m.id)), keys = new Set([...st.metas, ...(st.hidden || [])].map(diveKey));
  const added: Meta[] = [];
  const skipped: string[] = [];
  for (const r of raws) {
    if (have.has(r.id)) continue;
    // ponor, který nejde přečíst, přeskočit – ostatní se načtou
    try {
      const ph = await peekHeader(r.blob);
      const raw: RawDive = { ...r, num: ph.num, start: ph.start, blob: r.blob.slice(), cnum: cnums.get(r.id) };
      const m = await metaOf(raw);
      if (keys.has(diveKey(m))) continue; // stejný ponor už je (z jiného zdroje)
      keys.add(diveKey(m));
      await db.put("raw", raw);
      await db.put("meta", m);
      added.push(m);
      pendingUpload.add(raw.id);
    } catch { skipped.push(/#(\d+)/.exec(r.fn || "")?.[1] ?? "?"); }
  }
  if (skipped.length) setTimeout(() => toast(`${skipped.length} ${skipped.length === 1 ? "ponor se nepodařilo" : "ponorů se nepodařilo"} přečíst (č. ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? "…" : ""}) – ostatní jsou načtené. Pošli prosím export autorovi aplikace.`), 4500);
  if (!added.length) return 0;
  set({ metas: sortMetas([...st.metas, ...added]) });
  await autoLinkDrafts();
  scheduleSync();
  informTypes(added); // jak se ponory zobrazí (typ podle módu)
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
let own: { metas: Meta[]; lb: Logbook; hidden?: Meta[] } | null = null;
/** Vlastní logbook a ponory i během prohlížení cizího logu. */
export const ownLb = (): Logbook => own?.lb ?? st.lb;
export const ownMetas = (): Meta[] => own?.metas ?? st.metas;
/** Moje skryté ponory (nepodporovaný typ). */
export const ownHidden = (): Meta[] => (own ? own.hidden || [] : st.hidden);
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
      // orig = jméno, jak ho má zapsané majitel logu (pro B&L cizího logu)
      if (a?.targetId === ME) return [k, { ...v, name: mine.settings.myName || "Já", orig: v.name }];
      const t = a ? my[a.targetId] : undefined;
      return [k, t ? { ...v, name: t.name, orig: v.name } : v];
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
        e.n++; e.logs.add(logName(log)); out.set(k, e);
      }
    }
  }
  return [...out.values()].sort((a, b) => b.n - a.n).map((x) => ({ name: x.name, n: x.n, logs: [...x.logs] }));
}
/** Jméno z cizího logu: založit jako mého buddyho/lokalitu (targetId = null), nebo přiřadit k existujícímu. */
export async function adoptForeign(kind: "buddy" | "site", name: string, targetId: string | null, keepName?: string, from?: string): Promise<number> {
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
  lb.aliases = { ...(lb.aliases || {}), [key]: { id: key, kind, name, targetId: id, updated: Date.now(), ...(from ? { from } : {}) } as Alias };
  const n = await propagate(lb);
  await saveOwnLb(lb);
  return n;
}

/** Aliasy (jména z cizích logů) přiřazené k mému parťákovi / lokalitě, nebo ke mně (ME). */
export function aliasesFor(kind: "buddy" | "site", targetId: string): Alias[] {
  return Object.values(ownLb().aliases || {}).filter((a) => a.kind === kind && a.targetId === targetId).sort((a, b) => a.name.localeCompare(b.name, "cs"));
}
/** Zruší alias; jména už doplněná k ponorům zůstanou. */
export async function removeAlias(key: string) {
  const lb = structuredClone(ownLb());
  if (!lb.aliases?.[key]) return;
  delete lb.aliases[key];
  lb.deleted = { ...lb.deleted, [key]: Date.now() }; // ať ho synchronizace nevrátí
  await saveOwnLb(lb);
}
/** Odhad, komu jméno z cizího logu patří: můj parťák se stejným křestním jménem / lokalita s podobným názvem. */
export function aliasGuess(kind: "buddy" | "site", name: string): { id: string; name: string } | null {
  const lb = ownLb(), n = norm(name);
  if (!n) return null;
  const items = Object.values(kind === "buddy" ? lb.buddies : lb.sites);
  const hit = kind === "buddy"
    ? items.find((x) => norm(x.name).split(" ")[0] === n.split(" ")[0])
    : items.find((x) => { const m = norm(x.name); return n.length >= 4 && (m.includes(n) || n.includes(m)); });
  return hit ? { id: hit.id, name: hit.name } : null;
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
  if (n) { await saveLb(lb); toast(`Doplněno z logů ostatních k ${n} ponorům`); }
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
    if (site || buddies.length) out.push({ who: logName(log), site, buddies });
  }
  return out;
}
/** Přiřadí k mému ponoru lokalitu / buddyho z logu buddyho (neznámé jméno založí a zapamatuje). */
export async function applySuggestion(diveId: string, kind: "site" | "buddy", name: string, from?: string) {
  let id = resolveForeign(kind, name);
  if (!id) { await adoptForeign(kind, name, null, undefined, from); id = resolveForeign(kind, name); }
  if (!id || id === ME) return;
  const n = ownLb().notes[diveId] || { buddyIds: [], note: "", updated: 0 };
  await setNote(diveId, kind === "site" ? { siteId: id } : { buddyIds: [...new Set([...n.buddyIds, id])] });
}

// ---------- sdílení vybraných ponorů (malý export ve formátu Shearwater Cloud)
/** Tabulka myX v sdíleném souboru: moje lokalita a parťáci u ponoru (jen u mých ponorů). */
const MYX_TABLE = "myx_dive";
/** Vytvoří .db jen s vybranými ponory (vlastní nebo z otevřeného cizího logu). ids = id záznamů včetně částí spojených ponorů. */
export async function exportDives(ids: string[]): Promise<{ name: string; data: Uint8Array; count: number }> {
  const guest = !!st.guest;
  const orig = guest ? undefined : await lastExport();
  const oc = orig ? readCloudDetails(orig.data) : new Map<string, CloudDetail>();
  const logRows: (string | number | Uint8Array | null)[][] = [], detRows: (string | number | null)[][] = [], myxRows: (string | null)[][] = [];
  const glb = new Map<string, Logbook>();
  let model = "", first = Infinity;
  for (const id of ids) {
    const raw = await db.get<RawDive>("raw", id, guest ? db.GUEST : undefined);
    if (!raw) continue;
    const i = id.indexOf(":"), oid = guest && i > 0 ? id.slice(i + 1) : id;
    logRows.push([oid, raw.fn || "", raw.blob]);
    model = model || (/^(.*?)\[/.exec(raw.fn || "")?.[1] || "").trim();
    first = Math.min(first, raw.start || Infinity);
    let site = "", buddy = "", notes = "";
    if (guest) { // údaje ze Shearwater Cloud v cizím logu (bez mých aliasů)
      const lid = id.slice(0, i);
      if (!glb.has(lid)) glb.set(lid, (await db.get<{ lb: Logbook }>("kv", lid, db.GUEST))?.lb || emptyLogbook());
      const g = glb.get(lid)!, n = g.notes[id];
      if (n) { site = n.siteId ? g.sites[n.siteId]?.name || "" : ""; buddy = n.buddyIds.map((b) => g.buddies[b]?.name).filter(Boolean).join(", "); notes = n.note || ""; }
    } else {
      const c = oc.get(oid);
      if (c) { site = c.site; buddy = c.buddies.join(", "); notes = c.notes; }
      const n = st.lb.notes[id];
      if (n) myxRows.push([oid, n.siteId ? st.lb.sites[n.siteId]?.name || null : null, n.buddyIds.filter((b) => b !== ME).map((b) => st.lb.buddies[b]?.name).filter(Boolean).join(", ") || null]);
    }
    detRows.push([oid, raw.cnum ?? null, site || null, buddy || null, notes || null]);
  }
  if (!logRows.length) throw new Error("Ponor se nepodařilo najít");
  const tables = [
    { name: "log_data", sql: "CREATE TABLE log_data (log_id TEXT, file_name TEXT, data_bytes_1 BLOB)", rows: logRows },
    { name: "dive_details", sql: "CREATE TABLE dive_details (DiveId TEXT, DiveNumber INTEGER, Site TEXT, Buddy TEXT, Notes TEXT)", rows: detRows },
    { name: MYX_TABLE, sql: `CREATE TABLE ${MYX_TABLE} (DiveId TEXT, Site TEXT, Buddies TEXT)`, rows: myxRows },
  ];
  const day = Number.isFinite(first) ? new Date(first * 1000).toISOString().slice(0, 10) : "ponor";
  const name = `myX_${(model || "Petrel").replace(/\s+/g, "")}_${day}${logRows.length > 1 ? `_${logRows.length}` : ""}.db`;
  return { name, data: writeSqlite(tables), count: logRows.length };
}
/** Je soubor sdílení vybraných ponorů z myX (ne celý export)? */
const isMyxShare = (buf: Uint8Array) => { try { return new SqliteFile(buf).tables().has(MYX_TABLE); } catch { return false; } };
/** Moje lokalita a parťáci ze sdíleného souboru – doplní se jako údaje „z Cloudu“, kde Cloud nic nemá. */
function readMyx(buf: Uint8Array): Map<string, CloudDetail> {
  const out = new Map<string, CloudDetail>();
  try { for (const r of new SqliteFile(buf).rows(MYX_TABLE)) { const id = String(r["DiveId"] ?? ""); if (id) out.set(id, { site: String(r["Site"] || ""), buddies: String(r["Buddies"] || "").split(",").map((x) => x.trim()).filter(Boolean), notes: "" }); } } catch { /* */ }
  return out;
}
/** Cloud údaje doplněné o údaje z myX (Cloud má přednost). */
function cloudPlus(buf: Uint8Array): Map<string, CloudDetail> {
  if (!buf.length) return new Map(); // ponory stažené z počítače – bez údajů z Cloudu
  const c = readCloudDetails(buf);
  for (const [id, m] of readMyx(buf)) { const x = c.get(id); c.set(id, { site: x?.site || m.site, buddies: x?.buddies.length ? x.buddies : m.buddies, notes: x?.notes || "" }); }
  return c;
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
/** Model z popisu počítače bez sériového čísla („Petrel 2 38A4FD78“ → „Petrel 2“). */
export const compModel = (c?: string) => (c || "").replace(/\s+[0-9A-F]{6,}$/i, "");
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
/** Jméno cizího logu pro zobrazení: majitel, jinak model počítače (bez sériového čísla). */
/** Moje jméno (Nastavení → Sdílení), i když je otevřený cizí log. */
export const myDisplayName = (): string | undefined => ownLb().settings.myName;
export const logName = (log: GuestLog): string => ownerName(log) || log.model || "Cizí log";
export const ownerName = (log: GuestLog): string | null => {
  // majitel je v mém logbooku – i když je cizí log otevřený „jako můj“ (dev)
  for (const lb of [ownLb(), tempSaved?.lb]) {
    const c = lb && log.serial ? lb.computers?.[log.serial] : undefined;
    const n = c?.buddyId ? lb!.buddies[c.buddyId]?.name : undefined;
    if (n) return n;
  }
  return null;
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
/** Id ponorů přidaných posledním importem cizího logu (pro otevření sdíleného ponoru). */
let lastGuestAdded = new Set<string>();
async function importGuestRaws(buf: Uint8Array, raws: RawDive[], open = true): Promise<GuestLog | null> {
  if (!raws.length) return null;
  const fn = raws.find((r) => r.fn)?.fn || "";
  const model = (/^(.*?)\[/.exec(fn)?.[1] || "Počítač").trim();
  const serial = serialOf(fn);
  // stejný počítač už načtený → ponory se sloučí (sdílené jednotlivé ponory i pozdější celý export dají stejný výsledek)
  const prev = serial ? (await guestLogs()).find((l) => l.serial === serial) : undefined;
  const id = prev?.id || uid();
  const old = prev ? await db.get<{ metas: Meta[]; lb: Logbook }>("kv", id, db.GUEST) : undefined;
  const metas: Meta[] = [...(old?.metas || [])];
  const have = new Set(metas.map((m) => m.id)), haveStart = new Set(metas.map((m) => `${m.num}:${m.start}`));
  const cnums = readCloudNumbers(buf);
  const added = new Set<string>();
  lastGuestAdded = added;
  for (const r of raws) {
    try {
      const rid = `${id}:${r.id}`;
      if (have.has(rid)) continue;
      const ph = await peekHeader(r.blob);
      if (haveStart.has(`${ph.num}:${ph.start}`)) continue;
      const raw: RawDive = { ...r, id: rid, num: ph.num, start: ph.start, blob: r.blob.slice(), cnum: cnums.get(r.id) };
      await db.put("raw", raw, undefined, db.GUEST);
      metas.push(await metaOf(raw));
      added.add(rid);
    } catch { /* poškozený ponor přeskočit */ }
  }
  if (prev && !added.size) {
    // nic nového – jen doplnit případné údaje z Cloudu k už načteným ponorům
    const cloud0 = new Map([...cloudPlus(buf)].map(([k, v]) => [`${id}:${k}`, v]));
    const lb0 = applyCloud(old?.lb || emptyLogbook(), cloud0, have);
    if (lb0 !== old?.lb) { await db.put("kv", { metas, lb: lb0 }, id, db.GUEST); guestIndex = null; guestRaw = null; set({ guestRev: st.guestRev + 1 }); }
    return prev;
  }
  const cloud = new Map([...cloudPlus(buf)].map(([k, v]) => [`${id}:${k}`, v]));
  const lb = applyCloud(old?.lb || emptyLogbook(), cloud, new Set(metas.map((m) => m.id)));
  await db.put("kv", { metas: sortMetas(metas), lb }, id, db.GUEST);
  const log: GuestLog = { ...(prev || {}), id, name: `${model}${serial ? " " + serial : ""}`, count: metas.length, added: prev?.added || Date.now(), serial: serial || undefined, model };
  // starší duplicitní logy ze stejného počítače (z dřívějších verzí) odstranit
  for (const dup of (await guestLogs()).filter((l) => log.serial && l.serial === log.serial && l.id !== id)) await deleteGuest(dup);
  await db.put("kv", [log, ...(await guestLogs()).filter((l) => l.id !== id)], "logs", db.GUEST);
  guestIndex = null; guestRaw = null;
  set({ guestRev: st.guestRev + 1 });
  const known = log.serial ? ownLb().computers?.[log.serial] : undefined;
  if (known?.buddyId) await setComputerOwner(log, { id: known.buddyId }); // stejný počítač už má majitele
  informTypes(metas, model); // jak se ponory zobrazí (typ podle módu)
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
  if (!await ask(`V souboru jsou ${withSerial.length} různé počítače (${withSerial.map(compLabel).join(", ")}). Patří stejnému člověku?`)) return;
  const known = withSerial.map((l) => ownerName(l)).find(Boolean);
  const name = await askText("Jméno majitele:", known || "");
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
  const sharedIds = new Set(lastGuestAdded);
  await openGuest(log);
  // sdílené jednotlivé ponory: otevřít nejnovější z nich, ne nejnovější ponor celého logu
  const pool = st.metas.filter((m) => sharedIds.has(m.id));
  const last = [...(pool.length ? pool : st.metas)].sort((a, b) => b.start - a.start)[0] || null;
  const mine = last ? ownMetas().find((m) => nearestPair([last], m).length > 0) || null : null;
  return { log, last, mine, own: res.own };
}

export async function openGuest(log: GuestLog) {
  const ix = await guestIndexLoad();
  const g = ix.find((x) => x.log.id === log.id || x.log.logs?.some((l) => l.id === log.id));
  if (!g) { toast("Cizí log se nepodařilo načíst"); return; }
  if (!own) own = { metas: st.metas, lb: st.lb, hidden: st.hidden };
  diveCache.clear();
  // nastavení (limity, objemy lahví) zůstávají vlastní, čidla a baterie cizí log nemá; jména přeložit podle mých přiřazení
  set({ guest: g.log, metas: g.metas, hidden: [], lb: withAliases({ ...g.lb, settings: own.lb.settings }, own.lb) });
}
let tempSaved: { metas: Meta[]; lb: Logbook; hidden: Meta[] } | null = null;
/** Dev verze: cizí log otevřený jako vlastní. Zápisy do úložiště se vypnou – změny platí jen do restartu aplikace. */
export async function openTempOwn(log: GuestLog) {
  if (!db.IS_DEV) return;
  if (st.guest) closeGuest();
  const ix = await guestIndexLoad();
  const g = ix.find((x) => x.log.id === log.id || x.log.logs?.some((l) => l.id === log.id));
  if (!g) { toast("Cizí log se nepodařilo načíst"); return; }
  if (!tempSaved) tempSaved = { metas: st.metas, lb: st.lb, hidden: st.hidden };
  db.setMemOnly(true);
  diveCache.clear();
  set({ temp: g.log, hidden: [], lb: { ...structuredClone(g.lb), settings: tempSaved.lb.settings } }); set({ metas: g.metas, hidden: [] });
}
/** Zpět na můj log – dočasné změny se zahodí. */
export function closeTempOwn() {
  if (!tempSaved) return;
  if (st.guest) closeGuest();
  diveCache.clear();
  set({ temp: null, lb: tempSaved.lb }); set({ metas: tempSaved.metas, hidden: tempSaved.hidden });
  tempSaved = null;
  db.setMemOnly(false);
}
/** Ponor parťáka otevřený z detailu mého ponoru: Zpět na můj ponor cizí log zase zavře. */
let peek: { mine: string; guest: string } | null = null;
export async function openBuddyDive(log: GuestLog, mineId: string, guestId: string) {
  await openGuest(log);
  if (st.guest) peek = { mine: mineId, guest: guestId };
}
/** Volá navigace před návratem zpět: z ponoru parťáka na můj ponor → zavřít cizí log. */
export function peekPop(from: { t: string; id?: string }, to: { t: string; id?: string }) {
  if (!peek || !st.guest) { peek = null; return; }
  if (to?.t === "dive" && to.id === peek.mine) { peek = null; closeGuest(); }
}
export function closeGuest() {
  if (!own) return;
  diveCache.clear();
  set({ guest: null, metas: own.metas, hidden: own.hidden || [], lb: own.lb });
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

/** Smaže vybrané ponory z cizích logů; prázdný log zmizí celý (majitel a aliasy zůstanou). Vrací počet smazaných. */
export async function deleteGuestDives(ids: string[]): Promise<number> {
  const byLog = new Map<string, Set<string>>();
  for (const id of ids) { const i = id.indexOf(":"); if (i > 0) { const l = id.slice(0, i); byLog.set(l, (byLog.get(l) || new Set()).add(id)); } }
  const open = st.guest;
  let n = 0;
  for (const [lid, del] of byLog) {
    const data = await db.get<{ metas: Meta[]; lb: Logbook }>("kv", lid, db.GUEST);
    const log = (await guestLogs()).find((l) => l.id === lid);
    if (!data || !log) continue;
    const metas = data.metas.filter((m) => !del.has(m.id));
    n += data.metas.length - metas.length;
    if (!metas.length) { await deleteGuest(log); continue; }
    for (const id of del) { await db.del("raw", id, db.GUEST); delete data.lb.notes[id]; }
    await db.put("kv", { metas, lb: data.lb }, lid, db.GUEST);
    await db.put("kv", (await guestLogs()).map((l) => (l.id === lid ? { ...l, count: metas.length } : l)), "logs", db.GUEST);
  }
  guestIndex = null; guestRaw = null; diveCache.clear();
  set({ guestRev: st.guestRev + 1 });
  if (open) {
    const still = (await guestLogs()).find((l) => l.id === open.id || open.logs?.some((x) => x.id === l.id));
    if (still) await openGuest(still); else closeGuest();
  }
  return n;
}

// ---------- rozpracované ponory (založené na lokalitě) a jejich spárování s logem
const H = 3600;
/** Ponory z počítače, které časově odpovídají rozpracovanému ponoru (začátek −3 h až +48 h od založení – příprava bývá večer předem). */
export function draftCandidates(dr: Draft): Meta[] {
  const linked = new Set(Object.values(st.lb.drafts).map((d) => d.diveId).filter(Boolean));
  return st.metas.filter((m) => !linked.has(m.id) && m.start >= dr.created - 3 * H && m.start <= dr.created + 48 * H)
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
    ext: cur?.ext || dr.ext,
    prep: cur?.prep || dr.prep,
    pos: cur?.pos || (dr.lat != null && dr.lon != null ? { lat: dr.lat, lon: dr.lon } : undefined),
    updated: Date.now(),
  };
  delete lb.drafts[draftId];
  lb.deleted[draftId] = Date.now();
  // on-board lahve vybrané v rozpracovaném ponoru → přiřazení k ponoru
  const pp = lb.notes[diveId].prep;
  if (pp?.o2Tank || pp?.dilTank) lb.notes[diveId].rb = { ...(pp.o2Tank ? { o2: { id: pp.o2Tank } } : {}), ...(pp.dilTank ? { dil: { id: pp.dilTank } } : {}), ...lb.notes[diveId].rb };
  await saveLb(lb);
  if (auto) toast(`Rozpracovaný ponor spárován s ponorem č. ${myNum(diveId)}`);
  // počasí z doby založení nahradit počasím v čase začátku ponoru na lokalitě (jinak na poslední poloze přípravy)
  const m = st.metas.find((x) => x.id === diveId), sid = cur?.siteId || dr.siteId, sc = sid && st.lb.sites[sid] ? siteCoords(st.lb.sites[sid]) : null;
  const lat = sc?.lat ?? dr.lat, lon = sc?.lon ?? dr.lon;
  if (m && lat != null && lon != null) weatherAt(lat, lon, m.start).then((w) => {
    const n = st.lb.notes[diveId];
    if (w && n) { const lb2 = structuredClone(st.lb); lb2.notes[diveId] = { ...n, weather: w, updated: Date.now() }; saveLb(lb2); }
  }).catch(() => {});
}

/** Lokalita bez polohy převezme polohu z místa ponoru (rozpracovaný ponor aktualizovaný na místě). */
async function siteFromPos(siteId: string, pos: { lat: number; lon: number }) {
  const site = st.lb.sites[siteId];
  if (!site || siteCoords(site)) return;
  await upsertSite({ ...site, lat: pos.lat, lon: pos.lon });
  toast(`Poloha uložena k lokalitě ${site.name} (změníš ji u lokality)`);
}

/** Aktualizuje polohu (a počasí) rozpracovaného ponoru; bez zvolené lokality navrhne nejbližší do 2 km. */
export async function moveDraft(id: string, pos: Pos, toSite = false) {
  const dr = st.lb.drafts[id]; if (!dr) return;
  const near = nearestSite(pos);
  updateDraft(id, { lat: pos.lat, lon: pos.lon, siteId: dr.siteId || (near && near.km <= 2 ? near.site.id : undefined) });
  // ruční aktualizace na místě (＋📍, tlačítko) uloží polohu i k lokalitě bez polohy; automatický posun ne (mohl by být cestou)
  if (toSite && dr.siteId) await siteFromPos(dr.siteId, pos);
  try {
    const w = await loadWeather(pos.lat, pos.lon);
    if (st.lb.drafts[id]) updateDraft(id, { weather: { at: Date.now(), temp: w.now.temp, wind: w.now.wind, gust: w.now.gust, cloud: w.now.cloud, pressure: w.now.pressure, precip: w.now.precip, code: w.now.code } });
  } catch { /* bez počasí */ }
}

/**
 * Po zjištění polohy: rozpracované ponory z posledních 48 h, které jsou daleko (> 1 km), přesune na aktuální polohu.
 * Se zvolenou lokalitou jen tehdy, když jsem u ní (do 2 km) – cestou se poloha nemění.
 */
function followDrafts(pos: Pos) {
  if (st.guest || st.temp) return;
  for (const dr of Object.values(st.lb.drafts)) {
    if (localNow() - dr.created > 48 * 3600) continue;
    if (dr.lat != null && distKm(pos, { lat: dr.lat, lon: dr.lon! }) <= 1) continue;
    const sc = dr.siteId && st.lb.sites[dr.siteId] ? siteCoords(st.lb.sites[dr.siteId]) : null;
    if (sc && distKm(pos, sc) > 2) continue;
    moveDraft(dr.id, pos);
  }
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
  // zadané starší čidlo (na pozici už je novější): jeho konec = instalace toho novějšího
  if (!c.id && !cell.removed) { const later = Object.values(lb.cells).filter((o) => o.pos === cell.pos && o.installed > cell.installed).map((o) => o.installed).sort()[0]; if (later) cell.removed = later; }
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

// ---------- Výstroj: lahve a sestavy (automatiky)
export function saveTank(t: Partial<GearTank> & { kind: string; vol: number; mix: string }): Promise<void> {
  const lb = structuredClone(st.lb);
  const id = t.id || uid();
  const prev = lb.tanks?.[id];
  lb.tanks = { ...(lb.tanks || {}), [id]: { ...(prev || {}), ...t, id, updated: Date.now() } as GearTank };
  // tlak zadaný ve formuláři = kontrola
  if (t.bar != null && t.bar !== prev?.bar) { const y = lb.tanks[id]; lb.tanks[id] = { ...y, checks: [...(prev?.checks || (prev?.bar != null ? [{ at: prev.barAt || prev.updated, bar: prev.bar }] : [])), { at: Date.now(), bar: t.bar }] }; }
  // on-board lahev rebreatheru: bez názvu dostane RB O2 n / RB DIL n; objem pro výpočty spotřeby
  const x = lb.tanks[id];
  if (x.onboard) {
    if (!x.name) lb.tanks[id] = { ...x, name: rbNextName(lb, x.onboard) };
    const cyl = lb.settings.cyl || { dil: 3, o2: 3 };
    lb.settings = { ...lb.settings, cyl: { ...cyl, [x.onboard]: x.kind === "Dvojče" ? 2 * x.vol : x.vol }, updated: Date.now() };
  }
  return saveLb(lb);
}
/** Uloží skupinu lahví: přejmenování (to = null → smazání, lahve zůstanou) a pořadí (null = bez pořadí). */
export function saveTankGroup(from: string, to: string | null, ord?: number | null): Promise<void> {
  const lb = structuredClone(st.lb);
  if (to !== from) for (const t of Object.values(lb.tanks || {})) {
    if (!t.groups?.includes(from)) continue;
    const g = t.groups.filter((x) => x !== from);
    if (to && !g.includes(to)) g.push(to);
    lb.tanks![t.id] = { ...t, groups: g.length ? g : undefined, updated: Date.now() };
  }
  const o = { ...(lb.settings.tankGroupOrd || {}) };
  const keep = ord === undefined ? o[from] : ord;
  delete o[from];
  if (to && keep != null) o[to] = keep;
  lb.settings = { ...lb.settings, tankGroupOrd: o, updated: Date.now() };
  return saveLb(lb);
}
export function deleteTank(id: string): Promise<void> {
  const lb = structuredClone(st.lb);
  if (lb.tanks) delete lb.tanks[id];
  lb.deleted[id] = Date.now();
  return saveLb(lb);
}
export function saveReg(r: Partial<GearReg> & { name: string }): Promise<void> {
  const lb = structuredClone(st.lb);
  const id = r.id || uid();
  lb.regs = { ...(lb.regs || {}), [id]: { s1: {}, s2: {}, hoses: [], faults: [], ...(lb.regs?.[id] || {}), ...r, id, updated: Date.now() } as GearReg };
  return saveLb(lb);
}
export function deleteReg(id: string): Promise<void> {
  const lb = structuredClone(st.lb);
  if (lb.regs) delete lb.regs[id];
  lb.deleted[id] = Date.now();
  return saveLb(lb);
}
/** Po načtení ponorů: on-board lahve z posledního CC ponoru – založit, rozpoznat, převzít tlak (DiveCAN / vysílač). */
export function gearOnboardSync(): Promise<void> | void {
  if (st.guest || st.temp) return;
  const cc = ownMetas().filter((m) => isCC(m.h));
  const last = cc[cc.length - 1];
  if (!last) return;
  const lb = structuredClone(st.lb);
  const a = gearOnboardApply(lb, last, true);
  if (a || gearRecompute(lb, ownMetas())) return saveLb(lb);
}
/** Ruční přiřazení on-board lahve k ponoru (null = zrušit); tlaky lahví se přepočítají z historie. */
export function rbAssign(diveId: string, role: RbRole, tankId: string | null): Promise<void> {
  const lb = structuredClone(st.lb);
  const rb = { ...lb.notes[diveId]?.rb };
  if (tankId) rb[role] = { id: tankId }; else delete rb[role];
  lb.notes[diveId] = { buddyIds: [], note: "", ...lb.notes[diveId], rb, updated: Date.now() };
  return saveLb(lb);
}
/** Kontrola lahve: potvrzení tlaku nebo nový tlak (plnění se směsí). */
export function tankCheck(id: string, bar: number, fill?: boolean, mix?: string, at = Date.now()): Promise<void> {
  const lb = structuredClone(st.lb);
  const t = lb.tanks?.[id];
  if (!t) return Promise.resolve();
  const checks = [...(t.checks || (t.bar != null ? [{ at: t.barAt || t.updated, bar: t.bar }] : [])), { at, bar, ...(fill ? { fill: true } : {}), ...(mix ? { mix } : {}) }];
  lb.tanks![id] = { ...t, checks, ...(mix ? { mix } : {}), updated: Date.now() };
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
  if (n) toast(`Doplněno z logů ostatních k ${n} ponorům`);
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
/** Zjistí polohu; fresh = nepoužít polohu uloženou v telefonu z posledních 2 min. */
export function locate(fresh = false): Promise<Pos | null> {
  return new Promise((res) => {
    if (!navigator.geolocation) { set({ posErr: "Telefon neposkytuje polohu" }); return res(null); }
    navigator.geolocation.getCurrentPosition(
      (p) => { const pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }; set({ pos, posErr: null }); followDrafts(pos); res(pos); },
      (e) => { set({ posErr: e.code === 1 ? "Přístup k poloze není povolený" : "Polohu se nepodařilo zjistit" }); res(null); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: fresh ? 0 : 120000 },
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
/** Synchronizace jen v produkční verzi a s nastaveným Workerem. */
const syncOn = () => !db.IS_DEV && !!workerUrl() && !!syncKey();
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncing = false;
let lastSyncErr = "";
export function scheduleSync() {
  if (!syncOn() || st.guest) return;
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
  if (!syncOn()) { set({ sync: { state: "off", msg: db.IS_DEV ? "V dev verzi se nesynchronizuje" : "Synchronizace není nastavená", at: 0 } }); return; }
  if (syncing || !navigator.onLine) { if (!navigator.onLine) set({ sync: { ...st.sync, state: "idle", msg: "Bez připojení – odešle se později" } }); return; }
  syncing = true;
  set({ sync: { ...st.sync, state: "busy", msg: "Synchronizuji…" } });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await api("/sync");
      if (!r.ok) throw new Error(`Worker: ${r.status}`);
      const remote = (await r.json()) as { lb: Logbook | null; ver: number; dives: { id: string; num: number; start: number }[] };
      // ponory: stáhnout chybějící, nahrát nové – vždy jen moje (i kdyby se mezitím otevřel cizí log)
      const local = new Set([...ownMetas(), ...ownHidden()].map((m) => m.id)); // i skryté (nepodporovaný typ) – zůstávají v záloze
      const remoteIds = new Set(remote.dives.map((d) => d.id));
      const got: Meta[] = [];
      for (const d of remote.dives) {
        if (local.has(d.id) || d.id.includes(":") || ownLb().deleted?.[d.id]) continue;
        const b = await api(`/dive/${encodeURIComponent(d.id)}`);
        if (!b.ok) continue;
        const raw: RawDive = { id: d.id, num: d.num, start: d.start, blob: new Uint8Array(await b.arrayBuffer()) };
        await db.put("raw", raw);
        let m: Meta; try { m = await metaOf(raw); } catch { continue; } // nečitelný ponor přeskočit
        await db.put("meta", m);
        got.push(m);
      }
      if (got.length) { setOwn({ metas: sortMetas([...ownMetas(), ...got]) }); if (!st.guest) await autoLinkDrafts(); }
      for (const m of [...ownMetas(), ...ownHidden()]) {
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
  if (syncOn()) {
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
  set({ metas: [], hidden: [], lb: emptyLogbook() });
}
