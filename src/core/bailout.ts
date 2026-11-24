// Bailout po ponoru (odhad P): kolik plynu by bylo potřeba při přechodu na otevřený okruh v každém okamžiku ponoru,
// rozdělené podle plynů. Každý plyn se dýchá jen tam, kde to jde (vzduch do nastavené hloubky, EAN a O₂ podle MOD při
// pO₂ 1,6, trimix v celé hloubce); v každém úseku výstupu se použije dostupný plyn s nejvyšším podílem O₂.
import type { Dive } from "./shearwater";

/** Profil pro výpočet: čas (s), hloubka (m), TTS (min), hloubka první zastávky (m). */
export interface BoProfile { t: number[]; z: number[]; tts: number[]; stop: number[] }
export interface BoTank { mix: string; liters: number }
export interface BoOpts { sac: number; airMax: number; ttsMul: number; surfP?: number; sal?: number }
export const NO_GAS = "žádný";

/** Profil z ponoru; step = vzorkování (s) pro uložení v souhrnu, 0 = všechny vzorky. */
export function boProfile(d: Dive, step = 0): BoProfile {
  const s = d.s, p: BoProfile = { t: [], z: [], tts: [], stop: [] };
  let next = 0;
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] > d.h.diveTimeS) break;
    if (step && s.t[i] < next) continue;
    next = s.t[i] + step;
    p.t.push(s.t[i]); p.z.push(Math.round(s.depth[i] * 10) / 10); p.tts.push(s.tts[i] || 0); p.stop.push(s.stop[i] || 0);
  }
  return p;
}

const mixOf = (m: string) => { const [o, h] = m.split("/").map(Number); return { o: o || 21, h: h || 0 }; };
/** Největší hloubka, kde jde plyn dýchat: trimix bez omezení, vzduch do airMax, ostatní MOD při pO₂ 1,6. */
export function gasMaxDepth(mix: string, airMax: number): number {
  const { o, h } = mixOf(mix);
  if (h > 0) return Infinity;
  if (o === 21) return airMax;
  return (1.6 / (o / 100) - 1) * 10;
}
export function gasLabelOf(mix: string): string {
  if (mix === NO_GAS) return "bez plynu";
  const { o, h } = mixOf(mix);
  return h > 0 ? `TMX ${o}/${h}` : o === 21 ? "AIR" : o === 100 ? "O₂" : `EAN${o}`;
}

/** Úseky výstupu z hloubky z: 1 min řešení problému, výstup 9 m/min po 3 m, zbytek TTS (× násobek) na zastávkách. */
function slices(z: number, tts: number, stop: number, mul: number): { d: number; min: number }[] {
  const out = [{ d: z, min: 1 }];
  for (let a = z; a > 0; a -= 3) { const b = Math.max(0, a - 3); out.push({ d: (a + b) / 2, min: (a - b) / 9 }); }
  const rest = Math.max(0, tts * mul - z / 9);
  if (rest > 0) {
    const n = stop > 0 ? Math.max(1, Math.ceil(stop / 3)) : 1;
    for (let j = 1; j <= n; j++) out.push({ d: 3 * j, min: rest / n });
  }
  return out;
}

export interface BoPlan {
  gases: string[]; need: Record<string, (number | null)[]>; total: (number | null)[]; have: Record<string, number>;
  /** nejhorší okamžik: největší nedostatek některého plynu, jinak největší celková potřeba */
  worst: { i: number; t: number; gas: string | null; need: number; have: number; short: number; total: number } | null;
}

export function bailoutPlan(p: BoProfile, tanks: BoTank[], o: BoOpts): BoPlan {
  const P = (d: number) => (o.surfP || 1013) / 1000 + d * 0.0981 * (o.sal || 1000) / 1000;
  const have: Record<string, number> = {};
  for (const t of tanks) have[t.mix] = (have[t.mix] || 0) + t.liters;
  const avail = Object.keys(have).map((m) => ({ m, max: gasMaxDepth(m, o.airMax), o2: mixOf(m).o }));
  const pick = (d: number) => avail.filter((g) => g.max + 0.5 >= d).sort((a, b) => b.o2 - a.o2)[0]?.m ?? NO_GAS;
  const need: Record<string, (number | null)[]> = {};
  const total: (number | null)[] = [];
  let worst: BoPlan["worst"] = null;
  p.t.forEach((t, i) => {
    const z = p.z[i];
    if (z < 3) { total.push(null); for (const k of Object.keys(need)) need[k][i] = null; return; }
    const by: Record<string, number> = {};
    for (const s of slices(z, p.tts[i], p.stop[i], o.ttsMul)) { const g = pick(s.d); by[g] = (by[g] || 0) + o.sac * s.min * P(s.d); }
    let tot = 0;
    for (const [g, l] of Object.entries(by)) {
      need[g] ??= p.t.map(() => null);
      need[g][i] = Math.round(l); tot += l;
    }
    total.push(Math.round(tot));
    let cand = { gas: null as string | null, need: 0, have: 0, short: 0 };
    for (const [g, l] of Object.entries(by)) { const h = g === NO_GAS ? 0 : have[g] || 0, sh = l - h; if (sh > cand.short) cand = { gas: g, need: Math.round(l), have: Math.round(h), short: Math.round(sh) }; }
    const better = !worst || (cand.short > 0 ? cand.short > worst.short : worst.short <= 0 && tot > worst.total);
    if (better) worst = { i, t, ...cand, total: Math.round(tot) };
  });
  const gases = Object.keys(need).sort((a, b) => (a === NO_GAS ? 1 : b === NO_GAS ? -1 : mixOf(a).o - mixOf(b).o));
  return { gases, need, total, have, worst };
}
