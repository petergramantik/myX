// Zátěž a dechová práce: odhad metabolické spotřeby O₂, hustota plynu, nadbytečný diluent a souvislosti s CO₂.
import type { Dive } from "./shearwater";

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

/**
 * Metabolická zátěž: rychlost poklesu pO₂ (bar/min) mezi dávkami O₂ při stálé hloubce, posuvné okno 3 min.
 * Pokles pO₂ ve smyčce = spotřeba O₂ / objem smyčky a na hloubce nezávisí. Šum snímače (malé nárůsty) se odečítá.
 */
export function workload(d: Dive, winS = 180): (number | null)[] {
  const s = d.s, n = s.t.length;
  const dec: number[] = Array(n).fill(0), noise: number[] = Array(n).fill(0), ok: number[] = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (!inDive(d, i) || !inDive(d, i - 1) || Math.abs(s.depth[i] - s.depth[i - 1]) > 0.3) continue;
    const dp = s.ppo2[i] - s.ppo2[i - 1], dt = s.t[i] - s.t[i - 1];
    ok[i] = dt;
    if (dp < 0) dec[i] = -dp; else if (dp < 0.02) noise[i] = dp;
  }
  const out: (number | null)[] = [];
  let a = 0, D = 0, N = 0, T = 0;
  for (let i = 0; i < n; i++) {
    D += dec[i]; N += noise[i]; T += ok[i];
    while (s.t[i] - s.t[a] > winS) { D -= dec[a]; N -= noise[a]; T -= ok[a]; a++; }
    out.push(inDive(d, i) && T >= winS * 0.4 ? Math.round(Math.max(0, D - N) / (T / 60) * 1000) / 1000 : null);
  }
  return out;
}

/**
 * Relativní zátěž (1 = obvyklá úroveň v ponoru). Rychlost poklesu pO₂ se liší mezi nízkým a vysokým setpointem
 * (jiná regulace a mísení ve smyčce), proto se normalizuje zvlášť pro každou fázi setpointu.
 */
export function workloadIndex(d: Dive): (number | null)[] {
  const w = workload(d), hi = d.s.sp.map((v) => v >= 1);
  const med = (h: boolean) => median(w.filter((x, i): x is number => x != null && hi[i] === h && x > 0));
  const mLo = med(false), mHi = med(true);
  return w.map((x, i) => { const m = hi[i] ? mHi : mLo; return x == null || !m ? null : Math.round((x / m) * 100) / 100; });
}

const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

/** Upouštění smyčky / vyfukování masky: pokles tlaku diluentu ≥ 2 bar za ≤ 1 min bez klesání (≤ 1 m). */
export function dilVents(d: Dive): number[] {
  const s = d.s, out: number[] = [];
  let last = -999;
  for (let i = 0; i < s.t.length; i++) {
    if (!inDive(d, i) || s.dil[i] == null || s.dil[i]! < 20) continue;
    const j = s.t.findIndex((t) => t >= s.t[i] + 60);
    if (j < 0 || s.dil[j] == null || s.dil[j]! < 20) continue;
    if (s.dil[i]! - s.dil[j]! >= 2 && s.depth[j] - s.depth[i] <= 1 && s.t[i] - last > 120) { out.push(s.t[i]); last = s.t[i]; }
  }
  return out;
}

export interface Effort {
  wMed: number | null; wHighMin: number;           // 1 = relativní zátěž k dispozici; minuty nad 1,3× obvyklé úrovně
  densMax: number; densOver52: number; densOver62: number; // hustota max (g/l) a minuty nad hranicemi
  vents: number;                                   // upouštění/maska (počet)
  co2Notes: { t: number; level: "info" | "warn"; text: string }[];
}

/** Souhrn zátěže ponoru a souvislosti epizod zvýšeného CO₂ se zátěží a hustotou plynu. */
export function effortOf(d: Dive, co2Limit = 5): Effort {
  const s = d.s, w = workloadIndex(d), dens = gasDensity(d), dt = d.h.rateS || 5;
  const wv = w.filter((x): x is number => x != null);
  const wMed = wv.length >= 10 ? 1 : null;
  const notes: Effort["co2Notes"] = [];
  // epizody CO₂: nad polovinou limitu, vrchol a okolí
  const thr = co2Limit * 0.5;
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
    if (dPeak > 5.2) why.push(`při vysoké hustotě plynu ${dPeak.toLocaleString("cs-CZ")} g/l (vyšší dechová práce)`);
    notes.push({
      t: s.t[pk], level: why.length ? "info" : "warn",
      text: `CO₂ ${(s.co2[pk] ?? 0).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} mbar v ${Math.round(s.t[pk] / 60)}. min ` +
        (why.length ? why.join(" a ") + "." : "bez zvýšené námahy a husté směsi – zkontroluj sorbent a smyčku."),
    });
    i = j + Math.round(120 / dt); // další epizoda nejdřív za 2 min
  }
  return {
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
