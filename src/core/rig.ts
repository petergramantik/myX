// Typ dýchacího přístroje a schopnosti ponoru: co z logu dává smysl ukázat a vyhodnotit.
// Mód počítače je v logu (CC, OC, Gauge…), typ přístroje (eCCR, pSCR…) zadává uživatel u počítače nebo u ponoru.
import type { Dive, Header } from "./shearwater";

export type Rig = "eCCR" | "pSCR" | "OC" | "aSCR" | "mCCR" | "Freedive";
/** Aktivní = umíme vyhodnotit (potkali jsme log); ostatní jsou vidět, ale zašedlé. */
export const RIGS: { id: Rig; label: string; note: string; active: boolean }[] = [
  { id: "eCCR", label: "eCCR", note: "elektronický uzavřený okruh (solenoid, čidla)", active: true },
  { id: "pSCR", label: "pSCR", note: "pasivní polouzavřený okruh", active: true },
  { id: "OC", label: "OC", note: "otevřený okruh", active: false },
  { id: "aSCR", label: "aSCR", note: "aktivní polouzavřený okruh (konstantní průtok)", active: false },
  { id: "mCCR", label: "mCCR", note: "manuální uzavřený okruh", active: false },
  { id: "Freedive", label: "Freedive", note: "nádechové potápění", active: false },
];

/** Počítač měří pO₂ čidly (CC mód nebo zobrazení pO₂). */
export const isCC = (h: Header) => h.mode === "CCR" || h.mode === "pO₂ displej";
/** Počítač počítá dekompresi (v Gauge módu ne). */
export const hasDeco = (h: Header) => h.mode !== "Gauge";
/** Výchozí typ přístroje podle módu počítače (Gauge: neznámý, je potřeba zadat). */
export const defaultRig = (h: Header): Rig | undefined => rigsForMode(h.mode)[0];
/** Typy přístroje, které pro mód počítače dávají smysl (první = výchozí). Gauge: bez eCCR. */
export function rigsForMode(mode: string): Rig[] {
  switch (mode) {
    case "CCR": case "pO₂ displej": return ["eCCR", "mCCR"];
    case "Gauge": return ["pSCR", "OC", "Freedive"];
    case "SCR": return ["aSCR", "pSCR"];
    case "OC": return ["OC"];
    case "Freedive": return ["Freedive"];
    default: return [];
  }
}
/** Podporované kombinace mód + přístroj (ostatní ponory se zatím nezobrazují). */
export function isSupported(h: Header, rig?: Rig): boolean {
  return (isCC(h) && rig === "eCCR") || (h.mode === "Gauge" && rig === "pSCR");
}
/** Typ ponoru pro informaci: „Gauge (pSCR)“. */
export const diveType = (h: Header, rig?: Rig) => `${h.mode}${rig ? ` (${rig})` : ""}`;

const amb = (d: Dive, i: number) => (d.h.surfP || 1013) / 1000 + d.s.depth[i] * (d.h.salinity || 1000) / 1000 * 0.0981;

/** pO₂ zásobního plynu v hloubce (bar) – u polouzavřeného okruhu horní mez pO₂ ve smyčce. */
export function supplyPo2(d: Dive, fo2pct: number): number[] {
  return d.s.t.map((_, i) => Math.round((fo2pct / 100) * amb(d, i) * 100) / 100);
}

/**
 * Odhad pO₂ ve smyčce pSCR (?): při každém nádechu se vypustí 1/poměr vydechovaného objemu (v hloubce),
 * stejné množství zásobního plynu se doplní. Ustálený stav: FO₂ = (F·D − VO₂) / (D − VO₂),
 * D = VE·P / poměr (povrchové l/min), VE = veq · VO₂ (dechový ekvivalent). Výsledek nezávisí na námaze,
 * jen na dechovém ekvivalentu – pásmo pro veq 20 (úsporné dýchání) až 30.
 */
export function pscrLoopPo2(d: Dive, fo2pct: number, ratio: number, veq: number): (number | null)[] {
  const f = fo2pct / 100;
  return d.s.t.map((_, i) => {
    const P = amb(d, i), k = ratio / (veq * P); // VO₂ / D
    if (k >= 1) return 0;
    return Math.max(0, Math.round(((f - k) / (1 - k)) * P * 100) / 100);
  });
}
