// Výstroj ↔ ponory: zbytkový tlak lahví po ponoru. Zavřená lahev (beze změny bez tlaku, mezitlak v logu, chybějící tlak)
// tlak nepřepíše – u lahve se objeví „Ověřit“. On-board lahve rebreatheru (RB O2 n / RB DIL n) se po ponoru rozpoznají
// podle směsi diluentu z logu a tlaku na začátku ponoru proti zbytkovému tlaku lahve.
import { tankMix, uid, type GearTank, type Logbook, type Meta } from "./model";

/** Pod touto hodnotou počítač měří jen mezitlak (lahev zavřená). */
const CLOSED = 20;
/** Tolerance tlaku při rozpoznání lahve (teplota, přesnost snímače). */
export const RB_TOL = 15;
const dd = (sec: number) => new Date(sec * 1000).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
export type RbRole = "o2" | "dil";
export const RB_PREFIX: Record<RbRole, string> = { o2: "RB O2", dil: "RB DIL" };

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
    if (end == null) lb.tanks[g.id] = { ...g, check: { at: Date.now(), text: `po ponoru ${meta ? dd(meta.start) : ""} chybí tlak „po“` }, fromDive: { id: diveId, end }, updated: Date.now() };
    else lb.tanks[g.id] = { ...g, bar: end, barAt: endT * 1000, check: undefined, fromDive: { id: diveId, end }, updated: Date.now() };
    ch = true;
  }
  return ch;
}

/** Směs diluentu v ponoru („21/35“) – nejdéle dýchaná. */
export const diveDilMix = (m: Meta) => [...(m.sum.gases || [])].sort((a, b) => b.s - a.s)[0]?.mix ?? null;
const sameMix = (a: string | null, b: string | null) => !!a && !!b && a.split("/").map(Number).join("/") === b.split("/").map(Number).join("/");

/** Rozpoznání on-board lahve: směs (diluent), pak tlak na začátku (z logu, jinak zadaný „před“) proti zbytkovému tlaku. */
export function rbMatch(lb: Logbook, m: Meta, role: RbRole): { id: string | null; why: string } {
  const cand = Object.values(lb.tanks || {}).filter((t) => t.onboard === role);
  if (!cand.length) return { id: null, why: "žádná lahev" };
  let c = cand;
  if (role === "dil") {
    const mix = diveDilMix(m);
    c = cand.filter((t) => sameMix(tankMix(t.mix), mix));
    if (!c.length) return { id: null, why: `směs ${mix ?? "?"} nemá žádná lahev` };
  }
  if (c.length === 1) return { id: c[0].id, why: role === "dil" && cand.length > 1 ? "podle směsi" : "jediná lahev" };
  const logStart = role === "o2" ? m.sum.o2Start : m.sum.dilStart;
  const typed = lb.notes[m.id]?.prep?.[role];
  const start = logStart != null && logStart >= CLOSED ? logStart : typed ?? null;
  if (start == null) return { id: null, why: "tlak na začátku neznámý (lahev zavřená)" };
  const near = c.filter((t) => t.bar != null && Math.abs(t.bar - start) <= RB_TOL);
  if (near.length === 1) return { id: near[0].id, why: "podle tlaku" };
  return { id: null, why: near.length ? "víc lahví s podobným tlakem" : "tlak neodpovídá žádné lahvi (dotlakovaná?)" };
}

/** Převzetí tlaku na konci ponoru k on-board lahvi (zavřená = ověřit). */
export function rbApply(lb: Logbook, m: Meta, role: RbRole, id: string): void {
  const g = lb.tanks?.[id];
  if (!g) return;
  const endT = (m.start + m.h.diveTimeS) * 1000;
  if ((g.barAt || 0) > endT && g.fromDive?.id !== m.id) return; // novější údaj
  const start = role === "o2" ? m.sum.o2Start : m.sum.dilStart, end = role === "o2" ? m.sum.o2End : m.sum.dilEnd;
  const closed = end == null || end < CLOSED || (start != null && start < CLOSED);
  const prev = g.fromDive?.id === m.id ? g.fromDive.prev : { bar: g.bar, barAt: g.barAt };
  lb.tanks![id] = closed
    ? { ...g, check: { at: Date.now(), text: `po ponoru ${dd(m.start)} ${end == null ? "počítač tlak nezná" : "lahev byla zavřená (jen mezitlak)"}` }, fromDive: { id: m.id, prev }, updated: Date.now() }
    : { ...g, bar: Math.round(end!), barAt: endT, check: undefined, fromDive: { id: m.id, end: Math.round(end!), prev }, updated: Date.now() };
}

/** Lahev přestala být přiřazená k ponoru: vrátit tlak, který měla před převzetím z tohoto ponoru. */
export function rbUnapply(lb: Logbook, m: Meta, id: string): void {
  const g = lb.tanks?.[id];
  if (!g || g.fromDive?.id !== m.id) return;
  lb.tanks![id] = { ...g, bar: g.fromDive.prev?.bar, barAt: g.fromDive.prev?.barAt, check: undefined, fromDive: undefined, updated: Date.now() };
}

/** Další volné číslo lahve (RB O2 n / RB DIL n). */
export function rbNextName(lb: Logbook, role: RbRole): string {
  const nums = Object.values(lb.tanks || {}).map((t) => new RegExp(`^${RB_PREFIX[role]} (\\d+)$`).exec(t.name || "")?.[1]).filter(Boolean).map(Number);
  return `${RB_PREFIX[role]} ${nums.length ? Math.max(...nums) + 1 : 1}`;
}

const gasName = (mix: string | null) => { if (!mix) return "AIR"; const [o, h] = mix.split("/").map(Number); return h > 0 ? `TMX ${o}/${h}` : o === 21 ? "AIR" : o === 100 ? "O₂" : `EAN${o}`; };

/**
 * Po načtení ponorů (poslední ponor): chybějící on-board lahve založit (RB O2 1, RB DIL 1), lahve rozpoznat a převzít tlak.
 * Vrací true, když se něco změnilo. Ponor s ručním přiřazením se znovu nerozpoznává.
 */
export function gearOnboardApply(lb: Logbook, last: Meta, cc: boolean): boolean {
  if (!cc) return false;
  let ch = false;
  lb.tanks = lb.tanks || {};
  for (const role of ["o2", "dil"] as RbRole[]) {
    if (!Object.values(lb.tanks).some((t) => t.onboard === role)) {
      const id = uid(), vol = lb.settings.cyl?.[role] ?? 3;
      const t: GearTank = { id, kind: vol === 3 ? "3 l" : vol === 2.5 ? "2,5 l" : "Jiná", vol, name: rbNextName(lb, role), mix: role === "o2" ? "O₂" : gasName(diveDilMix(last)), onboard: role, updated: Date.now() };
      lb.tanks[id] = t; ch = true;
      // první založení: tlak z tohoto ponoru
      lb.notes[last.id] = { buddyIds: [], note: "", ...lb.notes[last.id], rb: { ...lb.notes[last.id]?.rb, [role]: { id, auto: true } }, updated: Date.now() };
      rbApply(lb, last, role, id);
      continue;
    }
    const cur = lb.notes[last.id]?.rb?.[role];
    if (cur) continue; // už přiřazeno (automaticky nebo ručně)
    const r = rbMatch(lb, last, role);
    if (!r.id) continue;
    lb.notes[last.id] = { buddyIds: [], note: "", ...lb.notes[last.id], rb: { ...lb.notes[last.id]?.rb, [role]: { id: r.id, auto: true } }, updated: Date.now() };
    rbApply(lb, last, role, r.id);
    ch = true;
  }
  return ch;
}
