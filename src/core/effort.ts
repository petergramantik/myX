// Zátěž a dechová práce: odhad metabolické spotřeby O₂, hustota plynu, nadbytečný diluent a souvislosti s CO₂.
import { LOC } from "../app/i18n";
import type { Dive } from "./shearwater";
import { o2Doses, tpt } from "./analysis";

const amb = (d: Dive, i: number) => (d.h.surfP || 1013) / 1000 + d.s.depth[i] * ((d.h.salinity || 1000) / 1000) * 0.0981;
const inDive = (d: Dive, i: number) => d.s.t[i] <= d.h.diveTimeS && d.s.depth[i] >= 1.5;

/** Hustota dýchaného plynu ve smyčce (g/l): pO₂·32 + pN₂·28 + pHe·4, děleno 22,4 l/mol. */
export function gasDensity(d: Dive): (number | null)[] {
  const s = d.s;
  return s.t.map((_, i) => {
    if (!inDive(d, i)) return null;
    const P = amb(d, i), po2 = Math.min(Math.max(s.ppo2[i], 0), P);
    const he = s.he[i] / 100, n2 = Math.max(0, 1 - s.o2[i] / 100 - he), inert = he + n2 || 1;
    const pIn = P - po2;
    return Math.round(((po2 * 32 + pIn * (n2 / inert) * 28 + pIn * (he / inert) * 4) / 22.4) * 100) / 100;
  });
}

/** Hranice pro nesmyslné CO₂ (mbar): vytrvale nad ní = chyba čidla, ne skutečná hodnota. */
export const CO2_BAD = 100;
/** Úseky, kdy čidlo CO₂ ukazovalo nesmysl (nad 100 mbar aspoň minutu, včetně náběhu nad 20 mbar kolem). */
export function co2BadRanges(d: Dive): { from: number; to: number; max: number }[] {
  const s = d.s, n = s.t.length, out: { from: number; to: number; max: number }[] = [];
  let i = 0;
  while (i < n) {
    if ((s.co2[i] ?? 0) <= CO2_BAD) { i++; continue; }
    let a = i, b = i;
    while (b + 1 < n && ((s.co2[b + 1] ?? CO2_BAD + 1) > CO2_BAD || (s.co2[b + 1] == null))) b++;
    if (s.t[b] - s.t[a] >= 60) {
      while (a > 0 && (s.co2[a - 1] ?? 21) > 20) a--;
      while (b + 1 < n && (s.co2[b + 1] ?? 21) > 20) b++;
      const prev = out[out.length - 1];
      const max = Math.max(...(s.co2.slice(a, b + 1).filter((v) => v != null) as number[]));
      if (prev && s.t[a] - prev.to <= 120) { prev.to = s.t[b]; prev.max = Math.max(prev.max, max); } else out.push({ from: s.t[a], to: s.t[b], max });
    }
    i = b + 1;
  }
  return out;
}
/** CO₂ bez úseků chybného čidla (pro hlášení, souvislosti a srovnání). */
export function co2Valid(d: Dive): (number | null)[] {
  const r = co2BadRanges(d);
  return r.length ? d.s.co2.map((v, i) => (r.some((x) => d.s.t[i] >= x.from && d.s.t[i] <= x.to) ? null : v)) : d.s.co2;
}

/**
 * Metabolická zátěž: rychlost poklesu pO₂ (bar/min) mezi dávkami O₂ při stálé hloubce nebo výstupu (opraveno o změnu tlaku), posuvné okno 3 min.
 * Pokles pO₂ ve smyčce = spotřeba O₂ / objem smyčky a na hloubce nezávisí. Šum snímače (malé nárůsty) se odečítá.
 */
/** Důvod, proč se v daném vzorku zátěž nepočítá (rušivý zásah do smyčky), jinak "". */
export function workloadSkip(d: Dive): string[] {
  const s = d.s, n = s.t.length, out: string[] = Array(n).fill("");
  const mark = (t0: number, t1: number, why: string) => { for (let i = 0; i < n; i++) if (s.t[i] >= t0 && s.t[i] <= t1 && !out[i]) out[i] = why; };
  const idx = (t: number) => { const k = s.t.findIndex((x) => x >= t); return k < 0 ? n - 1 : k; };
  // po přepnutí SP: dokud pO₂ nedosáhne nového setpointu (±0,05) + 30 s na promíchání, nejvýš 4 min
  for (let i = 1; i < n; i++) if (Math.abs(s.sp[i] - s.sp[i - 1]) >= 0.1) {
    let k = i; while (k < n - 1 && s.t[k] - s.t[i] < 240 && Math.abs(s.ppo2[k] - s.sp[k]) > 0.05) k++;
    mark(s.t[i], Math.min(s.t[i] + 240, s.t[k] + 30), "po přepnutí SP");
  }
  // po ruční dávce O₂ (z analýzy dávek): dokud pO₂ stoupá + 30 s, nejvýš 3 min
  for (const x of o2Doses(d)) if (x.kind === "man" || x.kind === "amb") {
    let k = idx(x.t); const k0 = k; while (k < n - 1 && s.t[k] - s.t[k0] < 180 && s.ppo2[k + 1] > s.ppo2[k]) k++;
    mark(x.t, Math.min(x.t + 180, s.t[k] + 30), "po ruční dávce O₂");
  }
  for (const t of dilVents(d)) mark(t, t + 90, "po doplnění diluentu");
  return out;
}

export function workload(d: Dive, winS = 180): (number | null)[] {
  const s = d.s, n = s.t.length, skip = workloadSkip(d);
  const dec: number[] = Array(n).fill(0), noise: number[] = Array(n).fill(0), ok: number[] = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (skip[i]) continue;
    // klesání přidává diluent (mění podíl O₂) → jen stálá hloubka nebo výstup; úsek od 3 m k hladině vynechat
    if (!inDive(d, i) || !inDive(d, i - 1) || s.depth[i] - s.depth[i - 1] > 0.3 || s.depth[i] < 3 || s.depth[i - 1] < 3) continue;
    // pokles pO₂ opravený o změnu okolního tlaku: (podíl O₂ teď − předtím) × tlak teď = spotřeba / objem smyčky
    const P0 = amb(d, i - 1), P1 = amb(d, i);
    const dp = (s.ppo2[i] / P1 - s.ppo2[i - 1] / P0) * P1, dt = s.t[i] - s.t[i - 1];
    ok[i] = dt;
    if (dp < 0) dec[i] = -dp; else if (dp < 0.02) noise[i] = dp;
  }
  const out: (number | null)[] = [];
  let a = 0, D = 0, N = 0, T = 0;
  for (let i = 0; i < n; i++) {
    D += dec[i]; N += noise[i]; T += ok[i];
    while (s.t[i] - s.t[a] > winS) { D -= dec[a]; N -= noise[a]; T -= ok[a]; a++; }
    // i v rušeném úseku, když má okno dost čistých vzorků (rušené vzorky se do okna nepočítají)
    out.push(inDive(d, i) && T >= winS * 0.4 ? Math.round(Math.max(0, D - N) / (T / 60) * 1000) / 1000 : null);
  }
  return out;
}

/**
 * Relativní zátěž (1 = obvyklá úroveň v ponoru). Rychlost poklesu pO₂ se liší mezi nízkým a vysokým setpointem
 * (jiná regulace a mísení ve smyčce), proto se normalizuje zvlášť pro každou fázi setpointu.
 */
/** Základ zátěže ponoru: medián rychlosti poklesu pO₂ zvlášť při nízkém a vysokém setpointu (bar/min). */
export function workloadBase(d: Dive): { lo: number | null; hi: number | null } {
  const w = workload(d), hi = d.s.sp.map((v) => v >= 1);
  const m = (h: boolean) => { const a = w.filter((x, i): x is number => x != null && hi[i] === h && x > 0); return a.length >= 24 ? median(a) : null; };
  return { lo: m(false), hi: m(true) };
}
/**
 * Relativní zátěž (1 = obvyklá úroveň). Normuje se osobním základem potápěče (medián z jeho ponorů, zvlášť nízký a vysoký setpoint),
 * když je k dispozici; jinak základem tohoto ponoru.
 */
export function workloadIndex(d: Dive, base?: { lo: number | null; hi: number | null } | null): (number | null)[] {
  const w = workload(d), hi = d.s.sp.map((v) => v >= 1), own = workloadBase(d);
  const mLo = base?.lo ?? own.lo ?? own.hi, mHi = base?.hi ?? own.hi ?? own.lo;
  return w.map((x, i) => { const m = hi[i] ? mHi : mLo; return x == null || !m ? null : Math.round((x / m) * 100) / 100; });
}

const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

/** Doplnění diluentu (ADV, proplach smyčky nebo masky, ruční přidání): pokles tlaku diluentu ≥ 2 bar za ≤ 1 min bez klesání (≤ 1 m). */
export function dilVents(d: Dive): number[] {
  const s = d.s, out: number[] = [];
  let last = -999;
  for (let i = 0; i < s.t.length; i++) {
    if (!inDive(d, i) || s.dil[i] == null || s.dil[i]! < 20) continue;
    const j = s.t.findIndex((t) => t >= s.t[i] + 60);
    if (j < 0 || s.dil[j] == null || s.dil[j]! < 20) continue;
    if (s.dil[i]! - s.dil[j]! >= 2 && Math.max(...s.depth.slice(i, j + 1)) - s.depth[i] <= 1 && s.t[i] - last > 120) { out.push(s.t[i]); last = s.t[i]; }
  }
  return out;
}

/** Spotřeba O₂ z tlaku on-board lahve v oknech 10 min (bar/min); null, kde lahev zavřená nebo skok tlaku. */
export function o2RateWindows(d: Dive, winS = 600): { from: number; to: number; rate: number }[] {
  const s = d.s, out: { from: number; to: number; rate: number }[] = [];
  const med = (a: number[]) => median(a);
  for (let t0 = 0; t0 + winS <= d.h.diveTimeS; t0 += winS / 2) {
    const idx = s.t.map((t, i) => i).filter((i) => s.t[i] >= t0 && s.t[i] <= t0 + winS);
    const p = idx.map((i) => s.o2p[i]);
    if (p.some((v) => v == null || v < 20) || idx.length < 20) continue;
    if (p.some((v, k) => k > 0 && Math.abs(v! - p[k - 1]!) > 15)) continue; // skok = ventil nebo dávka, ne spotřeba
    const a = med(p.slice(0, 12) as number[]), b = med(p.slice(-12) as number[]);
    if (a - b >= 0) out.push({ from: t0, to: t0 + winS, rate: Math.round(((a - b) / (winS / 60)) * 100) / 100 });
  }
  return out;
}

export interface Effort {
  wMed: number | null; wHighMin: number;           // 1 = relativní zátěž k dispozici; minuty nad 1,3× obvyklé úrovně
  densMax: number; densOver52: number; densOver62: number; // hustota max (g/l) a minuty nad hranicemi
  vents: number;                                   // doplnění diluentu (počet)
  co2Notes: { t: number; level: "info" | "warn"; text: string }[];
  /** úseky skutečně zvýšené zátěže: index > 2× základu aspoň 3 min (a spotřeba O₂ > 1,5×, je-li k dispozici) */
  high: { from: number; to: number; max: number; o2: number | null; co2: boolean }[];
}
export interface EffortBase { lo: number | null; hi: number | null; o2?: number | null; vents?: number | null }

/** Souhrn zátěže ponoru a souvislosti epizod zvýšeného CO₂ se zátěží a hustotou plynu. */
export function effortOf(d: Dive, co2Limit = 5, base?: EffortBase | null): Effort {
  const s = { ...d.s, co2: co2Valid(d) }, w = workloadIndex(d, base), dens = gasDensity(d), dt = d.h.rateS || 5;
  const wv = w.filter((x): x is number => x != null);
  const wMed = wv.length >= 10 ? 1 : null;
  const notes: Effort["co2Notes"] = [];
  // epizody CO₂: nad polovinou limitu, vrchol a okolí (jen u věrohodného čidla)
  const thr = co2Plausibility(d)?.ok === false ? Infinity : co2Limit * 0.5;
  for (let i = 0; i < s.t.length; i++) {
    const c = s.co2[i];
    if (c == null || c < thr || !inDive(d, i)) continue;
    let j = i, pk = i;
    while (j + 1 < s.t.length && (s.co2[j + 1] ?? 0) >= thr * 0.8) { j++; if ((s.co2[j] ?? 0) > (s.co2[pk] ?? 0)) pk = j; }
    const from = s.t.findIndex((t) => t >= s.t[pk] - 180);
    const wWin = w.slice(Math.max(0, from), pk + 1).filter((x): x is number => x != null);
    const wPeak = wWin.length ? Math.max(...wWin) : null;
    const dPeak = dens[pk] ?? 0;
    const why: string[] = [];
    if (wMed && wPeak != null && wPeak > wMed * 1.3) why.push(`při vyšší námaze (spotřeba O₂ ${Math.round((wPeak / wMed) * 100 - 100)} % nad průměrem ponoru)`);
    if (dPeak > 5.2) why.push(`při vysoké hustotě plynu ${dPeak.toLocaleString(LOC)} g/l (vyšší dechová práce)`);
    notes.push({
      t: s.t[pk], level: why.length ? "info" : "warn",
      text: `CO₂ ${(s.co2[pk] ?? 0).toLocaleString(LOC, { maximumFractionDigits: 1 })} mbar v ${tpt(s.t[pk])} ` +
        (why.length ? why.join(" a ") + "." : "bez zvýšené námahy a husté směsi – zkontroluj sorbent a smyčku."),
    });
    i = j + Math.round(120 / dt); // další epizoda nejdřív za 2 min
  }
  // zvýšená zátěž: index > 2 aspoň 3 min
  const high: Effort["high"] = [];
  const o2w = o2RateWindows(d), o2Base = base?.o2 ?? (o2w.length >= 3 ? median(o2w.map((x) => x.rate)) : null);
  for (let i = 0, a = -1; i <= s.t.length; i++) {
    const on = i < s.t.length && (w[i] ?? 0) > 2;
    if (on && a < 0) a = i;
    if (!on && a >= 0) {
      const from = s.t[a], to = s.t[i - 1];
      if (to - from >= 180) {
        const win = o2w.filter((x) => x.to >= from && x.from <= to);
        const o2 = win.length && o2Base ? Math.max(...win.map((x) => x.rate)) / o2Base : null;
        if (o2 == null || o2 > 1.5) {
          const c0 = s.co2[a] ?? null, cAfter = (s.co2.slice(a, Math.min(s.t.length, i + Math.round(180 / dt))).filter((v) => v != null) as number[]);
          high.push({ from, to, max: Math.max(...(w.slice(a, i).filter((v) => v != null) as number[])), o2: o2 != null ? Math.round(o2 * 10) / 10 : null, co2: c0 != null && cAfter.length > 0 && Math.max(...cAfter) - c0 > 1 });
        }
      }
      a = -1;
    }
  }
  return {
    high,
    wMed, wHighMin: wMed ? wv.filter((x) => x > wMed * 1.3).length * dt / 60 : 0,
    densMax: Math.max(0, ...dens.filter((x): x is number => x != null)),
    densOver52: dens.filter((x) => x != null && x > 5.2).length * dt / 60,
    densOver62: dens.filter((x) => x != null && x > 6.2).length * dt / 60,
    vents: dilVents(d).length, co2Notes: notes,
  };
}

/** Úroveň zátěže ponoru proti osobnímu průměru (medián přes ponory). */
export function effortLevel(w: number | null, personal: number | null): "klidně" | "střední" | "vysoká" | null {
  if (w == null || !personal) return null;
  return w > personal * 1.25 ? "vysoká" : w < personal * 0.85 ? "klidně" : "střední";
}

/**
 * Věrohodnost čidla CO₂: když čidlo měří (není celou dobu nula), ale pod 20 m ukazuje přesnou nulu víc než 30 % času,
 * je nula nejspíš „oříznutá“ (posunutá nula / nízká citlivost) a malé skutečné hodnoty nevidí.
 */
export function co2Plausibility(d: Dive): { ok: boolean; zeroPct: number } | null {
  const s = d.s;
  const deep = s.t.map((_, i) => i).filter((i) => s.co2raw[i] != null && s.depth[i] >= 20 && s.t[i] <= d.h.diveTimeS);
  const any = s.co2raw.some((v) => v != null && v > 0);
  if (!any || deep.length < 20) return null;
  const z = deep.filter((i) => s.co2raw[i] === 0).length / deep.length;
  return { ok: z <= 0.3, zeroPct: Math.round(z * 100) };
}
