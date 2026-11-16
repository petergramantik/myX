// Odvozené hodnoty: souhrn ponoru, kalibrace čidel, odhad vstřiků solenoidu, upozornění.
import { dilVents, effortOf, gasDensity } from "./effort";
import type { Dive, Header } from "./shearwater";

export interface Summary {
  avgDepth: number; tempMin: number; tempMax: number; ppo2Min: number; ppo2Max: number; co2Max: number | null; co2Avg: number | null; co2AlarmN: number; co2AlarmS: number; gases: { mix: string; s: number }[]; dilUse: GasUse; o2Use: GasUse; pn2Max: number;
  btnN: number; menuN: number; offMainS: number;
  densMax: number; vents: number;
  sp: SpChange[]; dose: { sol: number; man: number; amb: number; dil: number; manPreSw: number };
  ceilMax: number; ttsMax: number; gf99End: number | null; descMax: number; ascMax: number;
  batVMin: number; decoMin: number; decoModeMin: number; dilStart: number | null; dilEnd: number | null; o2Start: number | null; o2End: number | null; dilUsed: string;
}

const inDive = (d: Dive, i: number) => d.s.t[i] <= d.h.diveTimeS;

/** Spotřeba z vlastní lahve odvozená z průběhu tlaku. */
export interface GasUse {
  ok: boolean;            // tlak lahve je k dispozici (ne jen mezitlak)
  start: number | null; end: number | null;
  bar: number;            // součet poklesů (bez úseků s externím plynem nebo zavřenou lahví)
  ext: [number, number][]; // úseky (min), kdy byl nejspíš připojený externí plyn nebo lahev zavřená
  noisy: boolean;         // průběh je příliš rozkmitaný, spotřeba je jen odhad
}
const MIN_BAR = 20, HYST = 2, EXT_RISE = 10;
/**
 * Spotřeba = součet poklesů vyhlazeného tlaku (s hysterezí), ne rozdíl start/end.
 * Hodnoty pod 20 bar jsou mezitlak (lahev zavřená / externí plyn) a nepočítají se.
 * Nárůst tlaku nebo pád na mezitlak během ponoru = nejspíš externí plyn.
 */
export function pressureUse(t: number[], p: (number | null)[], depth: number[], diveS: number): GasUse {
  const idx = t.map((_, i) => i).filter((i) => t[i] <= diveS && p[i] != null);
  const raw = idx.map((i) => p[i]!);
  const valid = raw.filter((v) => v >= MIN_BAR);
  if (valid.length < Math.max(5, raw.length * 0.2)) return { ok: false, start: raw[0] ?? null, end: raw[raw.length - 1] ?? null, bar: 0, ext: [], noisy: false };
  // medián z 7 vzorků (~35 s) potlačí šum převodníku
  const sm = idx.map((_, k) => {
    if (raw[k] < MIN_BAR) return null;
    const w = raw.slice(Math.max(0, k - 3), k + 4).filter((v) => v >= MIN_BAR).sort((a, b) => a - b);
    return w[w.length >> 1];
  });
  // malé nárůsty (do 10 bar) = ohřátí lahve, odečtou se; větší nárůst = doplnění z externího zdroje
  let ref: number | null = null, bar = 0, rise = 0, wiggle = 0;
  const extIdx: number[] = [];
  sm.forEach((v, k) => {
    if (v == null) { extIdx.push(k); return; }
    if (ref == null) { ref = v; return; }
    if (v < ref - HYST) { bar += ref - v; wiggle += ref - v; ref = v; }
    else if (v > ref + HYST) {
      if (v - ref >= EXT_RISE) { rise += v - ref; extIdx.push(k); } else { bar -= v - ref; wiggle += v - ref; }
      ref = v;
    }
  });
  const ext: [number, number][] = [];
  for (const k of extIdx) {
    const m = t[idx[k]] / 60;
    const last = ext[ext.length - 1];
    if (last && m - last[1] <= 2) last[1] = m; else ext.push([m, m]);
  }
  const firstV = sm.find((v) => v != null) ?? null, lastV = [...sm].reverse().find((v) => v != null) ?? null;
  const net = Math.max(0, bar);
  return { ok: true, start: firstV, end: lastV, bar: Math.round(net), ext: ext.map(([a, b]) => [Math.round(a), Math.round(b)]), noisy: rise + wiggle > Math.max(60, net * 4) };
}

// ---------- ovládání počítače (záznamy 0x51)
export const SCR_MAIN = 0xb3, SCR_MENU = 0x06;
const SCR_NAMES: Record<number, string> = { 0xb3: "hlavní obrazovka", 0x155: "info 1", 0x156: "info 2", 0x06: "menu", 0xa4: "po vynoření" };
export const scrName = (c: number) => SCR_NAMES[c] ?? `obrazovka 0x${c.toString(16)}`;
export const BTN_NAMES: Record<number, string> = { 1: "pravé tlačítko", 2: "levé tlačítko", 4: "návrat" };
/** Čas strávený mimo hlavní obrazovku během ponoru (s). */
function offMain(d: Dive): number {
  let off = 0, since: number | null = null;
  for (const b of d.buttons) {
    if (b.t < 0 || b.t > d.h.diveTimeS) continue;
    if (b.from === SCR_MAIN && b.to !== SCR_MAIN && since == null) since = b.t;
    if (b.to === SCR_MAIN && since != null) { off += b.t - since; since = null; }
  }
  return off;
}
/** Potvrzení první položky menu (levé → menu, pravé → zpět na hlavní) = ruční přepnutí setpointu na Petrelu. */
export function menuSelects(d: Dive): number[] {
  const b = d.buttons, out: number[] = [];
  b.forEach((x, i) => {
    if (x.btn === 1 && x.from === SCR_MENU && x.to === SCR_MAIN && b.slice(Math.max(0, i - 3), i).some((y) => y.btn === 2 && y.from === SCR_MAIN && y.to === SCR_MENU && x.t - y.t < 15)) out.push(x.t);
  });
  return out;
}

// ---------- setpoint
export interface SpChange { t: number; from: number; to: number; depth: number; manual: boolean }
/** Přepnutí setpointu ze vzorků; „ručně“, pokud mu 0–25 s předcházelo potvrzení v menu Petrelu. */
export function setpointChanges(d: Dive): SpChange[] {
  const s = d.s, sel = menuSelects(d), out: SpChange[] = [];
  for (let j = 1; j < s.sp.length; j++) {
    if (s.sp[j] === s.sp[j - 1] || s.t[j] > d.h.diveTimeS) continue;
    out.push({ t: s.t[j], from: s.sp[j - 1], to: s.sp[j], depth: s.depth[j], manual: sel.some((x) => s.t[j] - x >= -5 && s.t[j] - x <= 25) });
  }
  return out;
}
/** Parametry hodnocení setpointu: hranice pozdního přepnutí (min), oscilace dna (m), výraznější klesání (m). */
export interface SpRules { lateMin: number; osc: number; descM: number; stableS: number }
export const SP_RULES: SpRules = { lateMin: 5, osc: 3, descM: 6, stableS: 180 };

/**
 * Začátek „dna“, na kterém byl vysoký setpoint přepnut: jde se zpět od přepnutí, dokud hloubka nezačne
 * být o víc než `osc` mělčí než nejhlubší místo úseku (tj. dokud nejsme v klesání).
 */
function plateauStart(d: Dive, j: number, osc: number): number {
  const s = d.s;
  let mx = s.depth[j], k = j;
  while (k > 0 && s.depth[k - 1] >= mx - osc) { k--; mx = Math.max(mx, s.depth[k]); }
  return k;
}

export function spWarnings(d: Dive, sum: Pick<Summary, "sp">, r: SpRules = SP_RULES): Alert[] {
  const out: Alert[] = [];
  const s = d.s, n = s.t.length;
  const fmt = (v: number) => v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
  const down = s.t.find((_, i) => s.depth[i] >= 1.5) ?? 0;
  const startHigh = s.sp[Math.max(0, s.t.findIndex((t) => t >= down))] >= 1.0;
  const ups = sum.sp.filter((c) => c.to >= 1.0 && c.from < 1.0);
  // pozdní přepnutí: měřeno od dosažení dna (hloubka se pak ≥ stableS nezvýší o víc než osc)
  for (const [k, c] of ups.entries()) {
    const j = s.t.findIndex((t) => t >= c.t);
    if (j < 0) continue;
    const p = plateauStart(d, j, r.osc);
    const delay = (c.t - s.t[p]) / 60;
    const txt = `Setpoint ${fmt(c.to)} nastaven v ${Math.round(c.t / 60)}. min v ${fmt(c.depth)} m, ${fmt(Math.round(delay * 10) / 10)} min po dosažení dna (${fmt(s.depth[p])} m)${c.manual ? ", ručně v menu Petrelu" : ""}.`;
    if (delay > r.lateMin && s.depth[p] >= 10) out.push({ level: "warn", title: "Pozdní přepnutí na vysoký setpoint", text: txt });
    else if (k === 0) out.push({ level: "info", title: "Přepnutí setpointu", text: txt });
  }
  if (!startHigh && !ups.length && d.h.maxDepth > 10) {
    // bez přepnutí: varovat jen pokud se potápěč na dně ≥ lateMin zdržel
    let longest = 0;
    for (let i = 0; i < n; i++) { if (s.depth[i] < 10) continue; const p = plateauStart(d, i, r.osc); longest = Math.max(longest, s.t[i] - s.t[p]); }
    if (longest > r.lateMin * 60) out.push({ level: "warn", title: "Vysoký setpoint nenastaven", text: `Během ponoru nebyl setpoint přepnut na vysoký (≥ 1,0), i když byl potápěč na dně ${Math.round(longest / 60)} min.` });
  }
  // klesání s vysokým setpointem: o víc než descM od nejmělčího místa
  let minI = -1, peakI = -1, warned = false;
  for (let i = 0; i < n; i++) {
    if (s.t[i] > d.h.diveTimeS) break;
    if (s.sp[i] < 1.0) { minI = -1; warned = false; continue; }
    if (minI < 0 || s.depth[i] < s.depth[minI]) { minI = i; peakI = i; warned = false; }
    if (s.depth[i] > s.depth[peakI]) peakI = i;
    const end = s.depth[i] < s.depth[peakI] - r.osc || i === n - 1 || s.sp[i + 1] < 1.0;
    if (!warned && s.depth[peakI] - s.depth[minI] > r.descM && end) {
      const po2 = Math.max(...s.ppo2.slice(minI, peakI + 1));
      out.push({ level: "warn", title: "Klesání s vysokým setpointem", text: `V ${Math.round(s.t[minI] / 60)}.–${Math.round(s.t[peakI] / 60)}. min klesání z ${fmt(s.depth[minI])} na ${fmt(s.depth[peakI])} m se setpointem ${fmt(s.sp[minI])} – před klesáním nebylo přepnuto na nízký. Nejvyšší pO₂ během klesání ${fmt(po2)} bar.` });
      warned = true;
    }
    if (end && s.depth[i] < s.depth[peakI] - r.osc) { minI = i; peakI = i; warned = false; } // nové klesání se počítá od tohoto místa
  }
  for (const c of sum.sp.filter((c) => c.to < 0.3)) {
    const endPhase = c.depth <= 6 && c.t >= d.h.diveTimeS - 600;
    if (!endPhase) out.push({ level: "warn", title: `Setpoint ${fmt(c.to)} mimo závěr ponoru`, text: `Přepnuto v ${Math.round(c.t / 60)}. min v ${fmt(c.depth)} m – nízký setpoint pod 6 m nebo dřív než v posledních 10 min.` });
  }
  return out;
}

// ---------- dávkování O₂
export type DoseKind = "sol" | "man" | "amb" | "dil";
export interface Dose { t: number; rise: number; depth: number; kind: DoseKind; preSw: boolean }
/**
 * Nárůsty podílu O₂ ve smyčce. Solenoid dávkuje jen pod setpointem, takže nárůst nad setpointem je ruční;
 * diluent ale podíl O₂ zvedne nejvýš na svůj obsah O₂ – nad ním je to jistě O₂, pod ním nejisté.
 */
export function o2Doses(d: Dive): Dose[] {
  const s = d.s, n = s.t.length, out: Dose[] = [];
  const P = s.depth.map((x) => d.h.surfP / 1000 + x * 0.0981);
  const f = s.ppo2.map((v, i) => v / P[i]);
  const ups = setpointChanges(d).filter((c) => c.to > c.from).map((c) => c.t);
  let i = 1;
  while (i < n - 3) {
    if (s.depth[i] < 1.5 || !inDive(d, i)) { i++; continue; }
    let best = 1;
    for (let k = 2; k <= 3; k++) if (f[i + k] - f[i] > f[i + best] - f[i]) best = k;
    const rise = (f[i + best] - f[i]) * P[i];
    if (rise >= 0.03 && f[i] <= f[i - 1] + 1e-9) {
      const dils = s.dil.slice(Math.max(0, i - 2), i + best + 3).filter((x): x is number => x != null && x >= 20);
      const dilDrop = dils.length > 1 ? dils[0] - Math.min(...dils) : 0;
      const above = s.ppo2[i] > s.sp[i] + 0.05;
      const kind: DoseKind = dilDrop >= 2 ? "dil" : !above ? "sol" : f[i + best] > s.o2[i] / 100 + 0.01 ? "man" : "amb";
      out.push({ t: s.t[i], rise: round(rise, 2), depth: s.depth[i], kind, preSw: kind !== "sol" && ups.some((u) => u - s.t[i] >= 0 && u - s.t[i] <= 300) });
      i += best + 1;
    } else i++;
  }
  return out;
}
function doseSummary(d: Dive) {
  const x = o2Doses(d);
  const c = (k: DoseKind) => x.filter((y) => y.kind === k).length;
  return { sol: c("sol"), man: c("man"), amb: c("amb"), dil: c("dil"), manPreSw: x.filter((y) => y.preSw && y.kind === "man").length };
}

/** Max. parciální tlak dusíku: (okolní tlak − pO₂) × podíl N₂ v inertní části plynu. */
export function pn2Max(d: Dive): number {
  let mx = 0;
  d.s.t.forEach((t, i) => {
    if (t > d.h.diveTimeS) return;
    const amb = (d.h.surfP || 1013) / 1000 + d.s.depth[i] * (d.h.salinity || 1000) / 1000 * 0.0981;
    const o2 = d.s.o2[i] / 100, he = d.s.he[i] / 100, n2 = Math.max(0, 1 - o2 - he);
    const inert = n2 + he;
    const ppo2 = d.s.ppo2[i] > 0 ? Math.min(d.s.ppo2[i], amb) : amb * o2;
    const v = inert > 0 ? Math.max(0, amb - ppo2) * (n2 / inert) : 0;
    if (v > mx) mx = v;
  });
  return Math.round(mx * 100) / 100;
}

/** Použité plyny („O₂/He“) v pořadí prvního použití a čas na každém v sekundách. */
export function gasUse(d: Dive): { mix: string; s: number }[] {
  const out = new Map<string, number>();
  const dt = d.h.rateS || 5;
  d.s.t.forEach((t, i) => { if (t > d.h.diveTimeS) return; const k = `${d.s.o2[i]}/${d.s.he[i]}`; out.set(k, (out.get(k) || 0) + dt); });
  return [...out].map(([mix, s]) => ({ mix, s }));
}
/** Úseky ponoru podle použitého plynu (od, do v sekundách). */
export function gasSegments(d: Dive): { mix: string; from: number; to: number }[] {
  const out: { mix: string; from: number; to: number }[] = [];
  d.s.t.forEach((t, i) => {
    const k = `${d.s.o2[i]}/${d.s.he[i]}`, last = out[out.length - 1];
    if (last) last.to = t;
    if (!last || last.mix !== k) out.push({ mix: k, from: t, to: t });
  });
  return out;
}
/** Štítek a barevná třída plynu: AIR, NX 32, TMX 21/35, O₂. */
export function gasLabel(mix: string): { label: string; cls: "air" | "tmx" | "nx" | "o2" } {
  const [o2, he] = mix.split("/").map(Number);
  if (he > 0) return { label: `TMX ${o2}/${he}`, cls: "tmx" };
  if (o2 >= 99) return { label: "O₂", cls: "o2" };
  if (o2 === 21) return { label: "AIR", cls: "air" };
  return { label: o2 > 21 ? `NX ${o2}` : `${o2}/0`, cls: o2 > 21 ? "nx" : "tmx" };
}
export const GAS_COLOR = { air: "#cfd8dc", tmx: "#bc8f6f", nx: "#c5c56a", o2: "#ffffff" } as const;

/** Potápěč je na dekompresní zastávce: má povinnost a je nejvýš 3 m pod hloubkou zastávky. */
export const atStop = (d: Dive, i: number) => d.s.stop[i] > 0 && d.s.depth[i] <= d.s.stop[i] + 3;
/** Hloubka zastávky jen v úsecích, kdy na ní potápěč skutečně byl (jinak null). */
export const realStops = (d: Dive) => d.s.stop.map((v, i) => (atStop(d, i) ? v : null));

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
    gases: gasUse(d),
    pn2Max: pn2Max(d),
    btnN: d.buttons.filter((b) => b.t >= 0 && b.t <= d.h.diveTimeS).length,
    menuN: d.buttons.filter((b) => b.t >= 0 && b.t <= d.h.diveTimeS && b.from === SCR_MAIN && b.to === SCR_MENU).length,
    offMainS: offMain(d),
    sp: setpointChanges(d),
    dose: doseSummary(d),
    densMax: Math.max(0, ...gasDensity(d).filter((x): x is number => x != null)),
    vents: dilVents(d).length,
    dilUse: pressureUse(d.s.t, d.s.dil, d.s.depth, d.h.diveTimeS),
    o2Use: pressureUse(d.s.t, d.s.o2p, d.s.depth, d.h.diveTimeS),
    co2AlarmN: d.alarms.filter((a) => a.kind === "co2").length,
    co2AlarmS: d.alarms.filter((a) => a.kind === "co2").reduce((x, a) => x + a.end - a.start, 0),
    co2Avg: co2.length && Math.max(...co2) > 0 ? round(co2.reduce((a, b) => a + b, 0) / co2.length, 2) : null,
    ceilMax: Math.max(...s.ceil), ttsMax: Math.max(...s.tts), gf99End: gfs.length ? gfs[gfs.length - 1] : null,
    descMax: rates.length ? round(Math.max(...rates), 1) : 0, ascMax: rates.length ? round(-Math.min(...rates), 1) : 0,
    batVMin: Math.min(...s.bv), // deko = čas v dekompresní povinnosti nejvýš 3 m pod hloubkou zastávky (tam už odpočet běží); deko režim = celá doba s povinností
    decoMin: Math.round(idx.filter((i) => atStop(d, i)).length * (d.h.rateS || 5) / 60),
    decoModeMin: Math.round(idx.filter((i) => s.stop[i] > 0).length * (d.h.rateS || 5) / 60), dilStart: firstNum(s.dil), dilEnd: lastNum(s.dil), o2Start: firstNum(s.o2p), o2End: lastNum(s.o2p),
    dilUsed: [...new Set(s.o2.map((o, i) => `${o}/${s.he[i]}`))].join(", "),
  };
}

export const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/** Kalibrace čidel odvozená z průměrného pO₂ (bar/mV): medián poměru přes ponor. */
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

export interface Thresholds { co2Mbar: number; scrubPct: number; scrubDays: number; batMarginV: number; spLateMin?: number; spOsc?: number; spDescM?: number }
export const DEFAULT_THRESHOLDS: Thresholds = { co2Mbar: 5, scrubPct: 50, scrubDays: 14, batMarginV: 0.05, spLateMin: 5, spOsc: 3, spDescM: 6 };

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
  for (const kind of ["co2", "po2high", "po2low"] as const) {
    const as = d.alarms.filter((a) => a.kind === kind);
    if (!as.length) continue;
    const min = as.reduce((x, a) => x + a.end - a.start, 0) / 60;
    const lowSp = kind === "po2low" && as.some((a) => d.s.sp[d.s.t.findIndex((t) => t >= a.start)] < 0.3);
    out.push({ level: kind === "po2low" ? "info" : kind === "co2" ? "bad" : "warn", title: `${as[0].label} z počítače${lowSp ? " (během setpointu 0,19 před výstupem)" : ""}`,
      text: `${as.length}× (${as.map((a) => `${Math.round(a.start / 60)}.–${Math.max(Math.round(a.start / 60), Math.round(a.end / 60))}. min`).join(", ")}), celkem ${min < 1 ? "pod 1 min" : Math.round(min) + " min"}.` });
  }
  const ef = effortOf(d, th.co2Mbar);
  if (ef.densOver62 >= 1) out.push({ level: "warn", title: "Velmi hustý plyn", text: `Hustota plynu až ${ef.densMax.toLocaleString("cs-CZ")} g/l, ${Math.round(ef.densOver62)} min nad 6,2 g/l – výrazně vyšší dechová práce a riziko hromadění CO₂.` });
  else if (ef.densOver52 >= 1) out.push({ level: "info", title: "Hustý plyn", text: `Hustota plynu až ${ef.densMax.toLocaleString("cs-CZ")} g/l, ${Math.round(ef.densOver52)} min nad doporučenými 5,2 g/l.` });
  for (const c of ef.co2Notes) out.push({ level: c.level, title: "Souvislost CO₂", text: c.text });
  if (ef.vents >= 5) out.push({ level: "info", title: "Časté upouštění smyčky", text: `${ef.vents}× pokles diluentu bez klesání (upouštění smyčky, vyfukování masky) – může souviset s vyvážením nebo stresem.` });
  out.push(...spWarnings(d, sum, { ...SP_RULES, lateMin: th.spLateMin ?? 5, osc: th.spOsc ?? 3, descM: th.spDescM ?? 6 }));
  const mv = [d.s.mv1, d.s.mv2, d.s.mv3];
  mv.forEach((a, k) => {
    const mid = d.s.depth.map((x, i) => (x > 1.5 ? a[i] : null)).filter((x): x is number => x != null);
    if (mid.length && Math.max(...mid) === 0) out.push({ level: "warn", title: `Čidlo ${k + 1} na nule`, text: "Čidlo během ponoru ukazovalo 0 mV – vadné nebo odpojené." });
  });
  return out;
}
