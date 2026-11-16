// Datový model logbooku a sloučení dvou verzí (telefon × Worker) po položkách podle času změny.
import type { Header } from "../core/shearwater";
import type { Summary, Thresholds } from "../core/analysis";
import { DEFAULT_THRESHOLDS } from "../core/analysis";
import { DEFAULT_CELL_TH, type CellDive, type CellThresholds } from "../core/cells";

export interface SpInfo {
  id: number; name?: string; lat?: number; lon?: number; maxDepth?: number; type?: string; region?: string;
  visibility?: number; temps?: (number | null)[]; rating?: string; fetched: number;
}
export interface Site { id: string; name: string; lat?: number; lon?: number; spId?: number; sp?: SpInfo; note?: string; updated: number }
export interface Buddy { id: string; name: string; note?: string; updated: number }
export type Rating = "up" | "down" | "problem";
export interface WeatherSnap { at: number; temp: number; wind: number; gust: number; cloud: number; pressure: number; precip: number; code: number }
/** Externí lahev připojená během ponoru (Petrel její tlak neměří). */
export interface ExtGas { id: string; gas: "dil" | "o2"; kind: string; vol: number; start?: number; end?: number }
export interface DiveNote {
  siteId?: string; buddyIds: string[]; note: string; rating?: Rating; weather?: WeatherSnap;
  ext?: ExtGas[]; useManual?: { dil?: number; o2?: number }; updated: number;
}
/** Ponor založený na lokalitě před stažením logu; po importu se spáruje s ponorem z počítače. */
export interface Draft extends DiveNote { id: string; created: number; lat?: number; lon?: number; diveId?: string }
/** Záznam o O₂ čidle v cartridgi. Data ve formátu RRRR-MM-DD. */
export interface Cell { id: string; pos: 1 | 2 | 3; maker: string; type?: string; sn?: string; made?: string; installed: string; lifeM: number; removed?: string; reason?: string; note?: string; updated: number }
/** Baterie v hlavě X-CCR (pozice 1 nebo 2). Data ve formátu RRRR-MM-DD. */
export interface Battery { id: string; pos: 1 | 2; maker: string; model?: string; volt?: string; installed: string; removed?: string; note?: string; updated: number }
export interface HeadBatTh { headBatHours: number; headBatMonths: number } // 0 = vypnuto
/** Ruční údaj o poslední kalibraci čidla CO₂ (log ji neukládá). */
export interface Co2Cal { date: string; gas: string }
export interface Settings { th: Thresholds & CellThresholds & HeadBatTh; manualFill: number | null; co2Cal?: Co2Cal | null; motto?: boolean; cyl?: { dil: number; o2: number }; spLateSet?: boolean; updated: number }

export interface Logbook {
  drafts: Record<string, Draft>;
  cells: Record<string, Cell>;
  batteries: Record<string, Battery>;
  answered: Record<string, { answer: "change" | "cal"; updated: number }>; // odpovědi na dotaz „vyměnil jsi čidlo?“ (klíč pozice:idPonoru)
  sites: Record<string, Site>;
  buddies: Record<string, Buddy>;
  notes: Record<string, DiveNote>;
  deleted: Record<string, number>; // id smazané/sloučené lokality nebo parťáka → čas
  settings: Settings;
  computers?: Record<string, Computer>; // sériové číslo cizího počítače → majitel (buddy)
  aliases?: Record<string, Alias>;     // jméno buddyho/lokality z cizího logu → můj záznam
}
/** Jméno z cizího logu přiřazené k mému buddymu nebo lokalitě (klíč „buddy:jméno“ / „site:jméno“ v normalizované podobě). */
export interface Alias { id: string; kind: "buddy" | "site"; name: string; targetId: string; updated: number }
export const aliasKey = (kind: "buddy" | "site", name: string) => `${kind}:${norm(name)}`;
/** Cizí počítač rozpoznaný podle sériového čísla v logu a jeho majitel. */
export interface Computer { id: string; model: string; buddyId?: string; updated: number }

export const META_V = 13;
export interface Meta { id: string; num: number; start: number; h: Header; sum: Summary; inj: number; cells: CellDive; v: number; prof?: number[] }

export const DEFAULT_ALL_TH = { ...DEFAULT_THRESHOLDS, ...DEFAULT_CELL_TH, headBatHours: 0, headBatMonths: 0 };
export const emptyLogbook = (): Logbook => ({
  drafts: {}, cells: {}, batteries: {}, answered: {}, sites: {}, buddies: {}, notes: {}, deleted: {},
  settings: { th: { ...DEFAULT_ALL_TH }, manualFill: null, updated: 0 },
});

function mergeMap<T extends { updated: number }>(a: Record<string, T>, b: Record<string, T>, deleted: Record<string, number>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k];
    const v = !x ? y : !y ? x : x.updated >= y.updated ? x : y;
    if (deleted[k] && deleted[k] >= v.updated) continue;
    out[k] = v;
  }
  return out;
}

/** Hranici pozdního setpointu bere z výchozí hodnoty, dokud ji uživatel sám nezměnil. */
const fixSettings = (x: Settings): Settings => (x.spLateSet ? x : { ...x, th: { ...x.th, spLateMin: DEFAULT_ALL_TH.spLateMin } });

export function mergeLogbooks(a: Logbook, b: Logbook): Logbook {
  const deleted = { ...a.deleted };
  for (const [k, t] of Object.entries(b.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, t);
  return {
    drafts: mergeMap(a.drafts || {}, b.drafts || {}, deleted),
    cells: mergeMap(a.cells || {}, b.cells || {}, deleted),
    batteries: mergeMap(a.batteries || {}, b.batteries || {}, deleted),
    answered: mergeMap(a.answered || {}, b.answered || {}, {}),
    sites: mergeMap(a.sites, b.sites || {}, deleted),
    buddies: mergeMap(a.buddies, b.buddies || {}, deleted),
    notes: mergeMap(a.notes, b.notes || {}, {}),
    computers: mergeMap(a.computers || {}, b.computers || {}, {}),
    aliases: mergeMap(a.aliases || {}, b.aliases || {}, deleted),
    deleted,
    settings: fixSettings((b.settings?.updated || 0) > a.settings.updated
      ? { ...a.settings, ...b.settings, th: { ...DEFAULT_ALL_TH, ...b.settings.th } }
      : { ...a.settings, th: { ...DEFAULT_ALL_TH, ...a.settings.th } }),
  };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const siteCoords = (s: Site): { lat: number; lon: number } | null =>
  s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : s.sp?.lat != null && s.sp?.lon != null ? { lat: s.sp.lat, lon: s.sp.lon } : null;
