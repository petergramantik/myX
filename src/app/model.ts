// Datový model logbooku a sloučení dvou verzí (telefon × Worker) po položkách podle času změny.
import type { Header } from "../core/shearwater";
import type { Summary, Thresholds } from "../core/analysis";
import { DEFAULT_THRESHOLDS } from "../core/analysis";

export interface SpInfo {
  id: number; name?: string; lat?: number; lon?: number; maxDepth?: number; type?: string; region?: string;
  visibility?: number; temps?: (number | null)[]; rating?: string; fetched: number;
}
export interface Site { id: string; name: string; lat?: number; lon?: number; spId?: number; sp?: SpInfo; note?: string; updated: number }
export interface Buddy { id: string; name: string; note?: string; updated: number }
export interface DiveNote { siteId?: string; buddyIds: string[]; note: string; updated: number }
export interface Settings { th: Thresholds; manualFill: number | null; updated: number }

export interface Logbook {
  sites: Record<string, Site>;
  buddies: Record<string, Buddy>;
  notes: Record<string, DiveNote>;
  deleted: Record<string, number>; // id smazané/sloučené lokality nebo parťáka → čas
  settings: Settings;
}

export interface Meta { id: string; num: number; start: number; h: Header; sum: Summary; inj: number }

export const emptyLogbook = (): Logbook => ({
  sites: {}, buddies: {}, notes: {}, deleted: {},
  settings: { th: { ...DEFAULT_THRESHOLDS }, manualFill: null, updated: 0 },
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

export function mergeLogbooks(a: Logbook, b: Logbook): Logbook {
  const deleted = { ...a.deleted };
  for (const [k, t] of Object.entries(b.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, t);
  return {
    sites: mergeMap(a.sites, b.sites || {}, deleted),
    buddies: mergeMap(a.buddies, b.buddies || {}, deleted),
    notes: mergeMap(a.notes, b.notes || {}, {}),
    deleted,
    settings: (b.settings?.updated || 0) > a.settings.updated ? { ...a.settings, ...b.settings, th: { ...DEFAULT_THRESHOLDS, ...b.settings.th } } : a.settings,
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
