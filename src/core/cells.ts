// O₂ čidla: citlivost (mV/bar) z každého ponoru, linearita, rychlost reakce, odhad výměn a kalibrací.
import type { Dive } from "./shearwater";
import { cellCalibration, injections } from "./analysis";

/** Údaje o čidlech z jednoho ponoru (pozice 1–3). */
export interface CellDive {
  mvBar: (number | null)[];  // citlivost v mV na 1 bar O₂ (= 1 / kalibrační faktor)
  lin: (number | null)[];    // poměr čidla vůči průměru při pO₂ > 1,15 ku 0,5–1,0 (1 = lineární; < 0,9 = current limiting)
  early: (number | null)[];  // podíl nárůstu po vstřiku O₂ v prvním vzorku (nižší = pomalejší čidlo)
}

const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export function cellsOfDive(d: Dive): CellDive {
  const cal = cellCalibration(d);
  const mvs = [d.s.mv1, d.s.mv2, d.s.mv3];
  const lin = mvs.map((mv, k) => {
    const c = cal[k];
    if (!c) return null;
    const hi: number[] = [], lo: number[] = [];
    for (let i = 0; i < mv.length; i++) {
      if (d.s.depth[i] < 1.5 || d.s.ppo2[i] <= 0) continue;
      const r = (mv[i] * c) / d.s.ppo2[i];
      if (d.s.ppo2[i] > 1.15) hi.push(r); else if (d.s.ppo2[i] > 0.5 && d.s.ppo2[i] < 1.0) lo.push(r);
    }
    return hi.length >= 30 && lo.length >= 30 ? Math.round((med(hi) / med(lo)) * 100) / 100 : null;
  });
  const inj = injections(d);
  const idx = new Map(d.s.t.map((t, i) => [t, i]));
  const early = mvs.map((mv, k) => {
    const c = cal[k];
    if (!c) return null;
    const f: number[] = [];
    for (const x of inj) {
      const i = idx.get(x.t);
      if (i == null || i + 3 >= mv.length) continue;
      const tot = (mv[i + 3] - mv[i]) * c;
      if (tot < 0.03) continue;
      f.push(((mv[i + 1] - mv[i]) * c) / tot);
    }
    return f.length >= 5 ? Math.round(med(f) * 100) / 100 : null;
  });
  return { mvBar: cal.map((c) => (c ? Math.round((1 / c) * 10) / 10 : null)), lin, early };
}

export interface CellEvent { kind: "change" | "cal"; pos: number[]; index: number; tentative?: boolean } // index = pořadí ponoru (0 = nejstarší)

/** Najde pravděpodobné výměny čidel a kalibrace.
 *  Výměna: citlivost vyskočí nahoru o ≥ 10 % proti mediánu 3 předchozích ponorů a další ponor nový stav potvrdí
 *  (u posledního ponoru jen „možná“), nebo čidlo začne znovu dávat signál. Pokles citlivosti se jako výměna nebere – to je stárnutí.
 *  Kalibrace: posun citlivosti ≥ 1,5 % u aspoň dvou čidel. */
export function detectCellEvents(series: CellDive[]): CellEvent[] {
  const out: CellEvent[] = [];
  for (let n = 1; n < series.length; n++) {
    const changed: number[] = [], shifted: number[] = [];
    let tentative = false;
    for (let k = 0; k < 3; k++) {
      const cur = series[n].mvBar[k];
      if (cur == null) continue;
      const last = series[n - 1].mvBar[k];
      if (last == null) { changed.push(k + 1); continue; }
      const prev = series.slice(Math.max(0, n - 3), n).map((s) => s.mvBar[k]).filter((x): x is number => x != null);
      const ref = med(prev);
      const next = series[n + 1]?.mvBar[k];
      if ((cur - ref) / ref >= 0.1 && (cur - last) / last >= 0.08) {
        if (next == null) { changed.push(k + 1); tentative = true; }
        else if (Math.abs(next - cur) / cur < 0.06) changed.push(k + 1);
        else if (Math.abs(cur - last) / last >= 0.015) shifted.push(k + 1);
      } else if (Math.abs(cur - last) / last >= 0.015) shifted.push(k + 1);
    }
    if (changed.length) out.push({ kind: "change", pos: changed, index: n, tentative });
    else if (shifted.length >= 2) out.push({ kind: "cal", pos: shifted, index: n });
  }
  return out;
}

export interface CellThresholds { cellLifeM: number; cellMaxM: number; cellAirWarn: number; cellAirBad: number; cellDropPct: number; cellLinWarn: number }
export const DEFAULT_CELL_TH: CellThresholds = { cellLifeM: 12, cellMaxM: 18, cellAirWarn: 9, cellAirBad: 8, cellDropPct: 15, cellLinWarn: 0.9 };

export interface CellStatus { level: "ok" | "info" | "warn" | "bad"; reasons: string[] }

/** Stav čidla na pozici k z posledních ponorů. ageM = stáří od instalace (měsíce), madeM = od výroby, life = životnost čidla.
 *  ref = ponory starší 30–120 dní (pro pokles citlivosti; porovnává se medián s mediánem dvou posledních ponorů). */
export function cellStatus(k: number, recent: CellDive[], th: CellThresholds, ageM: number | null, madeM: number | null, life: number | null, ref: CellDive[]): CellStatus {
  const reasons: string[] = [];
  let level: CellStatus["level"] = "ok";
  const up = (l: CellStatus["level"]) => { const o = ["ok", "info", "warn", "bad"]; if (o.indexOf(l) > o.indexOf(level)) level = l; };
  const last = recent[recent.length - 1];
  const mvb = last?.mvBar[k] ?? null;
  if (mvb != null) {
    const air = mvb * 0.21;
    if (air < th.cellAirBad) { up("bad"); reasons.push(`Jen ${air.toFixed(1).replace(".", ",")} mV na vzduchu (hranice ${th.cellAirBad} mV)`); }
    else if (air < th.cellAirWarn) { up("warn"); reasons.push(`${air.toFixed(1).replace(".", ",")} mV na vzduchu – pod ${th.cellAirWarn} mV`); }
    const refV = ref.map((r) => r.mvBar[k]).filter((x): x is number => x != null);
    const curV = recent.slice(-2).map((r) => r.mvBar[k]).filter((x): x is number => x != null);
    if (refV.length && curV.length) {
      const a = med(refV), b = curV.reduce((x, y) => x + y, 0) / curV.length;
      const drop = ((a - b) / a) * 100;
      if (drop >= th.cellDropPct) { up("warn"); reasons.push(`Citlivost klesla o ${Math.round(drop)} % proti ponorům před 1–4 měsíci`); }
    }
  } else if (last) { up("warn"); reasons.push("V posledním ponoru bez signálu"); }
  const lin = last?.lin[k];
  if (lin != null && lin < th.cellLinWarn) { up("bad"); reasons.push(`Podezření na current limiting – při vysokém pO₂ ukazuje o ${Math.round((1 - lin) * 100)} % méně`); }
  const lifeM = life || th.cellLifeM;
  // stáří samo o sobě nikdy není červené – jen oranžové, dokud čidlo dává funkční hodnoty
  const fine = level === "ok" || level === "info";
  const tail = fine ? ", hodnoty zatím v pořádku" : "";
  if (ageM != null && ageM >= th.cellMaxM) { up("warn"); reasons.push(`Za životností: ${Math.floor(ageM)} měsíců od výměny (max. ${th.cellMaxM})${tail}`); }
  else if (ageM != null && ageM >= lifeM) { up("warn"); reasons.push(`Za životností: ${Math.floor(ageM)} měsíců od výměny (životnost ${lifeM})${tail}`); }
  if (madeM != null && madeM >= th.cellMaxM) { up("warn"); reasons.push(`Za životností: ${Math.floor(madeM)} měsíců od výroby (max. ${th.cellMaxM})${tail}`); }
  return { level, reasons };
}
