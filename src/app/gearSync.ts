// Výstroj ↔ ponory: tlak lahve = poslední událost v čase z historie – kontroly (ruční zadání, potvrzení, plnění) a ponory
// (tlak před a po z „Před a po ponoru“, u on-board lahví z logu). Starší ponor tak přepíše tlak jen tehdy, když lahev
// později nebyla použita ani kontrolována; oprava nebo smazání ponoru se promítne samo. Chybějící tlak po ponoru → „Ověřit“.
// On-board lahve rebreatheru (RB O2 n / RB DIL n) se po ponoru rozpoznají podle směsi diluentu z logu a tlaku na začátku.
import { tankMix, uid, type GearTank, type Logbook, type Meta } from "./model";

/** Pod touto hodnotou počítač měří jen mezitlak (lahev zavřená). */
const CLOSED = 20;
/** Tolerance tlaku při rozpoznání lahve (teplota, přesnost snímače). */
export const RB_TOL = 15;
const dd = (sec: number) => new Date(sec * 1000).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
export type RbRole = "o2" | "dil";
export const RB_PREFIX: Record<RbRole, string> = { o2: "RB O2", dil: "RB DIL" };

/** Událost lahve v historii (odvozená z kontrol a ponorů). */
export interface TankEvent { at: number; kind: "check" | "fill" | "start" | "end"; bar: number | null; diveId?: string; src?: "log" | "typed"; mix?: string; why?: string }

/** Tlak on-board lahve v ponoru: z logu (otevřená lahev), jinak zadaný v „Před a po ponoru“. */
export function onboardPress(m: Meta, prep: Logbook["notes"][string]["prep"], role: RbRole): { start: number | null; end: number | null; src: "log" | "typed" | null; closed: boolean } {
  const ls = role === "o2" ? m.sum.o2Start : m.sum.dilStart, le = role === "o2" ? m.sum.o2End : m.sum.dilEnd;
  const ts = role === "o2" ? prep?.o2 : prep?.dil, te = role === "o2" ? prep?.o2End : prep?.dilEnd;
  const sOk = ls != null && ls >= CLOSED, eOk = sOk && le != null && le >= CLOSED;
  const start = sOk ? Math.round(ls!) : ts ?? null, end = eOk ? Math.round(le!) : te ?? null;
  return { start, end, src: eOk ? "log" : start != null || end != null ? "typed" : null, closed: ls != null && ls < CLOSED, startLog: sOk } as { start: number | null; end: number | null; src: "log" | "typed" | null; closed: boolean; startLog?: boolean };
}

/** Historie lahve: kontroly a ponory (od nejstarší). */
export function tankEvents(lb: Logbook, metas: Meta[], id: string): TankEvent[] {
  const t = lb.tanks?.[id];
  if (!t) return [];
  const ev: TankEvent[] = (t.checks || []).map((c) => ({ at: c.at, kind: c.fill ? "fill" : "check", bar: c.bar, mix: c.mix }));
  const byId = new Map(metas.map((m) => [m.id, m]));
  for (const [did, n] of Object.entries(lb.notes)) {
    const m = byId.get(did);
    if (!m) continue;
    const t0 = m.start * 1000, t1 = (m.start + m.h.diveTimeS) * 1000;
    for (const pt of n.prep?.tanks || []) {
      if (pt.gearId !== id) continue;
      const end = pt.same ? pt.bar : pt.end;
      if (pt.bar != null) ev.push({ at: t0, kind: "start", bar: pt.bar, diveId: did, src: "typed" });
      ev.push({ at: t1, kind: "end", bar: end ?? null, diveId: did, src: "typed", why: end == null ? "chybí tlak po ponoru" : undefined });
    }
    for (const role of ["o2", "dil"] as RbRole[]) {
      if (n.rb?.[role]?.id !== id) continue;
      const p = onboardPress(m, n.prep, role);
      if (p.start != null) ev.push({ at: t0, kind: "start", bar: p.start, diveId: did, src: p.src || undefined });
      ev.push({ at: t1, kind: "end", bar: p.end, diveId: did, src: p.src || undefined, why: p.end == null ? (p.closed ? "lahev byla zavřená (jen mezitlak) – zadej tlak po ponoru" : "počítač tlak nezná – zadej tlak po ponoru") : undefined });
    }
  }
  return ev.sort((a, b) => a.at - b.at || (a.kind === "end" ? 1 : 0) - (b.kind === "end" ? 1 : 0));
}

/** Přepočet tlaků všech lahví z historie (kontroly + ponory). Vrací true, když se něco změnilo. */
export function gearRecompute(lb: Logbook, metas: Meta[]): boolean {
  let ch = false;
  for (const t of Object.values(lb.tanks || {})) {
    // převod: dosavadní tlak lahve = první kontrola
    let x: GearTank = t;
    if (!x.checks) { x = { ...x, checks: x.bar != null ? [{ at: x.barAt ?? x.updated ?? 0, bar: x.bar }] : [] }; }
    const ev = tankEvents({ ...lb, tanks: { ...lb.tanks, [x.id]: x } }, metas, x.id);
    const last = ev[ev.length - 1];
    let bar = x.bar, barAt = x.barAt, check: GearTank["check"] = undefined, fromDive: GearTank["fromDive"] = undefined;
    if (last) {
      if (last.bar != null) { bar = last.bar; barAt = last.at; }
      else {
        const known = [...ev].reverse().find((e) => e.bar != null);
        bar = known?.bar ?? undefined; barAt = known?.at;
        check = { at: last.at, text: `po ponoru ${dd(last.at / 1000)} ${last.why || "chybí tlak po ponoru"}` };
      }
      if (last.diveId) fromDive = { id: last.diveId, end: last.bar ?? undefined };
    }
    const same = x === t && t.bar === bar && t.barAt === barAt && (t.check?.text ?? null) === (check?.text ?? null) && (t.fromDive?.id ?? null) === (fromDive?.id ?? null);
    if (same) continue;
    lb.tanks![x.id] = { ...x, bar, barAt, check: check ? { ...check, at: t.check?.text === check.text ? t.check.at : check.at } : undefined, fromDive, updated: Date.now() };
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

/** Další volné číslo lahve (RB O2 n / RB DIL n). */
export function rbNextName(lb: Logbook, role: RbRole): string {
  const nums = Object.values(lb.tanks || {}).map((t) => new RegExp(`^${RB_PREFIX[role]} (\\d+)$`).exec(t.name || "")?.[1]).filter(Boolean).map(Number);
  return `${RB_PREFIX[role]} ${nums.length ? Math.max(...nums) + 1 : 1}`;
}

const gasName = (mix: string | null) => { if (!mix) return "AIR"; const [o, h] = mix.split("/").map(Number); return h > 0 ? `TMX ${o}/${h}` : o === 21 ? "AIR" : o === 100 ? "O₂" : `EAN${o}`; };

/**
 * Po načtení ponorů (poslední ponor): chybějící on-board lahve založit (RB O2 1, RB DIL 1) a lahve rozpoznat (tlak pak z historie).
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
      continue;
    }
    const cur = lb.notes[last.id]?.rb?.[role];
    if (cur) continue; // už přiřazeno (automaticky nebo ručně)
    const r = rbMatch(lb, last, role);
    if (!r.id) continue;
    lb.notes[last.id] = { buddyIds: [], note: "", ...lb.notes[last.id], rb: { ...lb.notes[last.id]?.rb, [role]: { id: r.id, auto: true } }, updated: Date.now() };
    ch = true;
  }
  return ch;
}
