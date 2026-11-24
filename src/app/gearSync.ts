// Výstroj ↔ ponory: zbytkový tlak lahví po ponoru. Zavřená lahev (beze změny bez tlaku, mezitlak v logu, chybějící tlak)
// tlak nepřepíše – u lahve se objeví „zkontrolovat“.
import type { Logbook, Meta } from "./model";

/** Pod touto hodnotou počítač měří jen mezitlak (lahev zavřená). */
const CLOSED = 20;
const dd = (sec: number) => new Date(sec * 1000).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });

/** Off-board lahve z „Před a po ponoru“ s vazbou na Výstroj → zbytkový tlak. Vrací true, když se něco změnilo. */
export function gearTankApply(lb: Logbook, diveId: string, meta?: Meta): boolean {
  const prep = lb.notes[diveId]?.prep;
  if (!prep?.tanks?.length || !lb.tanks) return false;
  const endT = meta ? meta.start + meta.h.diveTimeS : Math.floor(Date.now() / 1000);
  let ch = false;
  for (const t of prep.tanks) {
    const g = t.gearId ? lb.tanks[t.gearId] : undefined;
    if (!g) continue;
    const end = t.same ? t.bar : t.end;
    if (g.fromDive?.id === diveId && g.fromDive.end === end) continue;  // už převzato
    if ((g.barAt || 0) > endT * 1000 && g.fromDive?.id !== diveId) continue; // novější údaj (pozdější ponor nebo ruční zadání)
    if (end == null) lb.tanks[g.id] = { ...g, check: { at: Date.now(), text: `po ponoru ${meta ? dd(meta.start) : ""} chybí tlak „po“ – zkontroluj` }, fromDive: { id: diveId, end }, updated: Date.now() };
    else lb.tanks[g.id] = { ...g, bar: end, barAt: endT * 1000, check: undefined, fromDive: { id: diveId, end }, updated: Date.now() };
    ch = true;
  }
  return ch;
}

/** On-board lahve (O₂ / diluent) z Výstroje: tlak na konci posledního ponoru z logu. */
export function gearOnboardApply(lb: Logbook, last: Meta): boolean {
  let ch = false;
  const endT = (last.start + last.h.diveTimeS) * 1000;
  for (const g of Object.values(lb.tanks || {})) {
    if (!g.onboard || g.fromDive?.id === last.id || (g.barAt || 0) > endT) continue;
    const start = g.onboard === "o2" ? last.sum.o2Start : last.sum.dilStart, end = g.onboard === "o2" ? last.sum.o2End : last.sum.dilEnd;
    const closed = end == null || end < CLOSED || (start != null && start < CLOSED);
    lb.tanks![g.id] = closed
      ? { ...g, check: { at: Date.now(), text: `po ponoru ${dd(last.start)} ${end == null ? "počítač tlak nezná" : "lahev byla zavřená (jen mezitlak)"} – zkontroluj` }, fromDive: { id: last.id }, updated: Date.now() }
      : { ...g, bar: Math.round(end!), barAt: endT, check: undefined, fromDive: { id: last.id, end: Math.round(end!) }, updated: Date.now() };
    ch = true;
  }
  return ch;
}
