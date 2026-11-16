// Porovnání dvou současných ponorů (můj vs. buddyho): metriky, rozdíly a stručný závěr z dat.
import type { Dive } from "./shearwater";
import { atStop, setpointChanges, o2Doses, summarize, type SpChange } from "./analysis";
import { effortOf } from "./effort";

const amb = (d: Dive, i: number) => (d.h.surfP || 1013) / 1000 + d.s.depth[i] * ((d.h.salinity || 1000) / 1000) * 0.0981;
const inDive = (d: Dive, i: number) => d.s.t[i] <= d.h.diveTimeS;

export interface DiveStats {
  maxDepth: number; avgDepth: number; durMin: number; t20: number; t30: number; descRate: number; ascRate: number; vMove: number;
  spUp: SpChange | null; spUpVal: number | null; sp019: SpChange | null; spN: number;
  po2All: number; po2Bottom: number; po2Deco: number | null; spErr: number; offMin: number;
  gf: string; ttsMax: number; ceilMax: number; decoMin: number; cnsEnd: number;
  co2Max: number | null; co2Avg: number | null; co2Alarms: number; scrubLeftStart: number;
  dil: string; dosesMan: number; dosesSol: number; tempMin: number; btnN: number;
  inert: number; ambInt: number; po2Int: number; // bar·min
  densMax: number; dens52: number; vents: number;
}

/** Metriky ponoru pro porovnání. Časově vážené průměry přes úseky ponoru (hloubka > 1,5 m). */
export function diveStats(d: Dive): DiveStats {
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
  const co2 = s.co2.filter((x): x is number => x != null);
  const ef = effortOf(d);
  return {
    maxDepth: d.h.maxDepth, avgDepth: sum.avgDepth, durMin: d.h.diveTimeS / 60, t20: t20 / 60, t30: t30 / 60,
    descRate: tMax ? d.h.maxDepth / (tMax / 60) : 0, ascRate: tEnd > tMax ? d.h.maxDepth / ((tEnd - tMax) / 60) : 0, vMove: w ? mv / (w / 60) : 0,
    spUp: up, spUpVal: up?.to ?? null, sp019: sp.find((c) => c.to < 0.3 && c.t > 60) || null, spN: sp.length,
    po2All: w ? po2 / w : 0, po2Bottom: wb ? po2b / wb : 0, po2Deco: wd >= 60 ? po2d / wd : null, spErr: w ? err / w : 0, offMin: off / 60,
    gf: `${d.h.gfLo}/${d.h.gfHi}`, ttsMax: Math.max(...s.tts), ceilMax: Math.max(...s.ceil), decoMin: s.t.filter((_, i) => inDive(d, i) && atStop(d, i)).length * (d.h.rateS || 5) / 60, cnsEnd: d.h.cnsEnd,
    co2Max: sum.co2Max, co2Avg: co2.length && sum.co2Max != null ? co2.reduce((a, b) => a + b, 0) / co2.length : null, co2Alarms: d.alarms.filter((a) => a.kind === "co2").length,
    scrubLeftStart: d.h.scrubLeftStartMin, dil: sum.dilUsed.split(",")[0] || "", dosesMan: doses.filter((x) => x.kind === "man").length, dosesSol: doses.filter((x) => x.kind === "sol").length,
    tempMin: sum.tempMin, btnN: sum.btnN,
    inert: ambI - po2I, ambInt: ambI, po2Int: po2I,
    densMax: ef.densMax, dens52: ef.densOver52, vents: ef.vents,
  };
}

export interface DiffRow { key: string; label: string; a: string; b: string; weight: number }
const f1 = (v: number | null | undefined, d = 1) => (v == null ? "–" : v.toLocaleString("cs-CZ", { maximumFractionDigits: d, minimumFractionDigits: d > 1 ? d : 0 }));
const spTxt = (c: SpChange | null) => (c ? `${Math.round(c.t / 60)}. min, ${f1(c.depth)} m` : "nepřepnuto");

/** Tabulka rozdílů seřazená podle relativní velikosti rozdílu. */
export function diffRows(a: DiveStats, b: DiveStats): DiffRow[] {
  const rel = (x: number, y: number, scale: number) => Math.min(3, Math.abs(x - y) / scale);
  const rows: DiffRow[] = [
    { key: "tts", label: "Max. zbývající deko (TTS)", a: `${a.ttsMax} min`, b: `${b.ttsMax} min`, weight: rel(a.ttsMax, b.ttsMax, 3) * 1.5 },
    { key: "deco", label: "Na zastávkách", a: `${f1(a.decoMin, 0)} min`, b: `${f1(b.decoMin, 0)} min`, weight: rel(a.decoMin, b.decoMin, 2) },
    { key: "spUp", label: "Přepnutí na vysoký SP", a: spTxt(a.spUp), b: spTxt(b.spUp), weight: (a.spUp && b.spUp ? rel(a.spUp.t / 60, b.spUp.t / 60, 3) : a.spUp || b.spUp ? 3 : 0) * 1.3 },
    { key: "spVal", label: "Vysoký setpoint", a: f1(a.spUpVal, 2), b: f1(b.spUpVal, 2), weight: rel(a.spUpVal ?? 0, b.spUpVal ?? 0, 0.05) },
    { key: "inert", label: "Inertní zátěž ∫(P − pO₂)", a: `${f1(a.inert, 0)} bar·min`, b: `${f1(b.inert, 0)} bar·min`, weight: rel(a.inert, b.inert, Math.max(5, (a.inert + b.inert) * 0.03)) },
    { key: "avg", label: "Průměrná hloubka", a: `${f1(a.avgDepth)} m`, b: `${f1(b.avgDepth)} m`, weight: rel(a.avgDepth, b.avgDepth, 1) },
    { key: "max", label: "Max. hloubka", a: `${f1(a.maxDepth)} m`, b: `${f1(b.maxDepth)} m`, weight: rel(a.maxDepth, b.maxDepth, 2) },
    { key: "t20", label: "Čas pod 20 m", a: `${f1(a.t20, 0)} min`, b: `${f1(b.t20, 0)} min`, weight: rel(a.t20, b.t20, 3) },
    { key: "dur", label: "Délka ponoru", a: `${f1(a.durMin, 0)} min`, b: `${f1(b.durMin, 0)} min`, weight: rel(a.durMin, b.durMin, 3) },
    { key: "po2", label: "Průměrné pO₂", a: `${f1(a.po2All, 2)} bar`, b: `${f1(b.po2All, 2)} bar`, weight: rel(a.po2All, b.po2All, 0.05) },
    { key: "po2b", label: "pO₂ na dně", a: `${f1(a.po2Bottom, 2)} bar`, b: `${f1(b.po2Bottom, 2)} bar`, weight: rel(a.po2Bottom, b.po2Bottom, 0.05) },
    { key: "po2d", label: "pO₂ během deko", a: a.po2Deco != null ? `${f1(a.po2Deco, 2)} bar` : "–", b: b.po2Deco != null ? `${f1(b.po2Deco, 2)} bar` : "–", weight: a.po2Deco != null && b.po2Deco != null ? rel(a.po2Deco, b.po2Deco, 0.05) : 0 },
    { key: "off", label: "Mimo setpoint o > 0,1 bar", a: `${f1(a.offMin, 0)} min`, b: `${f1(b.offMin, 0)} min`, weight: rel(a.offMin, b.offMin, 5) },
    { key: "gf", label: "GF", a: a.gf, b: b.gf, weight: a.gf !== b.gf ? 2.5 : 0 },
    { key: "co2", label: "Max. CO₂", a: a.co2Max != null ? `${f1(a.co2Max)} mbar` : "–", b: b.co2Max != null ? `${f1(b.co2Max)} mbar` : "–", weight: rel(a.co2Max ?? 0, b.co2Max ?? 0, 1) },
    { key: "co2al", label: "Alarmy CO₂", a: `${a.co2Alarms}×`, b: `${b.co2Alarms}×`, weight: rel(a.co2Alarms, b.co2Alarms, 1) },
    { key: "scrub", label: "Scrubber na začátku", a: `${a.scrubLeftStart} min`, b: `${b.scrubLeftStart} min`, weight: rel(a.scrubLeftStart, b.scrubLeftStart, 60) * 0.5 },
    { key: "man", label: "Ruční dávky O₂", a: `${a.dosesMan}×`, b: `${b.dosesMan}×`, weight: rel(a.dosesMan, b.dosesMan, 3) * 0.6 },
    { key: "sol", label: "Solenoid (odhad)", a: `${a.dosesSol}×`, b: `${b.dosesSol}×`, weight: rel(a.dosesSol, b.dosesSol, 5) * 0.4 },
    { key: "asc", label: "Rychlost výstupu", a: `${f1(a.ascRate)} m/min`, b: `${f1(b.ascRate)} m/min`, weight: rel(a.ascRate, b.ascRate, 1) * 0.6 },
    { key: "move", label: "Pohyb ve vertikále", a: `${f1(a.vMove)} m/min`, b: `${f1(b.vMove)} m/min`, weight: rel(a.vMove, b.vMove, 0.5) * 0.5 },
    { key: "cns", label: "CNS na konci", a: `${a.cnsEnd} %`, b: `${b.cnsEnd} %`, weight: rel(a.cnsEnd, b.cnsEnd, 5) * 0.5 },
    { key: "dil", label: "Diluent", a: a.dil, b: b.dil, weight: a.dil !== b.dil ? 2 : 0 },
    { key: "dens", label: "Hustota plynu max", a: `${f1(a.densMax)} g/l`, b: `${f1(b.densMax)} g/l`, weight: rel(a.densMax, b.densMax, 0.5) * 0.8 },
    { key: "dens52", label: "Nad 5,2 g/l", a: `${f1(a.dens52, 0)} min`, b: `${f1(b.dens52, 0)} min`, weight: rel(a.dens52, b.dens52, 5) * 0.6 },
    { key: "vents", label: "Upouštění smyčky", a: `${a.vents}×`, b: `${b.vents}×`, weight: rel(a.vents, b.vents, 3) * 0.5 },
    { key: "temp", label: "Min. teplota", a: `${a.tempMin} °C`, b: `${b.tempMin} °C`, weight: rel(a.tempMin, b.tempMin, 2) * 0.3 },
    { key: "btn", label: "Stisky tlačítek", a: `${a.btnN}`, b: `${b.btnN}`, weight: rel(a.btnN, b.btnN, 10) * 0.2 },
  ];
  return rows.sort((x, y) => y.weight - x.weight);
}

/**
 * Stručný závěr: hlavně rozklad rozdílu v inertní zátěži (ta určuje dekompresi) na podíl hloubky a podíl pO₂,
 * vliv GF a další odlišnosti (pO₂ během deko, CO₂ a jeho souvislosti, přesnost řízení).
 */
export function conclusion(A: string, B: string, a: DiveStats, b: DiveStats): string[] {
  const out: string[] = [];
  const longer = a.ttsMax > b.ttsMax ? { who: A, x: a, y: b } : { who: B, x: b, y: a };
  const dTts = Math.abs(a.ttsMax - b.ttsMax), dDeco = Math.abs(a.decoMin - b.decoMin);
  const dIn = longer.x.inert - longer.y.inert;
  if (dTts >= 2 || dDeco >= 2) {
    let s = `U potápěče ${longer.who} byla dekomprese delší (max. TTS ${longer.x.ttsMax} vs. ${longer.y.ttsMax} min, na zastávkách ${f1(longer.x.decoMin, 0)} vs. ${f1(longer.y.decoMin, 0)} min).`;
    if (longer.x.gf !== longer.y.gf) s += ` Měl jiné GF (${longer.x.gf} vs. ${longer.y.gf}), což samo o sobě mění povinnost i při stejném profilu.`;
    if (dIn > 1) {
      const depthPart = longer.x.ambInt - longer.y.ambInt, po2Part = longer.y.po2Int - longer.x.po2Int;
      const tot = Math.abs(depthPart) + Math.abs(po2Part) || 1;
      const parts: [number, string][] = [];
      if (po2Part > 0) {
        const why = longer.x.spUp && longer.y.spUp && longer.x.spUp.t - longer.y.spUp.t >= 120
          ? `pozdější přepnutí na vysoký setpoint (${Math.round(longer.x.spUp.t / 60)}. vs. ${Math.round(longer.y.spUp.t / 60)}. min)`
          : !longer.x.spUp && longer.y.spUp ? "nepřepnutí na vysoký setpoint"
          : (longer.x.spUpVal ?? 0) < (longer.y.spUpVal ?? 0) ? `nižší vysoký setpoint (${f1(longer.x.spUpVal, 2)} vs. ${f1(longer.y.spUpVal, 2)})`
          : `nižší průměrné pO₂ (${f1(longer.x.po2All, 2)} vs. ${f1(longer.y.po2All, 2)} bar)`;
        parts.push([po2Part / tot, why]);
      }
      if (depthPart > 0) parts.push([depthPart / tot, longer.x.avgDepth > longer.y.avgDepth + 0.3 ? `vyšší průměrná hloubka – držel se níž (${f1(longer.x.avgDepth)} vs. ${f1(longer.y.avgDepth)} m)` : `delší pobyt v hloubce (${f1(longer.x.t20, 0)} vs. ${f1(longer.y.t20, 0)} min pod 20 m)`]);
      parts.sort((p, q) => q[0] - p[0]);
      if (parts.length) s += ` Inertní zátěž měl vyšší o ${f1(dIn, 0)} bar·min: ` + parts.map(([w, t], i) => `${i === 0 ? "" : "zbytek "}${i === 0 ? `zhruba ${Math.round(w * 100)} % vysvětluje ` : ""}${t}`).join(", ") + ".";
    }
    out.push(s);
  } else out.push(`Dekompresní povinnost byla podobná (max. TTS ${a.ttsMax} vs. ${b.ttsMax} min).`);
  if (a.po2Deco != null && b.po2Deco != null && Math.abs(a.po2Deco - b.po2Deco) >= 0.05) {
    const lo = a.po2Deco < b.po2Deco ? { who: A, x: a, y: b } : { who: B, x: b, y: a };
    out.push(`${lo.who} měl během deko nižší pO₂ (${f1(lo.x.po2Deco, 2)} vs. ${f1(lo.y.po2Deco, 2)} bar), což zastávky prodlužuje.`);
  }
  if (a.co2Max != null && b.co2Max != null && (Math.abs(a.co2Max - b.co2Max) >= 1 || a.co2Alarms !== b.co2Alarms)) {
    const hi = a.co2Max > b.co2Max ? { who: A, x: a, y: b } : { who: B, x: b, y: a };
    const why: string[] = [];
    if (hi.x.scrubLeftStart < hi.y.scrubLeftStart - 30) why.push(`méně zbývajícího scrubberu na začátku (${hi.x.scrubLeftStart} vs. ${hi.y.scrubLeftStart} min)`);
    if (hi.x.vMove > hi.y.vMove * 1.2) why.push(`víc pohybu ve vertikále (${f1(hi.x.vMove)} vs. ${f1(hi.y.vMove)} m/min) – nejspíš vyšší zátěž`);
    if (hi.x.dens52 > hi.y.dens52 + 3) why.push(`delší dýchání husté směsi nad 5,2 g/l (${f1(hi.x.dens52, 0)} vs. ${f1(hi.y.dens52, 0)} min) – vyšší dechová práce`);
    if (hi.x.tempMin < hi.y.tempMin - 1) why.push(`nižší teplota (${hi.x.tempMin} vs. ${hi.y.tempMin} °C)`);
    out.push(`${hi.who} měl vyšší CO₂ (max. ${f1(hi.x.co2Max)} vs. ${f1(hi.y.co2Max)} mbar, alarmy ${hi.x.co2Alarms}× vs. ${hi.y.co2Alarms}×)` + (why.length ? `; souvisí nejspíš s: ${why.join(", ")}.` : "; z profilu ani scrubberu jasná příčina neplyne – zkontroluj sorbent a smyčku."));
  }
  if (Math.abs(a.offMin - b.offMin) >= 5) {
    const w = a.offMin > b.offMin ? { who: A, x: a, y: b } : { who: B, x: b, y: a };
    out.push(`${w.who} byl déle mimo setpoint o víc než 0,1 bar (${f1(w.x.offMin, 0)} vs. ${f1(w.y.offMin, 0)} min)` + (w.x.dosesMan > w.y.dosesMan + 3 ? ` a častěji dávkoval O₂ ručně (${w.x.dosesMan}× vs. ${w.y.dosesMan}×).` : "."));
  }
  if (Math.abs(a.ascRate - b.ascRate) >= 1.5) {
    const f = a.ascRate > b.ascRate ? { who: A, x: a, y: b } : { who: B, x: b, y: a };
    out.push(`${f.who} vystupoval rychleji (průměrně ${f1(f.x.ascRate)} vs. ${f1(f.y.ascRate)} m/min od nejhlubšího bodu).`);
  }
  if (Math.abs(a.vents - b.vents) >= 4) {
    const v = a.vents > b.vents ? { who: A, x: a, y: b } : { who: B, x: b, y: a };
    out.push(`${v.who} častěji upouštěl smyčku nebo vyfukoval masku (${v.x.vents}× vs. ${v.y.vents}×) – může souviset s vyvážením nebo stresem.`);
  }
  if (a.dil !== b.dil) out.push(`Diluent se lišil (${a.dil} vs. ${b.dil}).`);
  return out;
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
