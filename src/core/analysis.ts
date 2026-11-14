// Odvozené hodnoty: souhrn ponoru, kalibrace článků, odhad vstřiků solenoidu, upozornění.
import type { Dive, Header } from "./shearwater";

export interface Summary {
  avgDepth: number; tempMin: number; tempMax: number; ppo2Min: number; ppo2Max: number; co2Max: number | null;
  ceilMax: number; ttsMax: number; gf99End: number | null; descMax: number; ascMax: number;
  batVMin: number; decoMin: number; decoModeMin: number; dilStart: number | null; dilEnd: number | null; o2Start: number | null; o2End: number | null; dilUsed: string;
}

const inDive = (d: Dive, i: number) => d.s.t[i] <= d.h.diveTimeS;

export function summarize(d: Dive): Summary {
  const s = d.s, n = s.t.length;
  const idx = [...Array(n).keys()].filter((i) => inDive(d, i));
  const deps = idx.map((i) => s.depth[i]);
  const rates: number[] = [];
  for (const i of idx) if (i + 1 < n) rates.push(((s.depth[i + 1] - s.depth[i]) / (s.t[i + 1] - s.t[i] || 5)) * 60);
  const gfs = s.gf99.filter((x): x is number => x != null);
  const co2 = s.co2.filter((x): x is number => x != null);
  const firstNum = (a: (number | null)[]) => a.find((x) => x != null) ?? null;
  const lastNum = (a: (number | null)[]) => [...a].reverse().find((x) => x != null) ?? null;
  return {
    avgDepth: deps.length ? round(deps.reduce((a, b) => a + b, 0) / deps.length, 1) : 0,
    tempMin: Math.min(...s.temp), tempMax: Math.max(...s.temp),
    ppo2Min: Math.min(...idx.map((i) => s.ppo2[i])), ppo2Max: Math.max(...idx.map((i) => s.ppo2[i])),
    co2Max: co2.length && Math.max(...co2) > 0 ? round(Math.max(...co2), 2) : null,
    ceilMax: Math.max(...s.ceil), ttsMax: Math.max(...s.tts), gf99End: gfs.length ? gfs[gfs.length - 1] : null,
    descMax: rates.length ? round(Math.max(...rates), 1) : 0, ascMax: rates.length ? round(-Math.min(...rates), 1) : 0,
    batVMin: Math.min(...s.bv), // deko = čas v dekompresní povinnosti nejvýš 3 m pod hloubkou zastávky (tam už odpočet běží); deko režim = celá doba s povinností
    decoMin: Math.round(idx.filter((i) => s.stop[i] > 0 && s.depth[i] <= s.stop[i] + 3).length * (d.h.rateS || 5) / 60),
    decoModeMin: Math.round(idx.filter((i) => s.stop[i] > 0).length * (d.h.rateS || 5) / 60), dilStart: firstNum(s.dil), dilEnd: lastNum(s.dil), o2Start: firstNum(s.o2p), o2End: lastNum(s.o2p),
    dilUsed: [...new Set(s.o2.map((o, i) => `${o}/${s.he[i]}`))].join(", "),
  };
}

export const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/** Kalibrace článků odvozená z průměrného pO₂ (bar/mV): medián poměru přes ponor. */
export function cellCalibration(d: Dive): [number | null, number | null, number | null] {
  const s = d.s;
  return ([s.mv1, s.mv2, s.mv3] as number[][]).map((mv) => {
    const r: number[] = [];
    for (let i = 0; i < mv.length; i++) if (mv[i] > 5 && s.ppo2[i] > 0.4 && s.depth[i] > 1.5) r.push(s.ppo2[i] / mv[i]);
    if (r.length < 10) return null;
    r.sort((a, b) => a - b);
    return r[Math.floor(r.length / 2)];
  }) as [number | null, number | null, number | null];
}

export interface Injection { t: number; rise: number; depth: number }

/** Odhad vstřiků O₂: rychlý nárůst pO₂ (s korekcí na stlačení) z hodnoty na setpointu nebo pod ním. */
export function injections(d: Dive): Injection[] {
  const s = d.s, n = s.t.length, out: Injection[] = [];
  const P = s.depth.map((x) => d.h.surfP / 1000 + x * 0.0981);
  const f = s.ppo2.map((v, i) => v / P[i]);
  let i = 1;
  while (i < n - 3) {
    if (s.depth[i] < 1.5 || !inDive(d, i)) { i++; continue; }
    let best = 1;
    for (let k = 2; k <= 3; k++) if (f[i + k] - f[i] > f[i + best] - f[i]) best = k;
    const rise = (f[i + best] - f[i]) * P[i];
    if (rise >= 0.03 && s.ppo2[i] <= s.sp[i] + 0.02 && f[i] <= f[i - 1] + 1e-9) {
      out.push({ t: s.t[i], rise: round(rise, 2), depth: s.depth[i] });
      i += best + 1;
    } else i++;
  }
  return out;
}

export interface Alert { level: "warn" | "bad" | "info"; title: string; text: string; kind?: "scrubber" | "battery" }

/** Minuty jako „4 h 41 min“. */
export const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`;

export interface Thresholds { co2Mbar: number; scrubPct: number; scrubDays: number; batMarginV: number }
export const DEFAULT_THRESHOLDS: Thresholds = { co2Mbar: 5, scrubPct: 50, scrubDays: 14, batMarginV: 0.05 };

const DAY = 86400;
const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString("cs-CZ", { timeZone: "UTC" });

/** Datum náplně scrubberu: nejnovější ponor, kde počítadlo začínalo na plné hodnotě. */
export function scrubberFill(hs: Header[]): Header | null {
  const sorted = [...hs].sort((a, b) => a.start - b.start);
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].scrubLeftStartMin >= sorted[i].scrubTotalMin - 1) return sorted[i];
  return null;
}

export interface ScrubberInfo { left: number; total: number; pct: number; fill: number | null; days: number | null; alerts: Alert[] }

/** Stav scrubberu podle posledního ponoru a data náplně. */
export function scrubberInfo(hs: Header[], nowLocal: number, th: Thresholds, manualFill?: number | null): ScrubberInfo | null {
  if (!hs.length) return null;
  const sorted = [...hs].sort((a, b) => a.start - b.start);
  const last = sorted[sorted.length - 1];
  const total = last.scrubTotalMin || 1, left = last.scrubLeftEndMin, pct = Math.round((left / total) * 100);
  const fill = manualFill ?? scrubberFill(sorted)?.start ?? null;
  const days = fill ? Math.floor((nowLocal - fill) / DAY) : null;
  return { left, total, pct, fill, days, alerts: alerts(sorted, nowLocal, th, manualFill).filter((a) => a.kind === "scrubber") };
}

/** Upozornění na úvodní obrazovce. hs = hlavičky ponorů, nowLocal = aktuální místní čas jako „UTC“ sekundy. */
export function alerts(hs: Header[], nowLocal: number, th: Thresholds, manualFill?: number | null): Alert[] {
  if (!hs.length) return [];
  const sorted = [...hs].sort((a, b) => a.start - b.start);
  const last = sorted[sorted.length - 1];
  const out: Alert[] = [];
  // scrubber
  const total = last.scrubTotalMin || 1;
  const left = last.scrubLeftEndMin;
  const pct = Math.round((left / total) * 100);
  if (pct <= th.scrubPct) out.push({ kind: "scrubber", level: pct <= 20 ? "bad" : "warn", title: "Scrubber za polovinou", text: `Zbývá ${hm(left)} ze ${hm(total)} (${pct} %).` });
  const fill = manualFill ?? scrubberFill(sorted)?.start ?? null;
  if (fill && left < total) {
    const days = Math.floor((nowLocal - fill) / DAY);
    if (days >= th.scrubDays) out.push({ kind: "scrubber", level: "warn", title: "Sorbent příliš starý", text: `Náplň od ${fmtDate(fill)} – už ${days} dní. Zvaž výměnu i přes zbývajících ${hm(left)}.` });
  }
  // baterie: podle posledních ponorů se stejným typem baterie
  const same = sorted.filter((h) => h.batTypeCode === last.batTypeCode).slice(-6);
  const vs = same.map((h) => h.batVStart);
  const warn = last.batWarn;
  if (last.batVEnd <= warn || last.batVStart <= warn + th.batMarginV) {
    out.push({ kind: "battery", level: last.batVEnd <= last.batCrit ? "bad" : "warn", title: "Slabá baterie", text: `Napětí na začátku ${last.batVStart.toFixed(2)} V, na konci ${last.batVEnd.toFixed(2)} V, práh varování ${warn.toFixed(2)} V (${last.batType}).` });
  } else if (vs.length >= 3) {
    const slope = (vs[vs.length - 1] - vs[0]) / (vs.length - 1);
    if (slope < 0) {
      const dives = Math.floor((vs[vs.length - 1] - warn) / -slope);
      if (dives <= 4) out.push({ kind: "battery", level: "warn", title: "Baterie slábne", text: `Napětí na začátku ponoru klesá o ${(-slope * 1000).toFixed(0)} mV na ponor (teď ${vs[vs.length - 1].toFixed(2)} V). Práh ${warn.toFixed(2)} V za zhruba ${Math.max(dives, 1)} ponor(y).` });
    }
  }
  return out;
}

/** Podezřelé hodnoty v jednom ponoru. */
export function diveWarnings(d: Dive, sum: Summary, th: Thresholds): Alert[] {
  const out: Alert[] = [];
  if (sum.co2Max != null && sum.co2Max >= th.co2Mbar) out.push({ level: "bad", title: "Vysoké CO₂", text: `Maximum ppCO₂ ${sum.co2Max.toFixed(1)} mbar.` });
  const cal = cellCalibration(d);
  const mv = [d.s.mv1, d.s.mv2, d.s.mv3];
  mv.forEach((a, k) => {
    const mid = d.s.depth.map((x, i) => (x > 1.5 ? a[i] : null)).filter((x): x is number => x != null);
    if (mid.length && Math.max(...mid) === 0) out.push({ level: "warn", title: `Článek ${k + 1} na nule`, text: "Článek během ponoru ukazoval 0 mV – vadný nebo vypnutý." });
  });
  const ok = cal.filter((c): c is number => c != null);
  if (ok.length === 3) {
    const avg = ok.reduce((a, b) => a + b, 0) / 3;
    cal.forEach((c, k) => { if (c && Math.abs(c - avg) / avg > 0.35) out.push({ level: "info", title: `Článek ${k + 1} se liší`, text: `Jeho mV odpovídají jiné kalibraci než ostatní (o ${Math.round(((c - avg) / avg) * 100)} %).` }); });
  }
  return out;
}
