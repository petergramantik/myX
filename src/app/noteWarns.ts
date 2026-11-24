// Upozornění ponoru, která závisí na údajích uživatele (lahve v „Před a po ponoru“, nastavení): bailout a SurfGF při vynoření.
import { tankMix, tankVol, type DiveNote, type Meta, type Settings } from "./model";
import { NO_GAS, bailoutPlan, gasLabelOf, type BoPlan } from "../core/bailout";

export const BO_SAC = 20, BO_AIR_MAX = 40, BO_TTS_MUL = 1.5, SURF_GF_LIM = 70;
export const boOpts = (m: Meta, set: Settings) => ({ sac: set.boSac || BO_SAC, airMax: set.boAirMax || BO_AIR_MAX, ttsMul: set.boTtsMul || BO_TTS_MUL, surfP: m.h.surfP, sal: m.h.salinity });

/** BO a deko lahve z „Před a po ponoru“ (tlak před × objem) podle směsi; null = nezadané nebo neúplné. */
export function boTanks(note?: DiveNote): { mix: string; liters: number }[] | null {
  const ts = (note?.prep?.tanks || []).filter((t) => t.role === "bo" || t.role === "deco");
  if (!ts.length) return [];
  const out = ts.map((t) => ({ mix: tankMix(t.gas), l: t.bar != null && tankVol(t) ? t.bar * tankVol(t)! : null }));
  if (out.some((x) => x.l == null || !x.mix)) return null;
  return out.map((x) => ({ mix: x.mix!, liters: Math.round(x.l!) }));
}

/** Bailout: plán podle plynů a souhrn pro dlaždici. */
export function bailoutOf(m: Meta, note: DiveNote | undefined, set: Settings): { plan: BoPlan | null; need: number; have: number | null; t: number; tanks: number; reserve: number | null; short: { gas: string; need: number; have: number; short: number } | null } | null {
  if (!m.sum.boP?.t.length) return null;
  const tanks = boTanks(note);
  const plan = bailoutPlan(m.sum.boP, tanks || [], boOpts(m, set));
  const w = plan.worst;
  if (!w) return null;
  const nTanks = (note?.prep?.tanks || []).filter((t) => t.role === "bo" || t.role === "deco").length;
  if (!tanks || !tanks.length) return { plan: tanks ? null : plan, need: w.total, have: null, t: w.t, tanks: nTanks, reserve: null, short: null };
  const have = tanks.reduce((a, b) => a + b.liters, 0);
  const short = w.short > 0 && w.gas ? { gas: w.gas, need: w.need, have: w.have, short: w.short } : null;
  return { plan, need: w.total, have, t: w.t, tanks: nTanks, reserve: Math.round(((have - w.total) / w.total) * 100), short };
}

export function surfGfOf(m: Meta, set: Settings): { gf: number; lim: number; over: boolean; shallowMin: number | null } | null {
  if (set.surfGfOff || m.sum.surfGF == null) return null;
  const lim = set.surfGfLim || SURF_GF_LIM;
  return { gf: m.sum.surfGF, lim, over: m.sum.surfGF > lim, shallowMin: m.sum.shallowMin ?? null };
}

const mmss = (s: number) => `${Math.floor(s / 60)}′${String(Math.round(s % 60)).padStart(2, "0")}″`;

/** Upozornění pro seznam, detail a ⚠ (název určuje kategorii štítku: „Bailout…“ → BO, „SurfGF…“ → GF). */
export function noteWarns(m: Meta, note: DiveNote | undefined, set: Settings): { level: "warn" | "bad"; title: string; text: string }[] {
  const out: { level: "warn" | "bad"; title: string; text: string }[] = [];
  const bo = bailoutOf(m, note, set);
  if (bo?.short) {
    const g = bo.short.gas === NO_GAS ? "V hloubce, kde žádný zadaný plyn nejde dýchat," : `${gasLabelOf(bo.short.gas)}:`;
    out.push({ level: "warn", title: "Bailout by nestačil", text: `${g} v ${mmss(bo.t)} by bylo potřeba asi ${bo.short.need} l, s sebou ${bo.short.have} l – chybělo ${bo.short.short} l (spotřeba ${set.boSac || BO_SAC} l/min, deko × ${set.boTtsMul || BO_TTS_MUL}).` });
  }
  const sg = surfGfOf(m, set);
  if (sg?.over) out.push({ level: "warn", title: "SurfGF nad hranicí", text: `SurfGF při vynoření ${sg.gf} % (hranice ${sg.lim} %)${sg.shallowMin != null ? `, mělčeji než 7 m ${sg.shallowMin} min` : ""}. Delší poslední zastávka by ho snížila.` });
  return out;
}
