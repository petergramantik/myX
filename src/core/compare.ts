// Porovnání dvou současných ponorů (můj vs. buddyho): metriky, rozdíly a stručný závěr z dat.
import { hasDeco, isCC } from "./rig";
import { co2Valid } from "./effort";
import type { Dive } from "./shearwater";
import { atStop, tpt, dur, setpointChanges, o2Doses, summarize, cellSpread, pressureUse, dilDescent, type SpChange, type CellIssue } from "./analysis";
import { co2Plausibility, effortOf } from "./effort";

const amb = (d: Dive, i: number) => (d.h.surfP || 1013) / 1000 + d.s.depth[i] * ((d.h.salinity || 1000) / 1000) * 0.0981;
const inDive = (d: Dive, i: number) => d.s.t[i] <= d.h.diveTimeS;

export interface DiveStats {
  /** počítač měří pO₂ čidly / počítá dekompresi – co lze porovnat */ cc: boolean; deco: boolean;
  maxDepth: number; avgDepth: number; durMin: number; t20: number; t30: number; descRate: number; ascRate: number; vMove: number;
  spUp: SpChange | null; spUpVal: number | null; sp019: SpChange | null; spN: number;
  po2All: number; po2Bottom: number; po2Deco: number | null; spErr: number; offMin: number;
  offBelow: number; offAbove: number; boostMin: number; boostPo2: number | null; po2Asc: number | null; decoObl: number;
  gf: string; ttsMax: number; ceilMax: number; decoMin: number; cnsEnd: number;
  co2Max: number | null; co2Avg: number | null; co2Alarms: number; scrubLeftStart: number;
  dil: string; dosesMan: number; dosesSol: number; tempMin: number; btnN: number;
  inert: number; ambInt: number; po2Int: number; // bar·min
  densMax: number; dens52: number; vents: number; co2Bad: boolean; cellIssue: CellIssue;
  /** spotřeba z tlaku on-board lahví (bar), null = tlak v logu není */ o2Bar: number | null; dilBar: number | null; dilDesc: number | null;
}

/** Metriky ponoru pro porovnání. Časově vážené průměry přes úseky ponoru (hloubka > 1,5 m). */
/** Hranice významné odchylky od setpointu (bar): pod / nad. */
export interface SpDev { below: number; above: number }
export const SP_DEV: SpDev = { below: 0.15, above: 0.2 };

/**
 * Významné odchylky pO₂ od setpointu (min): pod setpointem kdykoli (bez 2 min po přepnutí), nad setpointem jen
 * při vysokém SP a mimo dekompresní fázi; souvisle ≥ 30 s. Zvýšení pO₂ během deko se počítá zvlášť (záměrná technika).
 */
export function spDeviation(d: Dive, dev: SpDev = SP_DEV) {
  const s = d.s, n = s.t.length;
  let iMax = 0; s.depth.forEach((x, i) => { if (x > s.depth[iMax]) iMax = i; });
  let leave = n - 1; for (let i = n - 1; i >= 0; i--) if (s.depth[i] >= d.h.maxDepth * 0.7) { leave = i; break; }
  let lastChg = -1e9;
  const kind: (0 | 1 | 2 | 3)[] = []; // 1 pod, 2 nad, 3 zvýšené v deko
  for (let i = 0; i < n; i++) {
    if (i > 0 && s.sp[i] !== s.sp[i - 1]) lastChg = s.t[i];
    let k: 0 | 1 | 2 | 3 = 0;
    if (s.depth[i] >= 1.5 && s.t[i] <= d.h.diveTimeS && s.t[i] - lastChg >= 120) {
      const e = s.ppo2[i] - s.sp[i];
      const deco = s.stop[i] > 0 || (i >= leave && s.depth[i] <= 6);
      if (e < -dev.below) k = 1;
      else if (deco && e > 0.1 && s.ppo2[i] >= 1.2) k = 3; // záměrné zvýšení pO₂ na zastávkách
      else if (!deco && s.sp[i] >= 1 && e > dev.above) k = 2;
    }
    kind.push(k);
  }
  const dtOf = (i: number) => (i + 1 < n ? s.t[i + 1] - s.t[i] : d.h.rateS || 5);
  const tot = { 1: 0, 2: 0, 3: 0 }; let boostSum = 0, boostW = 0;
  for (let i = 0; i < n;) {
    const k = kind[i]; let j = i, dur = 0;
    while (j < n && kind[j] === k) { dur += dtOf(j); j++; }
    if (k && dur >= 30) { tot[k] += dur; if (k === 3) for (let q = i; q < j; q++) { boostSum += s.ppo2[q] * dtOf(q); boostW += dtOf(q); } }
    i = j;
  }
  return { below: tot[1] / 60, above: tot[2] / 60, boost: tot[3] / 60, boostPo2: boostW ? boostSum / boostW : null, leave };
}

export function diveStats(d: Dive, dev: SpDev = SP_DEV): DiveStats {
  const s = d.s, n = s.t.length, sum = summarize(d);
  const dt = (i: number) => (i + 1 < n ? s.t[i + 1] - s.t[i] : d.h.rateS || 5);
  let w = 0, po2 = 0, wb = 0, po2b = 0, wd = 0, po2d = 0, err = 0, off = 0, t20 = 0, t30 = 0, ambI = 0, po2I = 0, mv = 0;
  for (let i = 0; i < n; i++) {
    if (!inDive(d, i) || s.depth[i] < 1.5) continue;
    const k = dt(i);
    w += k; po2 += s.ppo2[i] * k;
    if (s.depth[i] >= d.h.maxDepth * 0.7) { wb += k; po2b += s.ppo2[i] * k; }
    if (s.stop[i] > 0) { wd += k; po2d += s.ppo2[i] * k; }
    const e = Math.abs(s.ppo2[i] - s.sp[i]); err += e * k; if (e > 0.1) off += k;
    if (s.depth[i] >= 20) t20 += k; if (s.depth[i] >= 30) t30 += k;
    ambI += amb(d, i) * k / 60; po2I += Math.min(s.ppo2[i], amb(d, i)) * k / 60;
    if (i > 0) mv += Math.abs(s.depth[i] - s.depth[i - 1]);
  }
  let iMax = 0; s.depth.forEach((x, i) => { if (x > s.depth[iMax]) iMax = i; });
  const tMax = s.t[iMax];
  const tEnd = s.t.findLast((t, i) => inDive(d, i) && s.depth[i] >= 1.5) ?? d.h.diveTimeS;
  const sp = setpointChanges(d);
  const up = sp.find((c) => c.to >= 1) || null;
  const doses = o2Doses(d);
  const co2 = co2Valid(d).filter((x): x is number => x != null);
  const ef = effortOf(d);
  const sd = spDeviation(d, dev);
  let asc = 0, ascW = 0, obl = 0;
  for (let i = sd.leave; i < n; i++) { if (!inDive(d, i) || s.depth[i] < 1.5) continue; asc += s.ppo2[i] * dt(i); ascW += dt(i); }
  for (let i = 0; i < n; i++) if (inDive(d, i) && s.stop[i] > 0) obl += dt(i);
  return {
    offBelow: sd.below, offAbove: sd.above, boostMin: sd.boost, boostPo2: sd.boostPo2, po2Asc: ascW >= 60 ? asc / ascW : null, decoObl: obl / 60,
    maxDepth: d.h.maxDepth, avgDepth: sum.avgDepth, durMin: d.h.diveTimeS / 60, t20: t20 / 60, t30: t30 / 60,
    descRate: tMax ? d.h.maxDepth / (tMax / 60) : 0, ascRate: tEnd > tMax ? d.h.maxDepth / ((tEnd - tMax) / 60) : 0, vMove: w ? mv / (w / 60) : 0,
    spUp: up, spUpVal: up?.to ?? null, sp019: sp.find((c) => c.to < 0.3 && c.t > 60) || null, spN: sp.length,
    po2All: w ? po2 / w : 0, po2Bottom: wb ? po2b / wb : 0, po2Deco: wd >= 60 ? po2d / wd : null, spErr: w ? err / w : 0, offMin: sd.below + sd.above,
    gf: `${d.h.gfLo}/${d.h.gfHi}`, ttsMax: Math.max(...s.tts), ceilMax: Math.max(...s.ceil), decoMin: s.t.filter((_, i) => inDive(d, i) && atStop(d, i)).length * (d.h.rateS || 5) / 60, cnsEnd: d.h.cnsEnd,
    co2Max: sum.co2Max, co2Avg: co2.length && sum.co2Max != null ? co2.reduce((a, b) => a + b, 0) / co2.length : null, co2Alarms: d.alarms.filter((a) => a.kind === "co2").length,
    scrubLeftStart: d.h.scrubLeftStartMin, dil: sum.dilUsed.split(",")[0] || "", dosesMan: doses.filter((x) => x.kind === "man").length, dosesSol: doses.filter((x) => x.kind === "sol").length,
    tempMin: sum.tempMin, btnN: sum.btnN,
    inert: ambI - po2I, ambInt: ambI, po2Int: po2I,
    cc: isCC(d.h), deco: hasDeco(d.h),
    densMax: ef.densMax, dens52: ef.densOver52, vents: ef.vents, co2Bad: co2Plausibility(d)?.ok === false, cellIssue: cellSpread(d)?.kind ?? "",
    o2Bar: gasBar(d, s.o2p), dilBar: gasBar(d, s.dil), dilDesc: dilDescent(d),
  };
}

export interface DiffRow { key: string; label: string; a: string; b: string; weight: number }
const f1 = (v: number | null | undefined, d = 1) => (v == null ? "–" : v.toLocaleString("cs-CZ", { maximumFractionDigits: d, minimumFractionDigits: d > 1 ? d : 0 }));
const spTxt = (c: SpChange | null) => (c ? `${tpt(c.t)}, ${f1(c.depth)} m` : "nepřepnuto");

/** Porovnávané veličiny: hodnota (číslo pro výpočet rozdílu), text, měřítko „podstatného“ rozdílu a váha. */
interface Metric { /** chybějící údaj (–) nevstupuje do rozdílů */ opt?: boolean; key: string; label: string; /** potřebuje čidla O₂ / výpočet dekomprese */ need?: "cc" | "deco"; v: (s: DiveStats) => number | null; txt: (s: DiveStats) => string; scale: number | ((xs: number[]) => number); w: number; cat?: boolean }
const METRICS: Metric[] = [
  { key: "tts", need: "deco", label: "Max. zbývající deko (TTS)", v: (s) => s.ttsMax, txt: (s) => `${s.ttsMax} min`, scale: 3, w: 1.5 },
  { key: "deco", need: "deco", label: "Na zastávkách", v: (s) => s.decoMin, txt: (s) => `${f1(s.decoMin, 0)} min`, scale: 2, w: 1 },
  { key: "spUp", need: "cc", label: "Přepnutí na vysoký SP", v: (s) => (s.spUp ? s.spUp.t / 60 : null), txt: (s) => spTxt(s.spUp), scale: 3, w: 1.3 },
  { key: "spVal", need: "cc", label: "Vysoký setpoint", v: (s) => s.spUpVal, txt: (s) => f1(s.spUpVal, 2), scale: 0.05, w: 1 },
  { key: "inert", need: "cc", label: "Inertní zátěž ∫(P − pO₂)", v: (s) => s.inert, txt: (s) => `${f1(s.inert, 0)} bar·min`, scale: (xs) => Math.max(5, (xs.reduce((a, b) => a + b, 0) / xs.length) * 0.06), w: 1 },
  { key: "avg", label: "Průměrná hloubka", v: (s) => s.avgDepth, txt: (s) => `${f1(s.avgDepth)} m`, scale: 1, w: 1 },
  { key: "max", label: "Max. hloubka", v: (s) => s.maxDepth, txt: (s) => `${f1(s.maxDepth)} m`, scale: 2, w: 1 },
  { key: "t20", label: "Čas pod 20 m", v: (s) => s.t20, txt: (s) => `${f1(s.t20, 0)} min`, scale: 3, w: 1 },
  { key: "dur", label: "Délka ponoru", v: (s) => s.durMin, txt: (s) => `${f1(s.durMin, 0)} min`, scale: 3, w: 1 },
  { key: "po2", need: "cc", label: "Průměrné pO₂", v: (s) => s.po2All, txt: (s) => `${f1(s.po2All, 2)} bar`, scale: 0.05, w: 1 },
  { key: "po2b", need: "cc", label: "pO₂ na dně", v: (s) => s.po2Bottom, txt: (s) => `${f1(s.po2Bottom, 2)} bar`, scale: 0.05, w: 1 },
  { key: "po2d", need: "cc", label: "pO₂ během deko", v: (s) => s.po2Deco, txt: (s) => (s.po2Deco != null ? `${f1(s.po2Deco, 2)} bar` : "bez deko"), scale: 0.05, w: 1 },
  { key: "po2a", need: "cc", label: "pO₂ při výstupu", v: (s) => s.po2Asc, txt: (s) => (s.po2Asc != null ? `${f1(s.po2Asc, 2)} bar` : "–"), scale: 0.05, w: 0.9 },
  { key: "below", need: "cc", label: "Pod setpointem", v: (s) => s.offBelow, txt: (s) => `${dur((s.offBelow) * 60)}`, scale: 2, w: 1 },
  { key: "above", need: "cc", label: "Nad setpointem (mimo deko)", v: (s) => s.offAbove, txt: (s) => `${dur((s.offAbove) * 60)}`, scale: 2, w: 0.8 },
  { key: "boost", need: "cc", label: "pO₂ zvýšené během deko", v: (s) => s.boostMin, txt: (s) => (s.boostMin >= 0.5 ? `${f1(s.boostMin, 0)} min, ${f1(s.boostPo2, 2)} bar` : "–"), scale: 2, w: 0.8 },
  { key: "gf", need: "deco", label: "GF", v: () => null, txt: (s) => s.gf, scale: 1, w: 2.5, cat: true },
  { key: "co2", label: "Max. CO₂", v: (s) => s.co2Max ?? 0, txt: (s) => (s.co2Max != null ? `${f1(s.co2Max)} mbar` : "–") + (s.co2Bad ? " (čidlo nevěrohodné)" : ""), scale: 1, w: 1 },
  { key: "co2al", need: "cc", label: "Alarmy CO₂", v: (s) => s.co2Alarms, txt: (s) => `${s.co2Alarms}×` + (s.co2Bad ? " (čidlo nevěrohodné)" : ""), scale: 1, w: 1 },
  { key: "scrub", need: "cc", label: "Scrubber na začátku", v: (s) => s.scrubLeftStart, txt: (s) => `${s.scrubLeftStart} min`, scale: 60, w: 0.5 },
  { key: "man", need: "cc", label: "Ruční dávky O₂", v: (s) => s.dosesMan, txt: (s) => `${s.dosesMan}×`, scale: 3, w: 0.6 },
  { key: "sol", need: "cc", label: "Solenoid (odhad)", v: (s) => s.dosesSol, txt: (s) => `${s.dosesSol}×`, scale: 5, w: 0.4 },
  { key: "asc", label: "Rychlost výstupu", v: (s) => s.ascRate, txt: (s) => `${f1(s.ascRate)} m/min`, scale: 1, w: 0.6 },
  { key: "move", label: "Pohyb ve vertikále", v: (s) => s.vMove, txt: (s) => `${f1(s.vMove)} m/min`, scale: 0.5, w: 0.5 },
  { key: "cns", need: "deco", label: "CNS na konci", v: (s) => s.cnsEnd, txt: (s) => `${s.cnsEnd} %`, scale: 5, w: 0.5 },
  { key: "dens", label: "Hustota plynu max", v: (s) => s.densMax, txt: (s) => `${f1(s.densMax)} g/l`, scale: 0.5, w: 0.8 },
  { key: "dens52", label: "Nad 5,2 g/l", v: (s) => s.dens52, txt: (s) => `${f1(s.dens52, 0)} min`, scale: 5, w: 0.6 },
  { key: "o2use", need: "cc", opt: true, label: "Spotřeba O₂ (tlak)", v: (s) => s.o2Bar, txt: (s) => (s.o2Bar != null ? `${f1(s.o2Bar, 0)} bar` : "–"), scale: 15, w: 0.8 },
  { key: "diluse", need: "cc", opt: true, label: "Spotřeba diluentu (tlak)", v: (s) => s.dilBar, txt: (s) => (s.dilBar != null ? `${f1(s.dilBar, 0)} bar` : "–"), scale: 15, w: 0.6 },
  { key: "dildesc", need: "cc", opt: true, label: "Diluent při sestupu", v: (s) => s.dilDesc, txt: (s) => (s.dilDesc != null ? `${f1(s.dilDesc, 0)} bar` : "–"), scale: 8, w: 0.4 },
  { key: "vents", need: "cc", label: "Proplach (doplnění diluentu)", v: (s) => s.vents, txt: (s) => `${s.vents}×`, scale: 3, w: 0.5 },
  { key: "dil", need: "cc", label: "Diluent", v: () => null, txt: (s) => s.dil, scale: 1, w: 2, cat: true },
  { key: "temp", label: "Min. teplota", v: (s) => s.tempMin, txt: (s) => `${s.tempMin} °C`, scale: 2, w: 0.3 },
  { key: "btn", label: "Stisky tlačítek", v: (s) => s.btnN, txt: (s) => `${s.btnN}`, scale: 10, w: 0.2 },
];

export interface MultiRow { key: string; label: string; vals: string[]; weight: number; hi: number; lo: number; muted?: boolean }
/** Spotřeba z tlaku lahve (bar) – jen když log tlak má. */
function gasBar(d: Dive, p: (number | null)[]): number | null {
  if (!p.some((v) => v != null && v > 0)) return null;
  const u = pressureUse(d.s.t, p, d.s.depth, d.h.diveTimeS);
  return u.ok ? Math.round(u.bar * 10) / 10 : null;
}

/** Tabulka rozdílů pro 2 a více potápěčů, seřazená podle rozptylu; hi/lo = index nejvyšší a nejnižší hodnoty. */
export function multiRows(st: DiveStats[]): MultiRow[] {
  return METRICS.filter((m) => !m.need || st.some((x) => x[m.need!])).map((m) => {
    // veličina, kterou některý ponor nemá (bez čidel, bez dekomprese): „–“ a nevstupuje do rozdílů
    if (m.need && st.some((x) => !x[m.need!])) return { key: m.key, label: m.label, vals: st.map((x) => (x[m.need!] ? m.txt(x) : "–")), weight: 0, hi: -1, lo: -1, muted: true };
    const vals = st.map(m.txt);
    // CO₂ z nevěrohodného čidla nevstupuje do řazení rozdílů
    if ((m.key === "co2" || m.key === "co2al") && st.some((x) => x.co2Bad)) return { key: m.key, label: m.label, vals, weight: 0, hi: -1, lo: -1, muted: true };
    if (m.cat) return { key: m.key, label: m.label, vals, weight: new Set(vals).size > 1 ? m.w : 0, hi: -1, lo: -1 };
    const xs = st.map(m.v);
    const ok = xs.filter((x): x is number => x != null);
    if (m.opt && ok.length < xs.length) return { key: m.key, label: m.label, vals, weight: 0, hi: -1, lo: -1, muted: true };
    // chybějící hodnota (např. nepřepnutý SP) proti existující = výrazný rozdíl
    if (ok.length < xs.length) return { key: m.key, label: m.label, vals, weight: ok.length ? 3 * m.w : 0, hi: -1, lo: -1 };
    const scale = typeof m.scale === "function" ? m.scale(ok) : m.scale;
    const mx = Math.max(...ok), mn = Math.min(...ok);
    return { key: m.key, label: m.label, vals, weight: Math.min(3, (mx - mn) / scale) * m.w, hi: mx > mn ? xs.indexOf(mx) : -1, lo: mx > mn ? xs.indexOf(mn) : -1 };
  }).sort((a, b) => b.weight - a.weight);
}

/** Tabulka rozdílů dvou potápěčů (zpětná kompatibilita). */
export function diffRows(a: DiveStats, b: DiveStats): DiffRow[] {
  return multiRows([a, b]).map((r) => ({ key: r.key, label: r.label, a: r.vals[0], b: r.vals[1], weight: r.weight }));
}

export interface Section { key: string; title: string; level: 0 | 1 | 2; lines: string[] }
const SECT: Record<string, string> = { deco: "Dekomprese", po2: "pO₂ a setpoint", co2: "CO₂", breath: "Dýchání a smyčka", profile: "Profil", gas: "Plyny" };
const sec = (key: string, level: 0 | 1 | 2, lines: string[]): Section => ({ key, title: SECT[key], level, lines });
const sortSec = (x: Section[]) => x.sort((p, q) => q.level - p.level);

/** Úsek ≥ 6 min, ve kterém byl jeden potápěč nejvíc hlouběji (b proti a, b posunuté o off s). */
export function deeperWindow(a: Dive, b: Dive, off: number): { from: number; to: number; diff: number } | null {
  const da: number[] = [], db: number[] = [];
  const at = (d: Dive, t: number) => { if (t < 0 || t > d.h.diveTimeS) return null; const i = d.s.t.findIndex((x) => x >= t); return i < 0 ? null : d.s.depth[i]; };
  for (let t = 0; t <= a.h.diveTimeS; t += 30) { const x = at(a, t), y = at(b, t - off); if (x == null || y == null) { da.push(NaN); db.push(NaN); } else { da.push(x); db.push(y); } }
  const W = 12; let best: { from: number; to: number; diff: number } | null = null;
  for (let i = 0; i + W <= da.length; i++) {
    let sum = 0, n = 0; for (let k = i; k < i + W; k++) if (!isNaN(da[k])) { sum += db[k] - da[k]; n++; }
    if (n < W * 0.8) continue;
    const diff = sum / n;
    if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { from: i * 30, to: (i + W) * 30, diff };
  }
  return best && Math.abs(best.diff) >= 1.5 ? best : null;
}

/** Vysvětlení podílu hloubky: jen to, co se skutečně liší (průměrná hloubka, délka ponoru, úsek hlouběji). */
function depthWhy(x: DiveStats, y: DiveStats, deeper: string | null): string | null {
  if (Math.abs(x.avgDepth - y.avgDepth) >= 0.3) return `${x.avgDepth > y.avgDepth ? "vyšší" : "nižší"} průměrná hloubka (${f1(x.avgDepth)} vs. ${f1(y.avgDepth)} m)`;
  if (Math.abs(x.durMin - y.durMin) >= 2) return `${x.durMin > y.durMin ? "delší" : "kratší"} ponor (${f1(x.durMin, 0)} vs. ${f1(y.durMin, 0)} min)`;
  return deeper;
}

/**
 * Závěr dvou potápěčů po sekcích (dekomprese, pO₂ a setpoint, CO₂, dýchání, profil, plyny).
 * Rozdíl v deko se rozkládá na hloubku a pO₂ jen při podstatném rozdílu inertní zátěže (≥ 5 % a ≥ 10 bar·min).
 */
function conclusionSections0(A: string, B: string, a: DiveStats, b: DiveStats, deeper?: { from: number; to: number; diff: number } | null): Section[] {
  const out: Section[] = [];
  // ---- dekomprese
  {
    const lines: string[] = [];
    const L = a.ttsMax > b.ttsMax || (a.ttsMax === b.ttsMax && (a.decoMin > b.decoMin || (a.decoMin === b.decoMin && a.decoObl > b.decoObl))) ? { who: A, x: a, y: b, other: B } : { who: B, x: b, y: a, other: A };
    const dTts = L.x.ttsMax - L.y.ttsMax, dDeco = L.x.decoMin - L.y.decoMin;
    let level: 0 | 1 | 2 = dTts >= 4 || dDeco >= 4 ? 2 : dTts >= 2 || dDeco >= 2 ? 1 : 0;
    const shorter = Math.abs(a.durMin - b.durMin) >= 10 && Math.min(a.durMin, b.durMin) < Math.max(a.durMin, b.durMin) * 0.6;
    if (shorter) {
      const s0 = a.durMin < b.durMin ? { who: A, x: a, y: b } : { who: B, x: b, y: a };
      lines.push(`${s0.who}: ponor ukončen dříve (${f1(s0.x.durMin, 0)} vs. ${f1(s0.y.durMin, 0)} min) – rozdíl v dekompresi plyne z délky ponoru, srovnávej hlavně společnou část.`);
      out.push(sec("deco", 1, lines));
    } else {
    if (dTts >= 2) lines.push(`${L.who}: delší dekomprese (max. TTS ${L.x.ttsMax} vs. ${L.y.ttsMax} min, na zastávkách ${f1(L.x.decoMin, 0)} vs. ${f1(L.y.decoMin, 0)} min).`);
    else if (dDeco >= 2) lines.push(`${L.who}: delší čas na zastávkách (${f1(L.x.decoMin, 0)} vs. ${f1(L.y.decoMin, 0)} min), max. TTS podobné (${L.x.ttsMax} vs. ${L.y.ttsMax} min).`);
    else lines.push(`Dekompresní povinnost podobná (max. TTS ${a.ttsMax} vs. ${b.ttsMax} min, na zastávkách ${f1(a.decoMin, 0)} vs. ${f1(b.decoMin, 0)} min).`);
    if ((a.decoObl >= 1) !== (b.decoObl >= 1)) {
      const w = a.decoObl >= 1 ? { who: A, x: a, other: B } : { who: B, x: b, other: A };
      lines.push(`${w.who}: ${w.x.decoObl < 5 ? "krátká " : ""}dekompresní povinnost ${f1(w.x.decoObl, 0)} min${w.x.po2Deco != null ? ` (pO₂ během deko ${f1(w.x.po2Deco, 2)} bar)` : ""}, ${w.other}: bez deko.`);
      level = Math.max(level, w.x.decoObl >= 5 ? 2 : 1) as 0 | 1 | 2;
    }
    if (a.gf !== b.gf) { lines.push(`Jiné GF (${A} ${a.gf}, ${B} ${b.gf}) – samo o sobě mění povinnost i při stejném profilu.`); level = Math.max(level, 1) as 0 | 1 | 2; }
    if (level > 0) {
      const dIn = L.x.inert - L.y.inert, mean = (L.x.inert + L.y.inert) / 2 || 1;
      if (Math.abs(dIn) < 10 || Math.abs(dIn) / mean < 0.05) {
        const why: string[] = [];
        if (L.x.po2Deco != null && L.y.po2Deco != null && L.y.po2Deco - L.x.po2Deco >= 0.03) why.push(`nižší pO₂ během deko (${f1(L.x.po2Deco, 2)} vs. ${f1(L.y.po2Deco, 2)} bar)`);
        if (L.x.ascRate - L.y.ascRate >= 1) why.push(`rychlejší výstup (${f1(L.x.ascRate)} vs. ${f1(L.y.ascRate)} m/min)`);
        lines.push(`Inertní zátěž prakticky stejná (rozdíl ${f1(Math.abs(dIn), 0)} bar·min, ${f1(Math.abs(dIn) / mean * 100, 0)} %)` + (why.length ? ` – rozdíl dělá spíš ${why.join(" a ")}.` : "."));
      } else if (dIn > 0) {
        const depthPart = L.x.ambInt - L.y.ambInt, po2Part = L.y.po2Int - L.x.po2Int;
        const tot = Math.abs(depthPart) + Math.abs(po2Part) || 1;
        const parts: [number, string][] = [];
        if (po2Part > 0) parts.push([po2Part / tot,
          L.x.spUp && L.y.spUp && L.x.spUp.t - L.y.spUp.t >= 120 ? `pozdější přepnutí na vysoký setpoint (${tpt(L.x.spUp.t)} vs. ${tpt(L.y.spUp.t)})`
          : !L.x.spUp && L.y.spUp ? "nepřepnutí na vysoký setpoint"
          : (L.x.spUpVal ?? 0) < (L.y.spUpVal ?? 0) ? `nižší vysoký setpoint (${f1(L.x.spUpVal, 2)} vs. ${f1(L.y.spUpVal, 2)})`
          : `nižší průměrné pO₂ (${f1(L.x.po2All, 2)} vs. ${f1(L.y.po2All, 2)} bar)`]);
        if (depthPart > 0) {
          const dw = deeper ? (() => { const who = (L.who === B) === (deeper.diff > 0) ? L.who : L.other; return who === L.who ? `v ${tpt(deeper.from)}–${tpt(deeper.to)} průměrně o ${f1(Math.abs(deeper.diff))} m hlouběji` : null; })() : null;
          const why = depthWhy(L.x, L.y, dw);
          if (why) parts.push([depthPart / tot, why]);
        }
        parts.sort((p, q) => q[0] - p[0]);
        if (parts.length) lines.push(`Inertní zátěž vyšší o ${f1(dIn, 0)} bar·min: ` + parts.map(([w, t], i) => (i === 0 ? `zhruba ${Math.round(w * 100)} % vysvětluje ${t}` : `zbytek ${t}`)).join(", ") + ".");
      }
    }
    out.push(sec("deco", level, lines));
    }
  }
  // ---- pO₂ a setpoint
  {
    const lines: string[] = []; let level: 0 | 1 | 2 = 0;
    if (a.spUp && b.spUp && Math.abs(a.spUp.t - b.spUp.t) >= 120) { const l = a.spUp.t > b.spUp.t ? A : B; lines.push(`${l}: později přepnutý vysoký setpoint (${tpt(Math.max(a.spUp.t, b.spUp.t))} vs. ${tpt(Math.min(a.spUp.t, b.spUp.t))}).`); level = Math.abs(a.spUp.t - b.spUp.t) >= 300 ? 2 : 1; }
    else if (!!a.spUp !== !!b.spUp) { lines.push(`${a.spUp ? B : A}: vysoký setpoint nepřepnut.`); level = 2; }
    if (a.spUpVal != null && b.spUpVal != null && Math.abs(a.spUpVal - b.spUpVal) >= 0.05) { lines.push(`Jiný vysoký setpoint (${A} ${f1(a.spUpVal, 2)}, ${B} ${f1(b.spUpVal, 2)}).`); level = Math.max(level, 1) as 0 | 1 | 2; }
    if (a.po2Deco != null && b.po2Deco != null && Math.abs(a.po2Deco - b.po2Deco) >= 0.05) { const lo = a.po2Deco < b.po2Deco ? A : B; lines.push(`${lo}: nižší pO₂ během deko (${f1(Math.min(a.po2Deco, b.po2Deco), 2)} vs. ${f1(Math.max(a.po2Deco, b.po2Deco), 2)} bar) – prodlužuje zastávky.`); level = Math.max(level, 1) as 0 | 1 | 2; }
    for (const [k, lab] of [["offBelow", "pod setpointem (o víc než 0,15 bar)"], ["offAbove", "nad setpointem mimo deko (o víc než 0,2 bar)"]] as const) {
      if (Math.abs(a[k] - b[k]) >= 2) { const w = a[k] > b[k] ? { who: A, x: a, y: b } : { who: B, x: b, y: a }; lines.push(`${w.who}: déle ${lab} (${f1(w.x[k], 1)} vs. ${dur((w.y[k]) * 60)})` + (k === "offBelow" && w.x.dosesMan > w.y.dosesMan + 3 ? `, častěji dávkoval O₂ ručně (${w.x.dosesMan}× vs. ${w.y.dosesMan}×).` : ".")); level = Math.max(level, k === "offBelow" ? 2 : 1) as 0 | 1 | 2; }
    }
    if (Math.abs(a.boostMin - b.boostMin) >= 2) { const w = a.boostMin > b.boostMin ? { who: A, x: a, y: b } : { who: B, x: b, y: a }; lines.push(`${w.who}: během deko pO₂ zvýšené na ${f1(w.x.boostPo2, 2)} bar po ${f1(w.x.boostMin, 0)} min (${w.y.boostMin >= 0.5 ? `${f1(w.y.boostMin, 0)} min` : "druhý ne"}) – zkracuje zastávky.`); level = Math.max(level, 1) as 0 | 1 | 2; }
    for (const [w, x] of [[A, a], [B, b]] as const) if (x.cellIssue) { lines.push(`${w}: ${cellIssueText(x.cellIssue)} – hodnoty pO₂ ber s rezervou.`); level = Math.max(level, 1) as 0 | 1 | 2; }
    out.push(sec("po2", level, lines));
  }
  // ---- CO₂
  {
    const lines: string[] = []; let level: 0 | 1 | 2 = 0;
    if (a.co2Bad || b.co2Bad) {
      const bad = [a.co2Bad ? A : null, b.co2Bad ? B : null].filter(Boolean).join(", ");
      lines.push(`CO₂ nelze porovnat – čidlo (${bad}) nejspíš podhodnocuje (oříznutá nula). Zkontroluj kalibraci.`);
      lines.push(`Pro informaci: max. ${A} ${f1(a.co2Max)} mbar, ${B} ${f1(b.co2Max)} mbar.`);
      level = 1;
    } else if (a.co2Max != null && b.co2Max != null && (Math.abs(a.co2Max - b.co2Max) >= 1 || a.co2Alarms !== b.co2Alarms)) {
      const hi = a.co2Max > b.co2Max ? { who: A, x: a, y: b } : { who: B, x: b, y: a };
      const why: string[] = [];
      if (hi.x.scrubLeftStart < hi.y.scrubLeftStart - 30) why.push(`méně zbývajícího scrubberu na začátku (${hi.x.scrubLeftStart} vs. ${hi.y.scrubLeftStart} min)`);
      if (hi.x.vMove > hi.y.vMove * 1.2) why.push(`víc pohybu ve vertikále (${f1(hi.x.vMove)} vs. ${f1(hi.y.vMove)} m/min) – nejspíš vyšší zátěž`);
      if (hi.x.dens52 > hi.y.dens52 + 3) why.push(`delší dýchání husté směsi nad 5,2 g/l (${f1(hi.x.dens52, 0)} vs. ${f1(hi.y.dens52, 0)} min)`);
      if (hi.x.tempMin < hi.y.tempMin - 1) why.push(`nižší teplota (${hi.x.tempMin} vs. ${hi.y.tempMin} °C)`);
      lines.push(`${hi.who}: vyšší CO₂ (max. ${f1(hi.x.co2Max)} vs. ${f1(hi.y.co2Max)} mbar, alarmy ${hi.x.co2Alarms}× vs. ${hi.y.co2Alarms}×).`);
      lines.push(why.length ? `Souvisí nejspíš s: ${why.join(", ")}.` : "Z profilu ani scrubberu jasná příčina neplyne – zkontroluj sorbent a smyčku.");
      level = hi.x.co2Alarms > 0 || (hi.x.co2Max ?? 0) >= 5 ? 2 : 1;
    }
    out.push(sec("co2", level, lines));
  }
  // ---- dýchání a smyčka
  {
    const lines: string[] = []; let level: 0 | 1 | 2 = 0;
    if (Math.abs(a.densMax - b.densMax) >= 0.3 || Math.abs(a.dens52 - b.dens52) >= 3) { const h = a.densMax > b.densMax ? { who: A, x: a, y: b } : { who: B, x: b, y: a }; lines.push(`${h.who}: hustší směs (max. ${f1(h.x.densMax)} vs. ${f1(h.y.densMax)} g/l, nad 5,2 g/l ${f1(h.x.dens52, 0)} vs. ${f1(h.y.dens52, 0)} min).`); level = h.x.densMax > 6.2 ? 2 : 1; }
    if (Math.abs(a.vents - b.vents) >= 4) { const v = a.vents > b.vents ? { who: A, x: a, y: b } : { who: B, x: b, y: a }; lines.push(`${v.who}: častěji upouštěl smyčku nebo vyfukoval masku (${v.x.vents}× vs. ${v.y.vents}×) – může souviset s vyvážením nebo stresem.`); level = Math.max(level, 1) as 0 | 1 | 2; }
    out.push(sec("breath", level, lines));
  }
  // ---- profil
  {
    const lines: string[] = []; let level: 0 | 1 | 2 = 0;
    if (Math.abs(a.avgDepth - b.avgDepth) >= 1) { lines.push(`Průměrná hloubka ${A} ${f1(a.avgDepth)} m, ${B} ${f1(b.avgDepth)} m.`); level = 1; }
    if (Math.abs(a.maxDepth - b.maxDepth) >= 3) { lines.push(`Max. hloubka ${A} ${f1(a.maxDepth)} m, ${B} ${f1(b.maxDepth)} m.`); level = 1; }
    if (Math.abs(a.durMin - b.durMin) >= 3) { lines.push(`Délka ponoru ${A} ${f1(a.durMin, 0)} min, ${B} ${f1(b.durMin, 0)} min.`); level = 1; }
    if (Math.abs(a.ascRate - b.ascRate) >= 1.5) { const f = a.ascRate > b.ascRate ? { who: A, x: a, y: b } : { who: B, x: b, y: a }; lines.push(`${f.who}: rychlejší výstup (${f1(f.x.ascRate)} vs. ${f1(f.y.ascRate)} m/min od nejhlubšího bodu).`); level = 1; }
    out.push(sec("profile", level, lines));
  }
  // ---- plyny
  out.push(sec("gas", a.dil !== b.dil ? 1 : 0, a.dil !== b.dil ? [`Jiný diluent (${A} ${a.dil}, ${B} ${b.dil}).`] : []));
  return sortSec(out);
}

/** Závěr pro 3 a více potápěčů po sekcích: v každé sekci jen ti, kdo se od průměru skupiny liší. */
function groupSections0(names: string[], st: DiveStats[]): Section[] {
  const n = st.length, avg = (f: (s: DiveStats) => number) => st.reduce((a, s) => a + f(s), 0) / n;
  const tts = avg((s) => s.ttsMax), decoAvg = avg((s) => s.decoMin), amb = avg((s) => s.ambInt), po2 = avg((s) => s.po2Int), inert = avg((s) => s.inert);
  const ups = st.map((s) => s.spUp?.t ?? null).filter((x): x is number => x != null);
  const upAvg = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
  const mk = (key: string, items: [number, string][], head?: string): Section => {
    const lv = items.reduce((m, [l]) => Math.max(m, l), 0) as 0 | 1 | 2;
    return sec(key, lv, [...(head ? [head] : []), ...items.map(([, t]) => t)]);
  };
  const deco: [number, string][] = [];
  st.forEach((s, i) => {
    const d = s.ttsMax - tts, dz = s.decoMin - decoAvg;
    if (d < 2 && dz < 2) return;
    const dIn = s.inert - inert, why: string[] = [];
    if (Math.abs(dIn) >= 10 && Math.abs(dIn) / (inert || 1) >= 0.05) {
      const dDepth = s.ambInt - amb, dPo2 = po2 - s.po2Int, tot = Math.abs(dDepth) + Math.abs(dPo2) || 1;
      if (dPo2 > 0 && dPo2 / tot >= 0.3) why.push(s.spUp && upAvg != null && s.spUp.t - upAvg >= 120 ? `pozdější přepnutí SP (${tpt(s.spUp.t)}, průměr ${tpt(upAvg)})` : !s.spUp ? "nepřepnutý vysoký SP" : `nižší pO₂ (${f1(s.po2All, 2)} bar)`);
      if (dDepth > 0 && dDepth / tot >= 0.3) { const w = Math.abs(s.avgDepth - avg((x) => x.avgDepth)) >= 0.3 ? `vyšší průměrná hloubka (${f1(s.avgDepth)} vs. ${f1(avg((x) => x.avgDepth))} m)` : Math.abs(s.durMin - avg((x) => x.durMin)) >= 2 ? `delší ponor (${f1(s.durMin, 0)} min)` : null; if (w) why.push(w); }
    } else if (s.po2Deco != null) { const pd = avg((x) => x.po2Deco ?? s.po2Deco!); if (pd - s.po2Deco >= 0.03) why.push(`nižší pO₂ během deko (${f1(s.po2Deco, 2)} bar)`); }
    deco.push([d >= 4 || dz >= 4 ? 2 : 1, `${names[i]}: ${d >= 2 ? `delší dekomprese (TTS ${s.ttsMax} min, průměr ${f1(tts)})` : `delší čas na zastávkách (${f1(s.decoMin, 0)} min, průměr ${f1(decoAvg, 0)})`}${why.length ? " – " + why.join(", ") : ""}.`]);
  });
  const gfs = new Set(st.map((s) => s.gf));
  if (gfs.size > 1) deco.push([1, `Různé GF: ${st.map((s, i) => `${names[i]} ${s.gf}`).join(", ")}.`]);
  const p2: [number, string][] = [];
  st.forEach((s, i) => {
    if (s.spUp && upAvg != null && s.spUp.t - upAvg >= 120) p2.push([s.spUp.t - upAvg >= 300 ? 2 : 1, `${names[i]}: později přepnutý vysoký SP (${tpt(s.spUp.t)}, průměr ${tpt(upAvg)}).`]);
    if (!s.spUp && ups.length) p2.push([2, `${names[i]}: vysoký SP nepřepnut.`]);
    if (s.offBelow - avg((x) => x.offBelow) >= 2) p2.push([2, `${names[i]}: nejdéle pod setpointem (${dur((s.offBelow) * 60)}).`]);
    if (s.offAbove - avg((x) => x.offAbove) >= 2) p2.push([1, `${names[i]}: nejdéle nad setpointem mimo deko (${dur((s.offAbove) * 60)}).`]);
    if (s.boostMin - avg((x) => x.boostMin) >= 2) p2.push([1, `${names[i]}: během deko pO₂ zvýšené (${f1(s.boostPo2, 2)} bar, ${f1(s.boostMin, 0)} min).`]);
  });
  st.forEach((s, i) => { if (s.cellIssue) p2.push([1, `${names[i]}: ${cellIssueText(s.cellIssue)} – hodnoty pO₂ ber s rezervou.`]); });
  const c2: [number, string][] = [];
  st.forEach((s, i) => { if (s.co2Bad) c2.push([1, `${names[i]}: CO₂ nelze porovnat – čidlo nejspíš podhodnocuje (oříznutá nula).`]); });
  st.forEach((s, i) => { if (!s.co2Bad && s.co2Max != null && st.every((x, j) => j === i || x.co2Bad || (x.co2Max ?? 0) + 1 <= s.co2Max!)) c2.push([s.co2Alarms > 0 || s.co2Max >= 5 ? 2 : 1, `${names[i]}: nejvyšší CO₂ (${f1(s.co2Max)} mbar, alarmy ${s.co2Alarms}×)${s.dens52 > avg((x) => x.dens52) + 3 ? ", déle dýchal hustou směs" : ""}${s.scrubLeftStart < avg((x) => x.scrubLeftStart) - 30 ? ", méně zbývajícího scrubberu" : ""}.`]); });
  const br: [number, string][] = [];
  st.forEach((s, i) => { if (s.vents - avg((x) => x.vents) >= 3) br.push([1, `${names[i]}: častěji upouštěl smyčku (${s.vents}×).`]); if (s.densMax - avg((x) => x.densMax) >= 0.3) br.push([s.densMax > 6.2 ? 2 : 1, `${names[i]}: hustší směs (max. ${f1(s.densMax)} g/l).`]); });
  const pr: [number, string][] = [];
  st.forEach((s, i) => { if (s.ascRate - avg((x) => x.ascRate) >= 1.5) pr.push([1, `${names[i]}: rychlejší výstup (${f1(s.ascRate)} m/min).`]); if (Math.abs(s.avgDepth - avg((x) => x.avgDepth)) >= 1) pr.push([1, `${names[i]}: průměrná hloubka ${f1(s.avgDepth)} m (skupina ${f1(avg((x) => x.avgDepth))} m).`]); });
  const dils = new Set(st.map((s) => s.dil));
  return sortSec([
    mk("deco", deco, `Max. TTS: ${st.map((s, i) => `${names[i]} ${s.ttsMax}`).join(", ")} min.`),
    mk("po2", p2), mk("co2", c2), mk("breath", br), mk("profile", pr),
    sec("gas", dils.size > 1 ? 1 : 0, dils.size > 1 ? [`Diluenty: ${st.map((s, i) => `${names[i]} ${s.dil}`).join(", ")}.`] : []),
  ]);
}

/** Zpětná kompatibilita: závěr skupiny jako seznam vět. */
export function groupConclusion(names: string[], st: DiveStats[]): string[] {
  const x = groupSections(names, st).flatMap((s) => s.lines);
  return x.length > 1 ? x : [...x, "Žádný potápěč se od skupiny výrazně neliší."];
}

/** Zpětná kompatibilita: závěr jako seznam vět. */
export function conclusion(A: string, B: string, a: DiveStats, b: DiveStats): string[] {
  return conclusionSections(A, B, a, b).flatMap((s) => s.lines);
}

/** Hodnoty obou ponorů na společné časové ose (s od začátku mého ponoru, krok 10 s). */
export function alignSeries(a: Dive, b: Dive, pick: (d: Dive) => (number | null)[]) {
  const off = b.h.start - a.h.start;
  const t0 = Math.min(0, off), t1 = Math.max(a.h.diveTimeS, off + b.h.diveTimeS);
  const t: number[] = []; for (let x = t0; x <= t1; x += 10) t.push(x);
  const at = (d: Dive, v: (number | null)[], tt: number) => {
    if (tt < 0 || tt > d.h.diveTimeS) return null;
    const i = d.s.t.findIndex((x) => x >= tt);
    return i < 0 ? null : v[i];
  };
  const va = pick(a), vb = pick(b);
  return { t, a: t.map((x) => at(a, va, x)), b: t.map((x) => at(b, vb, x - off)), off };
}

/** Posun podle profilu: skutečný rozdíl začátků (s), rozdíl hodin počítačů (s) a shoda profilů (RMSE v m). */
export function profileLag(a: Dive, b: Dive): { real: number; clock: number; rmse: number } {
  const clock = b.h.start - a.h.start;
  const sample = (d: Dive, step: number) => { const out: number[] = []; let j = 0; for (let t = 0; t <= d.h.diveTimeS; t += step) { while (j + 1 < d.s.t.length && d.s.t[j] < t) j++; out.push(d.s.depth[j]); } return out; };
  const STEP = 10, A = sample(a, STEP), B = sample(b, STEP);
  let best = 0, bestE = Infinity;
  // jen prvních 10 minut (potápěči začínají společně) a jen překryv – kratší ponor buddyho zarovnání nezkreslí
  const WIN = 600 / STEP;
  for (let lag = -1500; lag <= 1500; lag += STEP) {
    // b posunuté tak, že jeho začátek je v čase lag (s) od začátku a
    const k0 = lag / STEP; let e = 0, n = 0;
    for (let i = 0; i < Math.min(A.length, WIN); i++) { const j = i - k0; if (j < 0 || j >= B.length) continue; e += (A[i] - B[j]) ** 2; n++; }
    if (n < WIN * 0.8) continue;
    e /= n; if (e < bestE) { bestE = e; best = lag; }
  }
  return { real: best, clock, rmse: Math.sqrt(bestE) };
}

/** Krátký popis problému s O₂ čidly (jen nad prahem SPREAD_MIN; podprahové výkyvy se nehlásí). */
export function cellIssueText(k: CellIssue): string {
  return k === "wet" ? "podezření na vlhkost na čidlech" : k === "multi" ? "podezření na vadná čidla" : k ? `podezření na nefunkční čidlo ${k.slice(1)}` : "";
}

/**
 * Srovnání dvou počítačů na stejném ponoru (záložní / hlavní): rozdíly, které ukazují na závadu.
 * off = posun b vůči a (s) po zarovnání profilem.
 */
export function computerDiff(a: Dive, b: Dive, off: number, clockS: number): { level: "ok" | "warn"; text: string }[] {
  const at = (d: Dive, v: (number | null)[], t: number) => { if (t < 0 || t > d.h.diveTimeS) return null; const i = d.s.t.findIndex((x) => x >= t); return i < 0 ? null : v[i]; };
  const pairs = (va: (d: Dive) => (number | null)[]) => { const out: [number, number][] = []; for (let t = 0; t <= a.h.diveTimeS; t += 10) { const x = at(a, va(a), t), y = at(b, va(b), t - off); if (x != null && y != null) out.push([x, y]); } return out; };
  const stat = (p: [number, number][]) => { if (!p.length) return null; const d = p.map(([x, y]) => y - x); const mean = d.reduce((s, v) => s + v, 0) / d.length; const max = Math.max(...d.map(Math.abs)); return { mean, max }; };
  const nf = (v: number, k = 1) => v.toLocaleString("cs-CZ", { maximumFractionDigits: k });
  const out: { level: "ok" | "warn"; text: string }[] = [];
  const dep = stat(pairs((d) => d.s.depth).filter(([x]) => x > 1.5));
  if (dep) out.push(Math.abs(dep.mean) > 0.5 ? { level: "warn", text: `Hloubka: druhý počítač ukazuje v průměru o ${nf(Math.abs(dep.mean))} m ${dep.mean > 0 ? "víc" : "míň"} (max. rozdíl ${nf(dep.max)} m) – možná odchylka tlakového čidla.` } : { level: "ok", text: `Hloubka sedí (průměrný rozdíl ${nf(Math.abs(dep.mean), 2)} m).` });
  const po2 = stat(pairs((d) => d.s.ppo2));
  if (po2) out.push(Math.abs(po2.mean) > 0.05 ? { level: "warn", text: `pO₂: rozdíl v průměru ${nf(po2.mean, 2)} bar (max. ${nf(po2.max, 2)}) – jiná kalibrace nebo zapojení čidel.` } : { level: "ok", text: `pO₂ sedí (průměrný rozdíl ${nf(Math.abs(po2.mean), 2)} bar).` });
  for (const k of [1, 2, 3] as const) {
    const key = ("mv" + k) as "mv1" | "mv2" | "mv3";
    const mv = stat(pairs((d) => d.s[key]).filter(([x, y]) => x > 0 && y > 0));
    if (mv && Math.abs(mv.mean) > 2) out.push({ level: "warn", text: `Čidlo ${k}: rozdíl ${nf(mv.mean)} mV – u stejné hlavy ukazuje na komunikaci nebo připojení.` });
  }
  const tmp = stat(pairs((d) => d.s.temp));
  if (tmp) out.push(Math.abs(tmp.mean) > 1.5 ? { level: "warn", text: `Teplota: rozdíl ${nf(tmp.mean)} °C – jiné umístění počítače nebo čidlo teploty.` } : { level: "ok", text: `Teplota sedí (rozdíl ${nf(Math.abs(tmp.mean))} °C).` });
  const da = Math.max(0, ...a.s.stopt.map((v, i) => (a.s.stop[i] > 0 ? v : 0))), db = Math.max(0, ...b.s.stopt.map((v, i) => (b.s.stop[i] > 0 ? v : 0)));
  const ga = `${a.h.gfLo}/${a.h.gfHi}`, gb = `${b.h.gfLo}/${b.h.gfHi}`;
  if (ga !== gb) out.push({ level: "ok", text: `Deko: různé GF (${ga} vs ${gb}) – rozdíl deko je očekávaný.` });
  else if (Math.abs(da - db) > 3) out.push({ level: "warn", text: `Deko: při stejném GF ${ga} se nejdelší zastávka liší o ${Math.abs(da - db)} min – jiný výpočet nebo vstupní data (plyny, setpoint).` });
  out.push(Math.abs(clockS) > 120 ? { level: "warn", text: `Hodiny se rozcházejí o ${Math.round(Math.abs(clockS) / 60)} min.` } : { level: "ok", text: `Hodiny sedí (rozdíl ${Math.round(Math.abs(clockS))} s).` });
  return out;
}

/** Sekce závěru jen pro to, co mají všechny porovnávané ponory (bez čidel O₂ / bez dekomprese se vynechají). */
const capFilter = (st: DiveStats[], xs: Section[]) => xs.filter((x) => !((x.key === "po2" || x.key === "breath") && st.some((y) => !y.cc)) && !(x.key === "deco" && st.some((y) => !y.deco)));
export function conclusionSections(A: string, B: string, a: DiveStats, b: DiveStats, deeper?: { from: number; to: number; diff: number } | null): Section[] {
  return capFilter([a, b], conclusionSections0(A, B, a, b, deeper));
}
export function groupSections(names: string[], st: DiveStats[]): Section[] {
  return capFilter(st, groupSections0(names, st));
}
