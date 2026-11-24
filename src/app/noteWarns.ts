// Upozornění ponoru, která závisí na údajích uživatele (lahve v „Před a po ponoru“, nastavení): bailout a SurfGF při vynoření.
import { tankVol, type DiveNote, type Meta, type Settings } from "./model";

export const BO_SAC = 20, SURF_GF_LIM = 70;

/** Bailout: potřeba v nejhorším okamžiku (l) proti plynu v bailout lahvích (BO a deko lahve, tlak před ponorem × objem). */
export function bailoutOf(m: Meta, note: DiveNote | undefined, set: Settings): { need: number; have: number | null; t: number; tanks: number; reserve: number | null } | null {
  if (m.sum.boK == null || !m.sum.boK) return null;
  const sac = set.boSac || BO_SAC;
  const tanks = (note?.prep?.tanks || []).filter((t) => t.role === "bo" || t.role === "deco");
  const vols = tanks.map((t) => (t.bar != null && tankVol(t) ? t.bar * tankVol(t)! : null));
  const have = tanks.length && vols.every((v) => v != null) ? Math.round(vols.reduce((a, b) => a! + b!, 0)!) : null;
  const need = Math.round(m.sum.boK * sac);
  return { need, have, t: m.sum.boT || 0, tanks: tanks.length, reserve: have != null ? Math.round(((have - need) / need) * 100) : null };
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
  if (bo && bo.have != null && bo.have < bo.need)
    out.push({ level: "warn", title: "Bailout by nestačil", text: `V ${mmss(bo.t)} by při přechodu na bailout bylo potřeba asi ${bo.need} l (spotřeba ${set.boSac || BO_SAC} l/min), s sebou ${bo.have} l – chybělo ${bo.need - bo.have} l.` });
  const sg = surfGfOf(m, set);
  if (sg?.over) out.push({ level: "warn", title: "SurfGF nad hranicí", text: `SurfGF při vynoření ${sg.gf} % (hranice ${sg.lim} %)${sg.shallowMin != null ? `, mělčeji než 7 m ${sg.shallowMin} min` : ""}. Delší poslední zastávka by ho snížila.` });
  return out;
}
