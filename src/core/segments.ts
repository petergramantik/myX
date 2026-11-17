// Spojené ponory: jeden ponor z víc záznamů počítače (bazén se stejným číslem, krátký suchý přechod v jeskyni…).
import type { Dive } from "./shearwater";

export interface SegMeta { id: string; start: number; cnum?: number; h: { serial?: number; diveTimeS: number } }

/**
 * Seskupí záznamy do ponorů. Následující záznam ze stejného počítače se připojí k předchozímu, když:
 * ruční volba „spojit“ (override = true), nebo bez ruční volby „rozdělit“ (override = false) mají stejné číslo
 * ponoru z Cloudu, nebo povrchový interval nepřesáhne gapMin minut (0 = vypnuto).
 * Vrací: hlava → části (seřazené) a část → hlava.
 */
export function segGroups<T extends SegMeta>(metas: T[], gapMin: number, override: Record<string, boolean> = {}): { parts: Map<string, T[]>; head: Map<string, string> } {
  const parts = new Map<string, T[]>(), head = new Map<string, string>();
  const last = new Map<number, { h: T; end: number; cnum?: number }>(); // podle počítače
  for (const m of [...metas].sort((a, b) => a.start - b.start)) {
    const ser = m.h.serial || 0, prev = last.get(ser);
    let join = false;
    if (prev) {
      const ov = override[m.id];
      const gap = m.start - prev.end;
      if (ov === true) join = true;
      else if (ov !== false) join = (m.cnum != null && m.cnum === prev.cnum) || (gapMin > 0 && gap >= -60 && gap <= gapMin * 60);
    }
    if (join && prev) {
      parts.get(prev.h.id)!.push(m); head.set(m.id, prev.h.id);
      last.set(ser, { h: prev.h, end: m.start + m.h.diveTimeS, cnum: m.cnum ?? prev.cnum });
    } else {
      parts.set(m.id, [m]); head.set(m.id, m.id);
      last.set(ser, { h: m, end: m.start + m.h.diveTimeS, cnum: m.cnum });
    }
  }
  return { parts, head };
}

/** Spojí dekódované části do jednoho ponoru: časy se posunou od začátku první části, povrchové intervaly se zapamatují. */
export function mergeDives(ds: Dive[]): Dive & { segs?: { from: number; to: number }[]; surf?: { from: number; to: number }[] } {
  if (ds.length < 2) return ds[0];
  const t0 = ds[0].h.start;
  const s: Record<string, unknown[]> = {};
  const keys = Object.keys(ds[0].s);
  for (const k of keys) s[k] = [];
  const segs: { from: number; to: number }[] = [], surf: { from: number; to: number }[] = [];
  const events: Dive["events"] = [], alarms: Dive["alarms"] = [], buttons: Dive["buttons"] = [], tissues: Dive["tissues"] = [];
  for (const d of ds) {
    const off = d.h.start - t0;
    const n = d.s.t.length;
    for (const k of keys) { const arr = (d.s as unknown as Record<string, unknown[]>)[k] || []; for (let i = 0; i < n; i++) s[k].push(k === "t" ? (arr[i] as number) + off : arr[i]); }
    const prev = segs[segs.length - 1];
    if (prev) surf.push({ from: prev.to, to: off });
    segs.push({ from: off, to: off + d.h.diveTimeS });
    events.push(...d.events.map((e) => ({ ...e, t: e.t + off })));
    alarms.push(...d.alarms.map((a) => ({ ...a, start: a.start + off, end: a.end + off })));
    buttons.push(...d.buttons.map((b) => ({ ...b, t: b.t + off })));
    tissues.push(...d.tissues.map((x) => ({ ...x, t: x.t + off })));
  }
  const last = ds[ds.length - 1];
  const h = { ...ds[0].h, maxDepth: Math.max(...ds.map((d) => d.h.maxDepth)), diveTimeS: last.h.start - t0 + last.h.diveTimeS, end: last.h.end };
  return { ...ds[0], h, s: s as unknown as Dive["s"], events, alarms, buttons, tissues, segs, surf };
}
