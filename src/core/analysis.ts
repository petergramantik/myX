// Odvozené hodnoty: souhrn ponoru, kalibrace čidel, odhad vstřiků solenoidu, upozornění.
import { computerWarnings, deviatingCell, type CompWarn } from "./compwarn";
import { co2BadRanges, co2Plausibility, co2Valid, dilVents, effortOf, gasDensity, o2RateWindows, workloadBase, type EffortBase } from "./effort";
import type { Dive, Header } from "./shearwater";

export interface Summary {
  avgDepth: number; tempMin: number; tempMax: number; ppo2Min: number; ppo2Max: number; co2Max: number | null; co2Avg: number | null; co2AlarmN: number; co2AlarmS: number; gases: { mix: string; s: number }[]; dilUse: GasUse; o2Use: GasUse; pn2Max: number;
  btnN: number; menuN: number; offMainS: number;
  densMax: number; vents: number; co2Bad: boolean; po2HiN: number; po2LoN: number; /** nejdelší čas (s) nad PO2_HI_STEPS mimo deko */ po2Hi?: number[]; /** základ zátěže (bar/min) při nízkém / vysokém SP a spotřeba O₂ z lahve (bar/min) */ wLo?: number | null; wHi?: number | null; o2Rate?: number | null; startPo2: StartPo2Level; spreadMin: number; cellIssue: CellIssue;
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
  return pressureAnalysis(t, p, diveS).use;
}

/** Zavření / otevření onboard lahve během ponoru (prudký pád na mezitlak externí lahve a zpět). */
export interface ValveEvent { t: number; kind: "close" | "open"; from: number; to: number }

/**
 * Rozbor tlaku lahve: spotřeba jen z postupného poklesu v době, kdy byla onboard lahev otevřená.
 * Prudké změny (> 15 bar/min) jsou zavření / otevření ventilu nebo odvzdušnění, ne spotřeba.
 * Hodnoty pod 20 bar = mezitlak externí lahve (onboard zavřená).
 */
export function pressureAnalysis(t: number[], p: (number | null)[], diveS: number): { use: GasUse; valve: ValveEvent[]; dips: number[] } {
  // 0 = vysílač zatím neposlal údaj (po zapnutí) – vynechat
  const idx = t.map((_, i) => i).filter((i) => t[i] <= diveS && p[i] != null && p[i]! > 0);
  const raw = idx.map((i) => p[i]!), tt = idx.map((i) => t[i]);
  const valid = raw.filter((v) => v >= MIN_BAR);
  const empty = { use: { ok: false, start: raw[0] ?? null, end: raw[raw.length - 1] ?? null, bar: 0, ext: [], noisy: false } as GasUse, valve: [] as ValveEvent[], dips: [] as number[] };
  if (!raw.length) return empty;
  // rychlost změny přes ~30 s: prudký pokles / nárůst = ventil, ne spotřeba
  const RATE = 15;
  const jump = raw.map((v, k) => {
    let j = k; while (j > 0 && tt[k] - tt[j - 1] <= 30) j--;
    const dt = (tt[k] - tt[j]) / 60;
    if (j === k || dt <= 0) return 0;
    const r = (raw[j] - v) / dt;
    return r > RATE ? -1 : r < -RATE ? 1 : 0;
  });
  // ventil: přechody mezi mezitlakem (< 20) a plným tlakem
  const valve0: (ValveEvent & { lowAt?: number })[] = [];
  let lastHigh: number | null = null, lastHighT = 0, low = raw[0] < MIN_BAR, lowAt = 0;
  raw.forEach((v, k) => {
    if (v >= 50 && jump[k] === 0) { lastHigh = v; lastHighT = tt[k]; }
    if (!low && v < MIN_BAR) { low = true; lowAt = tt[k]; if (lastHigh != null && lastHigh >= 50) valve0.push({ t: lastHighT, kind: "close", from: Math.round(lastHigh), to: Math.round(v), lowAt }); }
    else if (low && v >= MIN_BAR + 30) { low = false; valve0.push({ t: tt[k], kind: "open", from: Math.round(raw[Math.max(0, k - 1)]), to: Math.round(v), lowAt }); }
  });
  // krátký pokles a návrat do 90 s = průtok při ruční dávce (tlak na vysílači se dorovná), ne zavření lahve
  const valve: ValveEvent[] = [], dips: number[] = [];
  for (let q = 0; q < valve0.length; q++) {
    const c = valve0[q], o = valve0[q + 1];
    if (c.kind === "close" && o?.kind === "open" && o.t - (c.lowAt ?? c.t) <= 90) { dips.push(c.lowAt ?? c.t); q++; continue; }
    valve.push({ t: c.t, kind: c.kind, from: c.from, to: c.to });
  }
  if (valid.length < Math.max(5, raw.length * 0.2)) return { ...empty, valve, dips };
  // medián z 7 vzorků (~35 s) jen z ustálených hodnot nad mezitlakem
  const ok = (k: number) => raw[k] >= MIN_BAR && jump[k] === 0;
  const sm = raw.map((_, k) => {
    if (!ok(k)) return null;
    const w: number[] = []; for (let q = Math.max(0, k - 3); q <= Math.min(raw.length - 1, k + 3); q++) if (ok(q)) w.push(raw[q]);
    w.sort((a, b) => a - b); return w[w.length >> 1];
  });
  // malé nárůsty (do 10 bar) = ohřátí lahve, odečtou se; větší nárůst bez předchozího zavření = doplnění z externího zdroje
  let ref: number | null = null, bar = 0, rise = 0, wiggle = 0, closedAt: number | null = null;
  const extIdx: number[] = [];
  sm.forEach((v, k) => {
    if (v == null) { if (raw[k] < MIN_BAR) { extIdx.push(k); if (ref != null) closedAt = ref; ref = null; } else if (jump[k] < 0 && ref != null) closedAt = ref; return; }
    if (ref == null) {
      // znovuotevření onboard lahve: tlak se vrátí k poslední hodnotě – nic se nepočítá
      if (closedAt != null && v - closedAt > EXT_RISE + 5) { rise += v - closedAt; extIdx.push(k); }
      ref = v; closedAt = null; return;
    }
    if (v < ref - HYST) { bar += ref - v; wiggle += ref - v; ref = v; }
    else if (v > ref + HYST) {
      if (v - ref >= EXT_RISE) { rise += v - ref; extIdx.push(k); } else { bar -= v - ref; wiggle += v - ref; }
      ref = v;
    }
  });
  const ext: [number, number][] = [];
  for (const k of extIdx) {
    const m = tt[k] / 60;
    const last = ext[ext.length - 1];
    if (last && m - last[1] <= 2) last[1] = m; else ext.push([m, m]);
  }
  const firstV = sm.find((v) => v != null) ?? null, lastV = [...sm].reverse().find((v) => v != null) ?? null;
  const net = Math.max(0, bar);
  return { use: { ok: true, start: firstV, end: lastV, bar: Math.round(net), ext: ext.map(([a, b]) => [Math.round(a), Math.round(b)]), noisy: rise + wiggle > Math.max(60, net * 4) }, valve, dips };
}

// ---------- ovládání počítače (záznamy 0x51)
export const SCR_MAIN = 0xb3, SCR_MENU = 0x06;
const SCR_NAMES: Record<number, string> = { 0xb3: "hlavní obrazovka", 0x155: "info 1", 0x156: "info 2", 0x159: "info 1 (P)", 0x15a: "info 2 (P)", 0xec: "info 3", 0x02: "info", 0x06: "menu – Switch Setpoint", 0x05: "menu – Select Gas", 0x07: "výběr plynu", 0x08: "menu – Switch CC > OC", 0x09: "menu – Dive Setup+", 0xa4: "menu na hladině" };
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
export interface SpRules { lateMin: number; osc: number; descM: number; stableS: number; /** menší klesání se hlásí jen při pO₂ nad po2Bad */ descMinM?: number; po2Bad?: number }
export const SP_RULES: SpRules = { lateMin: 5, osc: 3, descM: 6, stableS: 180, descMinM: 3, po2Bad: 1.6 };

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
  const allUps = sum.sp.filter((c) => c.to >= 1.0 && c.from < 1.0);
  // krátké přepnutí nahoru a zpět do 2 min se za přepnutí nepočítá (jen se uvede u následujícího)
  const heldS = (c: SpChange) => { const nx = sum.sp.find((x) => x.t > c.t && x.to < 1.0); return (nx ? nx.t : d.h.diveTimeS) - c.t; };
  const ups = allUps.filter((c) => heldS(c) >= 120);
  const fmin = (t: number) => (Math.round(t / 6) / 10).toLocaleString("cs-CZ", { minimumFractionDigits: 1 });
  let prevT = -1;
  // pozdní přepnutí: měřeno od dosažení dna (hloubka se pak ≥ stableS nezvýší o víc než osc)
  for (const [k, c] of ups.entries()) {
    const j = s.t.findIndex((t) => t >= c.t);
    if (j < 0) continue;
    const p = plateauStart(d, j, r.osc);
    const delay = (c.t - s.t[p]) / 60;
    const short = allUps.filter((x) => x.t > prevT && x.t < c.t && heldS(x) < 120)
      .map((x) => { const back = sum.sp.find((y) => y.t > x.t && y.to < 1.0); return `Krátce: ${fmin(x.t)} min → ${fmt(x.to)} (${fmt(x.depth)} m)${back ? `, po ${dur(back.t - x.t)} zpět na ${fmt(back.to)}` : ""}.`; });
    prevT = c.t;
    const txt = [...short, `${fmin(c.t)} min → ${fmt(c.to)} (${fmt(c.depth)} m), ${fmt(Math.round(delay * 10) / 10)} min po dosažení dna (${fmt(s.depth[p])} m)${c.manual ? ", ručně v menu Petrelu" : ""}.`].join(" ");
    const blk: AlertBlock[] = [{ head: "", steps: [], from: s.t[p], to: c.t, chart: "po2" }];
    if (delay > r.lateMin && s.depth[p] >= 10) out.push({ level: "info", title: "Pozdní přepnutí na vysoký setpoint", text: txt, blocks: blk });
    else if (k === 0) out.push({ level: "info", title: "Přepnutí setpointu", text: txt, blocks: blk });
  }
  if (!startHigh && !ups.length && d.h.maxDepth > 10) {
    // bez přepnutí: varovat jen pokud se potápěč na dně ≥ lateMin zdržel
    let longest = 0;
    for (let i = 0; i < n; i++) { if (s.depth[i] < 10) continue; const p = plateauStart(d, i, r.osc); longest = Math.max(longest, s.t[i] - s.t[p]); }
    if (longest > r.lateMin * 60) out.push({ level: "info", title: "Vysoký setpoint nenastaven", text: `Během ponoru nebyl setpoint přepnut na vysoký (≥ 1,0), i když byl potápěč na dně ${Math.round(longest / 60)} min.` });
  }
  // klesání s vysokým setpointem: o víc než descM od nejmělčího místa
  let minI = -1, peakI = -1, warned = false;
  const descB: AlertBlock[] = [], descT: string[] = [];
  let descMax = 0, descBad = false;
  for (let i = 0; i < n; i++) {
    if (s.t[i] > d.h.diveTimeS) break;
    if (s.sp[i] < 1.0) { minI = -1; warned = false; continue; }
    if (minI < 0 || s.depth[i] < s.depth[minI]) { minI = i; peakI = i; warned = false; }
    if (s.depth[i] > s.depth[peakI]) peakI = i;
    const end = s.depth[i] < s.depth[peakI] - r.osc || i === n - 1 || s.sp[i + 1] < 1.0;
    const dd = s.depth[peakI] - s.depth[minI];
    if (!warned && end && dd > (r.descMinM ?? 3)) {
      // pO₂ během klesání a do 3 min po něm
      const j2 = s.t.findIndex((t) => t > s.t[peakI] + 180);
      const po2 = Math.max(...s.ppo2.slice(minI, j2 < 0 ? n : j2));
      const bad = po2 > (r.po2Bad ?? 1.6);
      if (dd > r.descM || bad) {
        descB.push({ head: `${tpt(s.t[minI])}–${tpt(s.t[peakI])}: ${fmt(s.depth[minI])} → ${fmt(s.depth[peakI])} m, SP ${fmt(s.sp[minI])}, max pO₂ ${fmt(po2)} bar`, steps: [], from: s.t[minI], to: s.t[peakI], chart: "po2" });
        descT.push(`${tpt(s.t[minI])}–${tpt(s.t[peakI])} z ${fmt(s.depth[minI])} na ${fmt(s.depth[peakI])} m (max pO₂ ${fmt(po2)} bar)`);
        descMax = Math.max(descMax, po2); descBad ||= bad;
      }
      warned = true;
    }
    if (end && s.depth[i] < s.depth[peakI] - r.osc) { minI = i; peakI = i; warned = false; } // nové klesání se počítá od tohoto místa
  }
  if (descB.length) out.push({ level: "warn", title: "Klesání s vysokým setpointem", text: `Klesání se setpointem ${fmt(descB.length ? s.sp[s.t.findIndex((t) => t >= descB[0].from)] : 1.3)} – před klesáním nebylo přepnuto na nízký: ${descT.join(", ")}.${descBad ? ` pO₂ následně přesáhlo ${fmt(r.po2Bad ?? 1.6)} bar.` : ""}`, blocks: descB });
  for (const c of sum.sp.filter((c) => c.to < 0.3)) {
    const endPhase = c.depth <= 6 && c.t >= d.h.diveTimeS - 600;
    if (!endPhase) out.push({ level: "warn", title: `Setpoint ${fmt(c.to)} mimo závěr ponoru`, blocks: [{ head: "", steps: [], from: c.t, to: c.t + 60, chart: "po2" }], text: `Přepnuto v ${Math.round(c.t / 60)}. min v ${fmt(c.depth)} m – nízký setpoint pod 6 m nebo dřív než v posledních 10 min.` });
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
  // krátký pokles tlaku O₂ na vysílači (průtok) potvrzuje ruční dávku O₂
  const dips = pressureAnalysis(s.t, s.o2p, d.h.diveTimeS).dips;
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
      let kind: DoseKind = dilDrop >= 2 ? "dil" : !above ? "sol" : f[i + best] > s.o2[i] / 100 + 0.01 ? "man" : "amb";
      if (kind === "amb" && dips.some((t) => s.t[i] - t >= -30 && s.t[i] - t <= 60)) kind = "man";
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

/**
 * Rozjetá čidla: rozdíl mezi čidly (přepočtenými společnou kalibrací) nad 0,3 bar. Vrací úseky, maximum a čidla,
 * která v těch chvílích nejčastěji zaostávala (pomalá odezva = typicky vlhkost na membráně nebo stárnutí).
 */
/** Minimální doba rozjetí čidel (min), od které se hlásí upozornění. Kratší výkyvy jen v grafu. */
export const SPREAD_MIN = 3;

export type CellIssue = "" | "wet" | "multi" | "c1" | "c2" | "c3";

/** Rozjetí O₂ čidel: max. rozdíl, doba nad prahem, pásma pro graf a klasifikace příčiny
 *  (wet = víc čidel najednou a po výstupu se srovnala, cN = jedno čidlo mimo, multi = víc čidel bez srovnání). */
export function cellSpread(d: Dive, thr = 0.3) {
  const s = d.s, cal = cellCalibration(d);
  if (cal.some((c) => !c)) return null;
  const dt = d.h.rateS || 5;
  let max = 0, at = 0, n = 0;
  const lag = [0, 0, 0], dev = [0, 0, 0], bands: { from: number; to: number }[] = [];
  let endSp = 0;
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] > d.h.diveTimeS) continue;
    const c = [s.mv1[i] * cal[0]!, s.mv2[i] * cal[1]!, s.mv3[i] * cal[2]!];
    const sp = Math.max(...c) - Math.min(...c);
    if (s.depth[i] >= 1.5 && s.t[i] > d.h.diveTimeS - 240) endSp = Math.max(endSp, sp);
    if (s.depth[i] < 3) continue;
    if (sp > max) { max = sp; at = s.t[i]; }
    if (sp > thr) {
      n++;
      const mx = Math.max(...c), med = [...c].sort((a, b) => a - b)[1];
      c.forEach((v, k) => { if (mx - v > thr * 0.6) lag[k]++; if (Math.abs(v - med) > 0.2) dev[k]++; });
      const last = bands[bands.length - 1];
      if (last && s.t[i] - last.to <= dt * 2) last.to = s.t[i]; else bands.push({ from: s.t[i], to: s.t[i] });
    }
  }
  const min = n * dt / 60;
  const slow = lag.map((x, k) => ({ k: k + 1, x })).filter((x) => x.x >= n * 0.5).map((x) => x.k);
  const out = dev.map((x, k) => ({ k: k + 1, x })).filter((x) => n > 0 && x.x > n * 0.6).map((x) => x.k);
  const off = dev.map((x, k) => ({ k: k + 1, x })).filter((x) => n > 0 && x.x > n * 0.3).map((x) => x.k);
  let kind: CellIssue = "";
  if (min >= SPREAD_MIN) {
    if (out.length === 1) kind = ("c" + out[0]) as CellIssue;
    else kind = endSp <= 0.2 ? "wet" : "multi";
  }
  return { max: round(max, 2), at, min, slow, bands, kind, cells: out.length === 1 ? out : off, endSp: round(endSp, 2) };
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
  const cs0 = cellSpread(d);
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
    co2Bad: co2Plausibility(d)?.ok === false,
    po2HiN: d.alarms.filter((a) => a.kind === "po2high").length, po2Hi: po2HiHist(d), ...(() => { const b = workloadBase(d), o = o2RateWindows(d).map((x) => x.rate).sort((p, q) => p - q); return { wLo: b.lo, wHi: b.hi, o2Rate: o.length >= 3 ? o[o.length >> 1] : null }; })(),
    // nízké pO₂ jen pod vodou (ne na hladině) a ne při setpointu 0,19 před výstupem
    po2LoN: lowPo2Phases(d).mid, startPo2: startPo2(d).level,
    spreadMin: cs0?.min ?? 0, cellIssue: cs0?.kind ?? "",
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

export type ChartKey = "po2" | "co2" | "press" | "temp" | "effort";
/** Jedna situace varování / alarmu s řešením a odkazem do grafu. */
export interface AlertBlock { head: string; steps: string[]; from: number; to: number; chart: ChartKey }
export interface Alert { level: "warn" | "bad" | "info"; title: string; text: string; kind?: "scrubber" | "battery"; blocks?: AlertBlock[] }

/** Minuty jako „4 h 41 min“. */
export const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`;

export interface Thresholds { co2Mbar: number; scrubPct: number; scrubDays: number; batMarginV: number; spLateMin?: number; spOsc?: number; spDescM?: number; spBelow?: number; spAbove?: number; po2Lo?: number; po2LoMin?: number; po2Hypo?: number; po2LoWarnS?: number; po2LoBadS?: number; pn2Hot?: number; po2HiWarn?: number; po2HiBad?: number; po2HiWarnS?: number; scrubLeftMin?: number }
export const DEFAULT_THRESHOLDS: Thresholds = { co2Mbar: 5, scrubPct: 50, scrubDays: 14, batMarginV: 0.05, spLateMin: 5, spOsc: 3, spDescM: 6, spBelow: 0.15, spAbove: 0.2, po2Lo: 0.4, po2LoMin: 0.3, po2Hypo: 0.21, po2LoWarnS: 30, po2LoBadS: 120, pn2Hot: 3.16, po2HiWarn: 1.4, po2HiBad: 1.6, po2HiWarnS: 60, scrubLeftMin: 90 };

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
// ---------- vysoké pO₂ (vlastní detekce)
/** Vzorek je na dekompresní zastávce: po nejhlubším bodě v hloubce zastávky (do 3 m pod ní) nebo do 9 m (P). */
export function decoMask(d: Dive): boolean[] {
  const s = d.s; let imax = 0;
  s.depth.forEach((v, i) => { if (v > s.depth[imax]) imax = i; });
  // jen po nejhlubším bodě: v hloubce zastávky (nejvýš 3 m pod ní), nebo mělčeji než 9 m
  return s.t.map((_, i) => i > imax && s.depth[i] > 0.5 && ((s.stop[i] > 0 && s.depth[i] <= s.stop[i] + 3) || s.depth[i] <= 9));
}
/** Úseky vysokého pO₂: „bad“ nad červeným prahem kdykoli, „warn“ nad žlutým déle než warnS mimo deko zastávky. */
export function po2HighZones(d: Dive, th: Partial<Thresholds> = {}): { from: number; to: number; level: "warn" | "bad"; max: number }[] {
  const warn = th.po2HiWarn ?? 1.4, bad = th.po2HiBad ?? 1.6, warnS = th.po2HiWarnS ?? 60;
  const s = d.s, deco = decoMask(d), out: { from: number; to: number; level: "warn" | "bad"; max: number }[] = [];
  const scan = (test: (i: number) => boolean, level: "warn" | "bad", minS: number) => {
    let a = -1;
    for (let i = 0; i <= s.t.length; i++) {
      const ok = i < s.t.length && s.t[i] <= d.h.diveTimeS && test(i);
      if (ok && a < 0) a = i;
      if (!ok && a >= 0) { const b = i - 1, to = s.t[Math.min(i, s.t.length - 1)] > s.t[b] ? s.t[Math.min(i, s.t.length - 1)] : s.t[b] + (d.h.rateS || 5); if (to - s.t[a] >= minS) out.push({ from: s.t[a], to, level, max: Math.max(...s.ppo2.slice(a, b + 1)) }); a = -1; }
    }
  };
  scan((i) => s.ppo2[i] > bad, "bad", 0);
  scan((i) => s.ppo2[i] > warn && !deco[i], "warn", warnS);
  return out.sort((x, y) => x.from - y.from);
}
/** Prahy pro souhrn ponoru (bar): nejdelší souvislý čas nad každým z nich mimo deko zastávky. */
export const PO2_HI_STEPS = [1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6];
export function po2HiHist(d: Dive): number[] {
  const s = d.s, deco = decoMask(d);
  return PO2_HI_STEPS.map((lim) => { let best = 0, a = -1;
    for (let i = 0; i <= s.t.length; i++) { const ok = i < s.t.length && s.t[i] <= d.h.diveTimeS && s.ppo2[i] > lim && !deco[i];
      if (ok && a < 0) a = i; if (!ok && a >= 0) { best = Math.max(best, s.t[i - 1] - s.t[a]); a = -1; } }
    return Math.round(best); });
}
/** Úroveň vlastní detekce vysokého pO₂ ze souhrnu ponoru (pro tag v seznamu). */
export function po2HiLevel(sum: { ppo2Max: number; po2Hi?: number[] }, th: Partial<Thresholds> = {}): "warn" | "bad" | null {
  if (sum.ppo2Max > (th.po2HiBad ?? 1.6)) return "bad";
  const k = PO2_HI_STEPS.reduce((b, v, i) => (v <= (th.po2HiWarn ?? 1.4) + 1e-9 ? i : b), 0);
  return (sum.po2Hi?.[k] ?? 0) >= (th.po2HiWarnS ?? 60) ? "warn" : null;
}

// ---------- řešení varování a alarmů z počítače
/** Varování na displeji patřící k alarmu (stejný druh, začátek do 10 s). */
export function alarmWarn(d: Dive, kind: "po2high" | "po2low" | "co2", from: number): CompWarn | undefined {
  return computerWarnings(d).find((w) => w.kind === kind && Math.abs(w.start - from) <= 10);
}
/** Skutečný konec alarmu: až zmizí varování z displeje (ztlumení alarmu problém nekončí). */
export const alarmEnd = (d: Dive, a: { kind: string; start: number; end: number }) => {
  const w = a.kind === "po2high" || a.kind === "po2low" || a.kind === "co2" ? alarmWarn(d, a.kind, a.start) : undefined;
  // další alarm stejného druhu začíná novou situaci → nejpozději tam
  const next = d.alarms.find((x) => x.kind === a.kind && x.start > a.start)?.start ?? Infinity;
  // varování může na displeji zůstat dlouho (nepotvrzené) – situace končí, když se hodnota aspoň na 1 min vrátí za práh
  const s = d.s, i0 = s.t.findIndex((t) => t >= a.end);
  const bad = (i: number) => a.kind === "co2" ? (s.co2[i] ?? 0) >= 5 : a.kind === "po2high" ? s.ppo2[i] > 1.6 : a.kind === "po2low" ? s.ppo2[i] < 0.4 : false;
  let back = Infinity;
  if (i0 >= 0) for (let i = i0, ok0 = -1; i < s.t.length; i++) { if (!bad(i)) { if (ok0 < 0) ok0 = i; if (s.t[i] - s.t[ok0] >= 60) { back = s.t[ok0]; break; } } else ok0 = -1; }
  return Math.max(a.end, Math.min(w?.end ?? (w ? d.h.diveTimeS : a.end), next, back, d.h.diveTimeS));
};
/** Okamžik v ponoru: 11′36″. */
export const tpt = (t: number) => { const r = Math.round(t); return `${Math.floor(r / 60)}′${String(r % 60).padStart(2, "0")}″`; };
/** Délka: pod minutu „44 s“, jinak 1′05″. */
export const dur = (sec: number) => { const r = Math.round(sec); return r < 60 ? `${r} s` : tpt(r); };
const mmssA = tpt;
/** Co se dělo od varování / alarmu do jeho konce (+ 3 min): potvrzení, setpoint, dávky, doplnění diluentu, lahve, OC, konec. */
export function resolutionSteps(d: Dive, from: number, to: number | null, kind: "po2high" | "po2low" | "co2" | "press" | "cell" | "other", th: Partial<Thresholds> = {}, until = Infinity): string[] {
  const end = Math.min((to ?? from) + 180, d.h.diveTimeS, until - 1), s = d.s, out: { t: number; x: string }[] = [];
  const ackKinds: Record<string, string[]> = { po2high: ["po2high"], po2low: ["po2low"], co2: ["co2"], press: ["o2press", "dilpress"], cell: ["cellout"], other: ["battery", "co2sensor", "unknown"] };
  const acts = kind !== "other";
  const inW = (t: number) => t >= from && t <= end;
  const at = (t: number) => { const i = s.t.findIndex((x) => x >= t); return i < 0 ? s.t.length - 1 : i; };
  const nf = (v: number, k = 2) => v.toLocaleString("cs-CZ", { maximumFractionDigits: k });
  let acked = -1;
  const alarmKind = kind === "po2high" || kind === "po2low" || kind === "co2";
  const valAt = (t: number) => { const i = at(t); return kind === "co2" ? `CO₂ ${nf(s.co2[i] ?? 0, 1)} mbar` : `pO₂ ${nf(s.ppo2[i])} bar`; };
  const thr = kind === "po2high" ? th.po2HiBad ?? 1.6 : kind === "po2low" ? th.po2Lo ?? 0.4 : th.co2Mbar ?? 5;
  const past = (t: number) => { const i = at(t), v = kind === "co2" ? s.co2[i] ?? 0 : s.ppo2[i]; return kind === "po2low" ? v >= thr : v <= thr; };
  if (alarmKind) {
    const w = alarmWarn(d, kind, from);
    out.push({ t: from, x: `alarm spuštěn, ${valAt(from)}, ${nf(s.depth[at(from)], 1)} m` });
    if (to != null && to < d.h.diveTimeS) out.push({ t: to, x: `alarm ztlumen, ${valAt(to)}` });
    if (w?.end != null && inW(w.end)) {
      const below = past(w.end), lim = `${kind === "co2" ? "CO₂" : "pO₂"} ${kind === "po2low" ? "nad" : "pod"} ${nf(thr)}${kind === "co2" ? " mbar" : " bar"}`;
      out.push({ t: w.end, x: w.how === "ack" ? `potvrzeno tlačítkem${below ? `, ${lim}` : `, ${valAt(w.end)}`}` : `varování zmizelo${below ? ` – ${lim}` : `, ${valAt(w.end)}`}` });
      acked = w.end;
    }
  } else {
    // potvrzení jen jednoho varování (toho, které začalo nejblíž začátku situace) – ne např. současně potvrzený diluent
    const cand = computerWarnings(d).filter((w) => w.how === "ack" && w.end != null && ackKinds[kind].includes(w.kind) && w.start >= from - 10 && w.start <= (to ?? from) + 5 && inW(w.end)).sort((a, b) => Math.abs(a.start - from) - Math.abs(b.start - from))[0];
    if (cand) { out.push({ t: cand.end!, x: "potvrzeno tlačítkem" }); acked = cand.end!; }
  }
  if (acts) for (const c of setpointChanges(d)) if (inW(c.t)) out.push({ t: c.t, x: `setpoint ${nf(c.from)} → ${nf(c.to)}${c.manual ? "" : " (P)"}` });
  if (acts && kind !== "cell") for (const x of o2Doses(d)) if (inW(x.t)) {
    if (x.kind === "man") out.push({ t: x.t, x: `ruční dávka O₂ (+${nf(x.rise)} bar)` });
    else if (x.kind === "amb") out.push({ t: x.t, x: `ruční O₂ nebo diluent (+${nf(x.rise)} bar) (P)` });
    else if (x.kind === "dil") out.push({ t: x.t, x: "doplněn diluent (P)" });
    else if (kind === "po2low") out.push({ t: x.t, x: `vstřik solenoidu (+${nf(x.rise)} bar) (P)` });
  }
  if (acts && kind !== "cell") for (const t of dilVents(d)) if (inW(t)) out.push({ t, x: "doplnění diluentu (ADV, proplach) (P)" });
  if (acts && kind !== "cell") for (const [arr, g] of [[s.o2p, "O₂"], [s.dil, "diluent"]] as const) for (const v of pressureAnalysis(s.t, arr, d.h.diveTimeS).valve) if (inW(v.t)) out.push({ t: v.t, x: `onboard ${g} ${v.kind === "open" ? "otevřena" : "zavřena – přechod na externí"} (${v.from} → ${v.to} bar)` });
  if (acts) for (let i = 1; i < s.t.length; i++) if (inW(s.t[i]) && s.sp[i - 1] >= 0.3 && s.sp[i] < 0.05 && s.depth[i] > 2) { out.push({ t: s.t[i], x: "přechod na OC (P)" }); break; }
  if (!alarmKind && to != null && to < d.h.diveTimeS && Math.abs(to - acked) > 2) {
    const i = at(to);
    const val = kind === "co2" ? `CO₂ ${nf(s.co2[i] ?? 0, 1)} mbar` : kind === "po2high" || kind === "po2low" ? `pO₂ ${nf(s.ppo2[i])} bar` : "";
    out.push({ t: to, x: `${kind === "press" || kind === "cell" || kind === "other" ? "varování skončilo" : "alarm skončil"}${val ? ` (${val})` : ""}` });
  }
  if (kind === "co2" && co2BadRanges(d).some((r) => from >= r.from - 30 && from <= r.to)) out.push({ t: from + 0.5, x: "čidlo CO₂ nejspíš chybné (P)" });
  if (kind === "po2high") {
    // pravděpodobná příčina: klesání s vysokým SP nebo ruční dávka O₂ v posledních minutách před nárůstem
    const j0 = at(Math.max(0, from - 300)), jf = at(from);
    let mn = -1; for (let k = j0; k <= jf; k++) if (s.sp[k] >= 1 && (mn < 0 || s.depth[k] < s.depth[mn])) mn = k;
    if (mn >= 0) { let pk = mn; for (let k = mn; k <= jf; k++) if (s.depth[k] > s.depth[pk]) pk = k;
      if (s.depth[pk] - s.depth[mn] >= 2.5) out.push({ t: s.t[mn] - 0.5, x: `klesání ${nf(s.depth[mn], 1)} → ${nf(s.depth[pk], 1)} m (do ${mmssA(s.t[pk])}) se SP ${nf(s.sp[mn])} (P)` }); }
    for (const x of o2Doses(d)) if (x.kind === "man" && x.t >= from - 120 && x.t < from) out.push({ t: x.t, x: `ruční dávka O₂ (+${nf(x.rise)} bar) před nárůstem (P)` });
    const z = po2HighZones(d, th).filter((z) => z.to >= from - 60 && z.from <= end);
    const w = z.filter((x) => x.level === "warn").reduce((a, x) => a + x.to - x.from, 0);
    if (w > 0) out.push({ t: Infinity, x: `vlastní detekce: nad ${nf(th.po2HiWarn ?? 1.4, 2)} bar celkem ${Math.round(w / 60) || "<1"} min mimo deko` });
  }
  return out.sort((a, b) => a.t - b.t).map((o) => (Number.isFinite(o.t) ? `${mmssA(o.t)} ${o.x}` : o.x));
}
const oneBlock = (d: Dive, from: number, to: number | null, chart: ChartKey, steps: string[]): AlertBlock => ({ head: "", steps, from, to: to ?? d.h.diveTimeS, chart });
const withSteps = (text: string, steps: string[]) => (steps.length ? `${text}\nŘešení:\n${steps.map((x) => "• " + x).join("\n")}` : text);

/** Byla mezi dvěma ponory vyměněna baterie Petrelu? Jiný typ; u NiMH (procenta vždy 100) skok napětí na začátku o ≥ 0,08 V;
 *  u lithiové a alkalické skok procent o ≥ 25 b. (napětí lithiové baterie se po odpočinku samo zvedne až o 0,15 V). */
export function batSwapped(prev: Header, cur: Header): boolean {
  if (prev.batTypeCode !== cur.batTypeCode) return true;
  if (cur.batTypeCode === 3) return cur.batVStart - prev.batVEnd >= 0.08 && cur.batVStart - prev.batVStart >= 0.05;
  return cur.batPctStart - prev.batPctEnd >= 25;
}

/** Ponory od poslední výměny baterie (seřazené podle času, včetně posledního). */
export function batSinceSwap(sorted: Header[]): Header[] {
  let i = sorted.length - 1;
  while (i > 0 && !batSwapped(sorted[i - 1], sorted[i])) i--;
  return sorted.slice(i);
}

/** Text o výměně baterie mezi předchozím a tímto ponorem, jinak null. */
export function batSwapInfo(prev: Header | undefined, cur: Header): Alert | null {
  if (!prev || !batSwapped(prev, cur)) return null;
  const pct = (h: Header, v: number, p: number) => `${v.toFixed(2).replace(".", ",")} V${h.batTypeCode !== 3 ? ` / ${p} %` : ""}`;
  return { level: "info", title: "Baterie vyměněna", kind: "battery", text: `${prev.batTypeCode !== cur.batTypeCode ? `${prev.batType} → ${cur.batType}, ` : ""}${pct(prev, prev.batVEnd, prev.batPctEnd)} → ${pct(cur, cur.batVStart, cur.batPctStart)} proti předchozímu ponoru.` };
}

export function alerts(hs: Header[], nowLocal: number, th: Thresholds, manualFill?: number | null, batSwap?: number | null): Alert[] {
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
  // baterie: jen ponory od poslední výměny (skok napětí / procent nahoru nebo jiný typ)
  if (batSwap != null && batSwap > last.start) return out; // ručně „Baterii jsem vyměnil“ po posledním ponoru
  const since = batSinceSwap(sorted);
  const vs = since.map((h) => h.batVStart);
  const warn = last.batWarn;
  const lith = last.batTypeCode === 2 && last.batPctEnd > 0;
  if (last.batVEnd <= warn || last.batVStart <= warn + th.batMarginV || (lith && last.batPctEnd <= 25)) {
    out.push({ kind: "battery", level: last.batVEnd <= last.batCrit ? "bad" : "warn", title: "Slabá baterie", text: `Napětí na začátku ${last.batVStart.toFixed(2)} V, na konci ${last.batVEnd.toFixed(2)} V${lith ? `, ${last.batPctEnd} %` : ""}, práh varování ${warn.toFixed(2)} V (${last.batType}).` });
  } else if (lith) {
    // lithiová: napětí je ploché a pak náhle spadne – rozhodují procenta z Petrelu
    if (last.batPctEnd < 50) out.push({ kind: "battery", level: "warn", title: "Baterie slábne", text: `Petrel hlásí ${last.batPctEnd} % (${last.batVEnd.toFixed(2)} V). U lithiové baterie napětí drží a pak rychle spadne – připrav náhradní.` });
  } else if (vs.length >= 3) {
    const n = Math.min(vs.length, 6), w = vs.slice(-n);
    const slope = (w[n - 1] - w[0]) / (n - 1);
    if (slope < 0) {
      const dives = Math.floor((w[n - 1] - warn) / -slope);
      if (dives <= 4) out.push({ kind: "battery", level: "warn", title: "Baterie slábne", text: `Napětí na začátku ponoru klesá o ${(-slope * 1000).toFixed(0)} mV na ponor (teď ${w[n - 1].toFixed(2)} V). Práh ${warn.toFixed(2)} V za zhruba ${Math.max(dives, 1)} ponor(y).` });
    }
  }
  return out;
}

/** Podezřelé hodnoty v jednom ponoru. */
export type StartPo2Level = "" | "info" | "warn" | "bad";
/**
 * Nízké pO₂ na začátku ponoru (do dosažení setpointu, max. 5 min): neškodné dohánění setpointu vs. podezření na hypoxii
 * (zavřený ventil O₂). Hodnotí minimum, dobu pod prahem, růst pO₂ při zanořování a tlak O₂.
 */
export function startPo2(d: Dive, th: Thresholds = DEFAULT_THRESHOLDS) {
  const s = d.s, lo = th.po2Lo ?? 0.4, dt = d.h.rateS || 5;
  const empty = { level: "" as StartPo2Level, min: 0, belowS: 0, reachS: 0, reasons: [] as string[], o2From: null as number | null, o2To: null as number | null };
  if (!s.t.length || !s.ppo2.some((v) => v > 0)) return empty;
  const end = startEnd(d, lo);
  const idx = [...Array(end).keys()].filter((i) => s.ppo2[i] > 0);
  const below = idx.filter((i) => s.ppo2[i] < lo);
  if (!below.length) return empty;
  const min = Math.min(...below.map((i) => s.ppo2[i]));
  const belowS = below.length * dt;
  const spRef = Math.max(s.sp[Math.min(end, s.t.length - 1)] || 0.5, lo);
  const reach = s.t.findIndex((_, i) => i > below[0] && s.ppo2[i] >= spRef - 0.05);
  const reasons: string[] = [];
  // tlak O₂ během události
  let o2 = below.map((i) => s.o2p[i]).filter((v): v is number => v != null);
  if (o2.some((v) => v > 0)) { const k = o2.findIndex((v) => v > 0); o2 = o2.slice(k); } // první vzorky bez údaje vysílače
  const hasO2 = s.o2p.some((v) => v != null && v > 0);
  const o2From = o2.length ? o2[0] : null, o2To = o2.length ? o2[o2.length - 1] : null;
  const o2Zero = hasO2 && o2.length > 0 && o2.filter((v) => v <= 0).length * dt >= 15 && !(o2From === 0 && o2.slice(2).every((v) => v > 0));
  // pO₂ při zanořování neroste: hloubka +3 m a víc, pO₂ pod prahem a skoro beze změny
  let flat = false;
  for (let a = 0; a < below.length && !flat; a++) for (let b = a + 1; b < below.length; b++) {
    const i = below[a], j = below[b];
    if (s.t[j] - s.t[i] > 120) break;
    if (s.depth[j] - s.depth[i] >= 3 && s.ppo2[j] - s.ppo2[i] < 0.05 && s.t[j] - s.t[i] >= 45) { flat = true; break; }
  }
  let level: StartPo2Level = "info";
  if (min < (th.po2Hypo ?? 0.21)) reasons.push(`pO₂ kleslo na ${fmtBar(min)} bar`);
  if (belowS > (th.po2LoBadS ?? 120)) reasons.push(`pod ${fmtBar(lo)} bar ${dur(belowS)}`);
  if (o2Zero) reasons.push("tlak O₂ 0 bar");
  if (flat) reasons.push("pO₂ při zanořování neroste");
  if (reasons.length) level = "bad";
  else if (belowS >= (th.po2LoWarnS ?? 30) || min < (th.po2LoMin ?? 0.3)) level = "warn";
  return { level, min, belowS, reachS: reach >= 0 ? s.t[reach] : -1, reasons, o2From, o2To };
}
const fmtBar = (v: number) => v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });

/** Index konce úvodní fáze: pO₂ ≥ práh po dobu ≥ 20 s, nejpozději 5 min. */
function startEnd(d: Dive, lo = 0.4): number {
  const s = d.s, dt = d.h.rateS || 5;
  const e = s.t.findIndex((t, i) => t > 300 || (s.ppo2[i] >= lo && s.ppo2.slice(i, i + Math.ceil(20 / dt)).every((v) => v >= lo)));
  return e < 0 ? s.t.length : e;
}

/** Alarmy nízkého pO₂ z počítače podle fáze: úvod (dohánění setpointu), během ponoru, u hladiny (výstup, po vynoření, SP 0,19). */
export function lowPo2Phases(d: Dive) {
  const s = d.s, out = { start: 0, mid: 0, surface: 0 }, se = startEnd(d);
  for (const a of d.alarms.filter((a) => a.kind === "po2low")) {
    const i = s.t.findIndex((t) => t >= a.start);
    if (a.start >= d.h.diveTimeS || i < 0) out.surface++;
    else if (i <= se + 2) out.start++;
    else if (s.depth[i] < 3 || s.sp[i] < 0.3) out.surface++;
    else out.mid++;
  }
  return out;
}

/** base = osobní základ potápěče z jeho ponorů (zátěž, spotřeba O₂, doplňování diluentu); bez něj se srovnává jen v rámci ponoru. */
export function diveWarnings(d: Dive, sum: Summary, th: Thresholds, base?: EffortBase | null): Alert[] {
  const out: Alert[] = [];
  const co2Bad = co2BadRanges(d);
  const co2V = co2Valid(d).filter((x): x is number => x != null), co2VMax = co2V.length ? Math.max(...co2V) : null;
  if (co2VMax != null && co2VMax >= th.co2Mbar) out.push({ level: "bad", title: "Vysoké CO₂", text: `Maximum ppCO₂ ${co2VMax.toFixed(1)} mbar.` });
  if (co2Bad.length) out.push({ level: "warn", title: "Čidlo CO₂ nejspíš chybné", text: `Hodnoty až ${Math.round(Math.max(...co2Bad.map((r) => r.max)))} mbar, celkem ${dur(co2Bad.reduce((x, r) => x + r.to - r.from, 0))} – fyziologicky nemožné. Pravděpodobná příčina: vlhkost / kondenzace na čidle (P) – zkontroluj a vysuš čidlo, případně ho vyměň.${co2Bad[0].from <= 180 ? " Nesmyslné hodnoty už od hladiny na začátku ponoru." : ""} Tyto úseky se do hlášení, souvislostí a srovnání nepočítají; v grafu zůstávají.`, blocks: co2Bad.map((r, k) => ({ head: co2Bad.length > 1 ? `${k + 1}. ${tpt(r.from)}–${tpt(r.to)}` : "", steps: [], from: r.from, to: r.to, chart: "co2" as ChartKey })) });
  // nízké pO₂ na začátku ponoru – podle průběhu (zavřený ventil O₂ = hypoxie)
  const sp0 = startPo2(d, th);
  if (sp0.level) {
    const lo = th.po2Lo ?? 0.4;
    const det = `Minimum ${fmtBar(sp0.min)} bar, pod ${fmtBar(lo)} bar ${dur(sp0.belowS)}${sp0.reachS >= 0 ? `, setpoint dosažen v ${Math.round(sp0.reachS)}. s` : ", setpoint nedosažen"}`
      + (sp0.o2From != null ? `, tlak O₂ ${sp0.o2From === sp0.o2To ? `${Math.round(sp0.o2From)} bar` : `${Math.round(sp0.o2From)} → ${Math.round(sp0.o2To!)} bar${sp0.o2From > 20 && sp0.o2To! < 20 ? " – přechod na externí lahev?" : ""}`}` : "") + ".";
    if (sp0.level === "bad") out.push({ level: "bad", title: "Podezření na hypoxii při zanoření – zkontroluj ventil O₂", text: `${sp0.reasons.join(", ")}. ${det}` });
    else out.push({ level: sp0.level, title: "Nízké pO₂ při zanoření", text: det + (sp0.level === "info" ? " Smyčka ještě dotahovala setpoint." : "") });
  }
  // varování zobrazená na počítači (tlaky lahví, vyřazené čidlo, chyba CO₂ čidla, neznámá) + alarmy „other“
  const mmss = tpt;
  const ackTxt = (w: CompWarn) => w.how === "ack" ? `potvrzeno v ${mmss(w.end!)}` : w.how === "cleared" ? `zmizelo v ${mmss(w.end!)}` : "nepotvrzeno";
  const at = (t: number) => { const i = d.s.t.findIndex((x) => x >= t); return i < 0 ? d.s.t.length - 1 : i; };
  const cws = computerWarnings(d);
  for (const w of cws.filter((w) => w.kind === "o2press" || w.kind === "dilpress")) {
    const arr = w.kind === "o2press" ? d.s.o2p : d.s.dil, i = at(w.start + 3);
    const gas = w.kind === "o2press" ? "O₂" : "diluentu";
    // tlak po ustálení (2–7 min po varování; vysílač po zapnutí chvíli posílá 0) a tlak těsně před varováním
    const med = (a: number, b: number) => { const v = arr.filter((x, k) => x != null && x > 0 && d.s.t[k] >= a && d.s.t[k] <= b) as number[]; return v.length ? [...v].sort((p, q) => p - q)[v.length >> 1] : null; };
    const settled = med(w.start + 120, w.start + 420) ?? med(w.start, w.start + 120);
    const before = Math.max(0, ...(arr.filter((x, k) => x != null && d.s.t[k] >= w.start - 180 && d.s.t[k] <= w.start) as number[]));
    const now = med(w.start - 5, w.start + 15);
    if (now != null && now >= 3 && now < 20 && !(settled != null && settled < 3)) {
      // v okamžiku varování byl v okruhu mezitlak – externí lahev nebo zavřená onboard lahev
      out.push({ level: "info", title: `Nízký tlak ${gas} – externí lahev`, text: `Varování v ${mmss(w.start)}, ${ackTxt(w)}. Tlak ${Math.round(now)} bar je mezitlak externí lahve (onboard zavřená)${settled != null && settled >= 20 ? `, později ${Math.round(settled)} bar – onboard otevřena` : ""}.` });
    } else if (settled != null && settled >= 3 && settled < 20) {
      if (before >= 50) out.push({ level: "info", title: `Přechod na externí lahev (${gas})`, text: `V ${Math.floor(w.start / 60)}. min (${Math.round(before)} → ${Math.round(settled)} bar), varování ${ackTxt(w)}.` });
      else out.push({ level: "info", title: `Nízký tlak ${gas} – externí lahev`, text: `Varování v ${mmss(w.start)}, ${ackTxt(w)}. Tlak ${Math.round(settled)} bar je mezitlak externí lahve – očekávané.` });
    } else if (settled != null && settled < 3) out.push({ level: "warn", title: `Nízký tlak ${gas} (0 bar)`, text: withSteps(`Varování v ${mmss(w.start)} – tlak spadl k nule a neustálil se na mezitlaku externí lahve. Zdroj odpojený nebo prázdný? ${ackTxt(w)}.`, resolutionSteps(d, w.start, w.end, "press", th)), blocks: [oneBlock(d, w.start, w.end, "press", resolutionSteps(d, w.start, w.end, "press", th))] });
    else out.push({ level: "warn", title: `Nízký tlak ${gas}${settled != null ? ` (${Math.round(settled)} bar)` : ""}`, text: withSteps(`Onboard lahev – varování v ${Math.floor(w.start / 60)}. min (${d.s.depth[i].toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} m), ${ackTxt(w)}.`, resolutionSteps(d, w.start, w.end, "press", th)), blocks: [oneBlock(d, w.start, w.end, "press", resolutionSteps(d, w.start, w.end, "press", th))] });
  }
  const outW = cws.find((w) => w.kind === "cellout"), outA = d.alarms.find((a) => a.label.startsWith("Vyřazené čidlo"));
  if (outW || outA) {
    const t0 = Math.min(outW?.start ?? Infinity, outA?.start ?? Infinity), dc = deviatingCell(d, t0);
    const nA = d.alarms.filter((a) => a.label.startsWith("Vyřazené čidlo")).length;
    out.push({ level: "warn", title: `Vyřazené čidlo${dc ? " " + dc.cell : ""} (P)`, text: withSteps(`Od ${Math.floor(t0 / 60)}. min${outW?.how === "open" || !outW ? " do konce ponoru" : ` do ${mmss(outW.end!)}`}${dc ? ` – čidlo ${dc.cell} se odchylovalo o ${dc.pct} %` : ""}${nA > 1 ? `, alarm opakován ${nA}×` : ""}. Počítač ho pravděpodobně vyřadil z hlasování.`, resolutionSteps(d, t0, outW?.end ?? outA?.end ?? null, "cell", th)), blocks: [oneBlock(d, t0, outW?.end ?? outA?.end ?? null, "po2", resolutionSteps(d, t0, outW?.end ?? outA?.end ?? null, "cell", th))] });
  }
  const co2s = cws.filter((w) => w.kind === "co2sensor"), co2sA = d.alarms.filter((a) => a.label.startsWith("Chyba CO₂"));
  if (co2s.length || co2sA.length) out.push({ level: "warn", title: `Chyba CO₂ čidla (P)${co2s.length > 1 ? ` – ${co2s.length}×` : ""}`, text: `${co2s.length ? `Hlášení v ${co2s.map((w) => `${mmss(w.start)} (${ackTxt(w)})`).join(", ")}` : `Alarm v ${co2sA.map((a) => mmss(a.start)).join(", ")}`}. Hodnoty CO₂ v tomto ponoru ber s rezervou.`, blocks: [...co2s.map((w) => oneBlock(d, w.start, w.end, "co2", [])), ...(co2s.length ? [] : co2sA.map((x) => oneBlock(d, x.start, x.end, "co2", [])))].map((b, k, all) => ({ ...b, head: all.length > 1 ? `${k + 1}. ${tpt(b.from)}` : "" })) });
  const batW = cws.find((w) => w.kind === "battery");
  if (batW) out.push({ level: "warn", title: "Slabá baterie (P)", text: withSteps(`Počítač hlásil slabou baterii v ${mmss(batW.start)}, ${ackTxt(batW)}.`, resolutionSteps(d, batW.start, batW.end, "other", th)), blocks: [oneBlock(d, batW.start, batW.end, "temp", resolutionSteps(d, batW.start, batW.end, "other", th))] });
  const solA = d.alarms.filter((a) => a.label.startsWith("Porucha solenoidu"));
  if (solA.length) {
    // od kdy už jen ruční doplňování O₂ (poslední dávka solenoidem)
    const ds = o2Doses(d), lastSol = [...ds].reverse().find((x) => x.kind === "sol");
    const manFrom = lastSol ? ds.find((x) => x.t > lastSol.t && x.kind === "man") : null;
    out.push({ level: "bad", title: "Porucha solenoidu / baterie v hlavě (P)", text: withSteps(`Alarm poprvé v ${mmss(solA[0].start)}${solA.length > 1 ? `, opakován ${solA.length}×` : ""}.${manFrom ? ` Od ${Math.floor(manFrom.t / 60)}. min jen ruční doplňování O₂.` : ""} Zkontroluj baterii v hlavě a solenoid.`, resolutionSteps(d, solA[0].start, solA[solA.length - 1].end, "other", th)), blocks: [oneBlock(d, solA[0].start, solA[solA.length - 1].end, "po2", resolutionSteps(d, solA[0].start, solA[solA.length - 1].end, "other", th))] });
  }
  for (const w of cws.filter((w) => w.kind === "unknown")) out.push({ level: "info", title: w.label, text: `Zobrazeno v ${mmss(w.start)}, ${ackTxt(w)}.` });
  for (const a of d.alarms.filter((a) => a.label.startsWith("Neznámý alarm"))) out.push({ level: "info", title: a.label, text: `Spuštěn v ${mmss(a.start)}.` });
  const ndl = cws.filter((w) => w.kind === "ndl");
  if (ndl.length) out.push({ level: "info", title: `Nízké NDL${ndl.length > 1 ? ` – ${ndl.length}×` : ""}`, text: ndl.map((w) => `${mmss(w.start)} (${ackTxt(w)}${w.how === "ack" ? `, za ${dur(w.end! - w.start)}` : ""})`).join(", ") + "." });
  // baterie Petrelu v tomto ponoru
  const bvs = d.s.bv.filter((v) => v > 0);
  if (bvs.length && d.h.batWarn > 0) { const bmin = Math.min(...bvs);
    if (bmin < d.h.batCrit) out.push({ level: "bad", title: "Kritická baterie", text: `Napětí kleslo na ${bmin.toFixed(2)} V (kritický práh ${d.h.batCrit.toFixed(2)} V).` });
    else if (bmin < d.h.batWarn) out.push({ level: "warn", title: "Slabá baterie", text: `Napětí kleslo na ${bmin.toFixed(2)} V (práh varování ${d.h.batWarn.toFixed(2)} V).` }); }
  const ph = lowPo2Phases(d);
  if (ph.surface) out.push({ level: "info", title: "Nízké pO₂ u hladiny", text: `Alarm nízkého pO₂ ${ph.surface}× při výstupu k hladině nebo po vynoření – pokles tlaku.` });
  for (const kind of ["co2", "po2high", "po2low"] as const) {
    if (kind === "po2low" && !ph.mid) continue;
    const se = startEnd(d);
    const as = d.alarms.filter((a) => { if (a.kind !== kind || a.start > d.h.diveTimeS) return false; if (kind !== "po2low") return true; const i = d.s.t.findIndex((t) => t >= a.start); return a.start < d.h.diveTimeS && i > se + 2 && d.s.depth[i] >= 3 && d.s.sp[i] >= 0.3; });
    if (!as.length) continue;
    const tot = as.reduce((x, a) => x + alarmEnd(d, a) - a.start, 0);
    const lowSp = kind === "po2low" && as.some((a) => d.s.sp[d.s.t.findIndex((t) => t >= a.start)] < 0.3);
    const blocks: AlertBlock[] = as.map((a, k) => { const e = alarmEnd(d, a); return { head: `${as.length > 1 ? `${k + 1}. alarm ` : ""}${mmss(a.start)}–${mmss(e)} (${dur(e - a.start)})`, steps: resolutionSteps(d, a.start, a.end, kind, th, as[k + 1]?.start ?? Infinity), from: a.start, to: e, chart: kind === "co2" ? "co2" : "po2" }; });
    const steps = blocks.flatMap((b) => [...(as.length > 1 ? [`${b.head}:`] : []), ...b.steps]);
    out.push({ level: kind === "po2low" && lowSp ? "warn" : "bad", title: `${as[0].label} z počítače${lowSp ? " (během setpointu 0,19 před výstupem)" : ""}`,
      text: withSteps(`${as.length}× (${as.map((a) => `${mmss(a.start)}–${mmss(alarmEnd(d, a))}`).join(", ")}), celkem ${dur(tot)}.`, steps), blocks });
  }
  // scrubber vyčerpán během ponoru (časovač Petrelu)
  if (d.h.scrubTotalMin > 0 && d.h.scrubLeftEndMin <= 0) {
    const at0 = d.h.scrubLeftStartMin * 60;
    out.push({ level: "bad", title: "Scrubber vyčerpán během ponoru", text: `${at0 <= 0 ? "Časovač scrubberu byl na nule už na začátku ponoru" : `Časovač scrubberu došel na nulu v ${tpt(at0)} (na začátku zbývalo ${hm(d.h.scrubLeftStartMin)})`}. Nezapomněl jsi obnovit stack time?`, blocks: [{ head: "", steps: [], from: Math.max(0, at0 - 60), to: Math.min(d.h.diveTimeS, at0 + 300), chart: "co2" }] });
  }
  // od určité chvíle jen ruční doplňování O₂ bez alarmu solenoidu
  if (!d.alarms.some((a) => a.label.startsWith("Porucha solenoidu"))) {
    const ds = o2Doses(d), lastSol = [...ds].reverse().find((x) => x.kind === "sol");
    const after = ds.filter((x) => x.kind === "man" && (!lastSol || x.t > lastSol.t));
    // solenoid měl dávkovat: pO₂ aspoň minutu pod setpointem (o víc než 0,1) a přesto žádná jeho dávka
    let under = 0, best = 0;
    if (lastSol) for (let i = at(lastSol.t + 30); i < d.s.t.length && d.s.t[i] <= d.h.diveTimeS; i++) { if (d.s.depth[i] > 3 && d.s.sp[i] >= 0.5 && d.s.ppo2[i] < d.s.sp[i] - 0.1) { under += (d.s.t[i] - d.s.t[i - 1]) || 5; best = Math.max(best, under); } else under = 0; }
    if (lastSol && after.length >= 2 && best >= 60 && d.h.diveTimeS - lastSol.t >= 600) out.push({ level: "info", title: "Jen ruční doplňování O₂ – solenoid nepracoval?", text: `Poslední dávka solenoidu v ${tpt(lastSol.t)}, potom ${after.length}× ruční dávka O₂ do konce ponoru (${dur(d.h.diveTimeS - lastSol.t)}).`, blocks: [{ head: "", steps: [], from: lastSol.t, to: Math.min(d.h.diveTimeS, lastSol.t + 600), chart: "po2" }] });
  }
  // opakované zavírání / otevírání lahve O₂ = ruční dávkování ventilem (např. po selhání solenoidu)
  {
    const v = pressureAnalysis(d.s.t, d.s.o2p, d.h.diveTimeS).valve;
    const opens = v.filter((x) => x.kind === "open");
    if (opens.length > 3) out.push({ level: "info", title: `Ruční dávkování O₂ otevíráním lahve – ${opens.length}× (P)`, text: `${tpt(v[0].t)}–${tpt(v[v.length - 1].t)}: lahev O₂ opakovaně zavírána a otevírána (${v.map((x) => `${tpt(x.t)} ${x.kind === "open" ? "otevřena" : "zavřena"}`).join(", ")}).`, blocks: opens.map((o, k) => ({ head: `${k + 1}. otevřena ${tpt(o.t)}`, steps: [], from: Math.max(0, o.t - 60), to: o.t + 60, chart: "press" as ChartKey })) });
  }
  // vlastní detekce vysokého pO₂ – jen úseky, kdy neběžel alarm z počítače
  {
    const hiA = d.alarms.filter((x) => x.kind === "po2high");
    const zs = po2HighZones(d, th).filter((z) => !hiA.some((x) => x.start <= z.to + 30 && alarmEnd(d, x) >= z.from - 30));
    for (const lvl of ["bad", "warn"] as const) {
      const zl = zs.filter((z) => z.level === lvl && (lvl === "bad" || !zs.some((b) => b.level === "bad" && b.from <= z.to && b.to >= z.from)));
      if (!zl.length) continue;
      const lim = lvl === "bad" ? th.po2HiBad ?? 1.6 : th.po2HiWarn ?? 1.4;
      const around = (z: { from: number; to: number }) => { if (lvl !== "bad") return ""; const w = zs.find((x) => x.level === "warn" && x.from <= z.to && x.to >= z.from); return w ? ` (nad ${(th.po2HiWarn ?? 1.4).toLocaleString("cs-CZ")} bar ${dur(w.to - w.from)})` : ""; };
      const blocks: AlertBlock[] = zl.map((z, k) => ({ head: `${zl.length > 1 ? `${k + 1}. ` : ""}${mmss(z.from)}–${mmss(z.to)} (${dur(z.to - z.from)})${around(z)}, max ${z.max.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} bar, ${d.s.depth[at(z.from)].toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} m`, steps: resolutionSteps(d, z.from, z.to, "po2high", th, zl[k + 1]?.from ?? Infinity).filter((x) => !/alarm|vlastní detekce/.test(x)), from: z.from, to: z.to, chart: "po2" }));
      out.push({ level: lvl, title: "Vysoké pO₂ (bez alarmu počítače)", text: withSteps(`Nad ${lim.toLocaleString("cs-CZ")} bar${lvl === "warn" ? ` déle než ${dur(th.po2HiWarnS ?? 60)} mimo deko zastávky` : ""}: ${zl.map((z) => `${mmss(z.from)}–${mmss(z.to)}`).join(", ")}, celkem ${dur(zl.reduce((x, z) => x + z.to - z.from, 0))}.`, blocks.flatMap((b) => [`${b.head}:`, ...b.steps])), blocks });
    }
  }
  const cs = cellSpread(d);
  if (cs && cs.kind) {
    const nf = (x: number, k = 2) => x.toLocaleString("cs-CZ", { maximumFractionDigits: k });
    const det = `rozdíl až ${nf(cs.max)} bar (${Math.round(cs.at / 60)}. min), nad 0,3 bar celkem ${nf(cs.min, 1)} min`;
    const list = cs.cells.join(" a ");
    if (cs.kind === "wet") out.push({ level: "bad", title: "Podezření na vlhkost na čidlech (zatékání?)", text: `Odchylují se ${cs.cells.length > 1 ? `čidla ${list}` : "víc čidel"} najednou, ${det}; po výstupu se srovnala. Zkontroluj hlavu, čidla a smyčku.` });
    else if (cs.kind === "multi") out.push({ level: "warn", title: `Podezření na vadná čidla${cs.cells.length ? " " + list : ""}`, text: `Víc čidel se odchyluje, ${det}; do konce ponoru se nesrovnala. Zkontroluj čidla.` });
    else out.push({ level: "warn", title: `Podezření na nefunkční čidlo ${cs.kind.slice(1)}`, text: `Čidlo ${cs.kind.slice(1)} se odchyluje od ostatních – ${det}. Zkontroluj nebo vyměň čidlo.` });
  }
  const pl = co2Plausibility(d);
  if (pl && !pl.ok) out.push({ level: "warn", title: "Čidlo CO₂ nejspíš podhodnocuje", text: `Pod 20 m ukazovalo přesnou nulu ${pl.zeroPct} % času (oříznutá nula) – malé hodnoty CO₂ nevidí. Zkontroluj kalibraci; nízké hodnoty ber s rezervou.` });
  const ef = effortOf(d, th.co2Mbar, base);
  if (ef.densOver62 >= 1) out.push({ level: "info", title: "Velmi hustý plyn", text: `Hustota plynu až ${ef.densMax.toLocaleString("cs-CZ")} g/l, ${Math.round(ef.densOver62)} min nad 6,2 g/l – výrazně vyšší dechová práce a riziko hromadění CO₂.` });
  else if (ef.densOver52 >= 1) out.push({ level: "info", title: "Hustý plyn", text: `Hustota plynu až ${ef.densMax.toLocaleString("cs-CZ")} g/l, ${Math.round(ef.densOver52)} min nad doporučenými 5,2 g/l.` });
  // souvislosti CO₂: jedno hlášení (zvlášť varování a informace), každá epizoda s odkazem do grafu
  for (const lv of ["warn", "info"] as const) {
    const ns = ef.co2Notes.filter((c) => c.level === lv);
    if (ns.length) out.push({ level: lv, title: `Souvislost CO₂${ns.length > 1 ? ` – ${ns.length}×` : ""}`, text: ns.map((c) => c.text).join("\n"), blocks: ns.map((c) => ({ head: c.text, steps: [], from: Math.max(0, c.t - 60), to: c.t + 60, chart: "co2" as ChartKey })) });
  }
  // doplňování diluentu (ADV, proplach smyčky / masky): jen výrazně nad osobním mediánem
  { const lim = base?.vents != null ? Math.max(4, Math.ceil(base.vents * 2) + 1) : 5;
    if (ef.vents >= lim) { const vs = dilVents(d); out.push({ level: "info", title: "Časté doplňování diluentu", text: `${ef.vents}× doplnění diluentu bez klesání (ADV, proplach smyčky nebo masky, ruční přidání)${base?.vents != null ? ` – obvykle ${base.vents.toLocaleString("cs-CZ")}× za ponor` : ""}: ${vs.map((t) => `${tpt(t)} (${d.s.depth[at(t)].toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} m)`).join(", ")}.`, blocks: vs.map((t, k) => ({ head: `${k + 1}. ${tpt(t)}`, steps: [], from: Math.max(0, t - 60), to: t + 60, chart: "effort" as ChartKey })) }); } }
  // zvýšená zátěž (skutečná námaha)
  if (ef.high.length) out.push({ level: "info", title: `Zvýšená zátěž${ef.high.length > 1 ? ` – ${ef.high.length}×` : ""}`, text: ef.high.map((h) => `${tpt(h.from)}–${tpt(h.to)} až ${h.max.toLocaleString("cs-CZ")}× obvyklé${h.o2 != null ? `, spotřeba O₂ ${h.o2.toLocaleString("cs-CZ")}×` : ""}${h.co2 ? ", následně nárůst CO₂" : ""}`).join("; ") + ".", blocks: ef.high.map((h) => ({ head: `${tpt(h.from)}–${tpt(h.to)} (${dur(h.to - h.from)}), až ${h.max.toLocaleString("cs-CZ")}×${h.co2 ? ", nárůst CO₂" : ""}`, steps: [], from: h.from, to: h.to, chart: "effort" as ChartKey })) });
  out.push(...spWarnings(d, sum, { ...SP_RULES, lateMin: th.spLateMin ?? 5, osc: th.spOsc ?? 3, descM: th.spDescM ?? 6, po2Bad: th.po2HiBad ?? 1.6 }));
  const mv = [d.s.mv1, d.s.mv2, d.s.mv3];
  mv.forEach((a, k) => {
    const mid = d.s.depth.map((x, i) => (x > 1.5 ? a[i] : null)).filter((x): x is number => x != null);
    if (mid.length && Math.max(...mid) === 0) out.push({ level: "warn", title: `Čidlo ${k + 1} na nule`, text: "Čidlo během ponoru ukazovalo 0 mV – vadné nebo odpojené." });
  });
  // odkazy do grafu u hlášení s časem, která je zatím nemají
  for (const a of out) {
    if (a.blocks) continue;
    if (/při zanoření/.test(a.title)) { const r = d.s.t.findIndex((t, i) => t > 30 && d.s.ppo2[i] >= (th.po2Lo ?? 0.4)); a.blocks = [{ head: "", steps: [], from: 0, to: r > 0 ? d.s.t[r] : 300, chart: "po2" }]; }
    else if (/^Podezření na (vlhkost|vadná|nefunkční)/.test(a.title) && cs?.bands?.length) a.blocks = [{ head: "", steps: [], from: cs.bands[0].from, to: cs.bands[cs.bands.length - 1].to, chart: "po2" }];
    else if (/hustý plyn$/i.test(a.title)) { const g = gasDensity(d), lim = /Velmi/.test(a.title) ? 6.2 : 5.2; const i0 = g.findIndex((v) => v != null && v > lim); const i1 = g.length - 1 - [...g].reverse().findIndex((v) => v != null && v > lim); if (i0 >= 0) a.blocks = [{ head: "", steps: [], from: d.s.t[i0], to: d.s.t[i1], chart: "effort" }]; }
  }
  return out;
}
