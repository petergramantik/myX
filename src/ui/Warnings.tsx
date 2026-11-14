// Okno Varování: všechna upozornění seskupená podle objektu (scrubber, čidla, CO₂, baterie, dotazy na výměnu čidla).
import { alerts, scrubberInfo } from "../core/analysis";
import { localNow } from "../app/store";
import { CellPrompt, useCells, useCo2 } from "./Cells";
import { useBatteries } from "./Batteries";
import { fmtDate, go, num, useStore, type Screen } from "./common";

type Level = "bad" | "warn" | "info";
export interface WarnGroup { key: string; title: string; level: Level; items: { level: Level; text: string }[]; to?: Screen; prompts: ReturnType<typeof useCells>["prompts"] }
const RANK: Record<Level, number> = { bad: 0, warn: 1, info: 2 };
const DAY = 86400;

export function useWarnings() {
  const st = useStore();
  const c = useCells();
  const b = useBatteries();
  const co2 = useCo2();
  const th = st.lb.settings.th;
  const groups = new Map<string, WarnGroup>();
  const add = (key: string, title: string, level: Level, text: string, to?: Screen) => {
    const g = groups.get(key) || { key, title, level, items: [], to, prompts: [] };
    if (text) g.items.push({ level, text });
    if (RANK[level] < RANK[g.level]) g.level = level;
    groups.set(key, g);
  };
  const sc = scrubberInfo(st.metas.map((m) => m.h), localNow(), th, st.lb.settings.manualFill);
  for (const a of sc?.alerts || []) add("scrub", "Scrubber", a.level, `${a.title}: ${a.text}`);
  c.status.forEach((s, k) => s.reasons.forEach((r) => {
    if (s.level !== "ok") add("cell" + (k + 1), `Čidlo ${k + 1}`, s.level === "info" ? "info" : s.level, r, { t: "cells", pos: k + 1 });
  }));
  for (const p of c.prompts.filter((p) => c.now - p.meta.start < 400 * DAY)) {
    add("cell" + p.pos, `Čidlo ${p.pos}`, "info", "", { t: "cells", pos: p.pos });
    groups.get("cell" + p.pos)!.prompts.push(p);
  }
  const last = co2.last;
  if (last?.sum.co2Max != null && last.sum.co2Max >= th.co2Mbar)
    add("co2", "Čidlo CO₂", "bad", `Vysoké CO₂ v posledním ponoru (${fmtDate(last.start)}): maximum ${num(last.sum.co2Max, 1)} mbar.`, { t: "dive", id: last.id });
  if (last && last.sum.co2AlarmN > 0)
    add("co2", "Čidlo CO₂", "bad", `Alarm CO₂ z počítače v posledním ponoru: ${last.sum.co2AlarmN}× (celkem ${last.sum.co2AlarmS < 60 ? "pod 1 min" : Math.round(last.sum.co2AlarmS / 60) + " min"}).`, { t: "dive", id: last.id });
  for (const a of b.petrelAlerts) add("petrel", "Petrel – baterie", a.level, `${a.title}: ${a.text}`, { t: "bats" });
  for (const x of b.head) for (const r of x.reasons) add("head" + x.pos, `Hlava – baterie ${x.pos}`, "warn", r, { t: "bats", pos: x.pos });
  // baterie dalších počítačů (jiné sériové číslo než poslední ponor)
  const lastSer = st.metas[st.metas.length - 1]?.h.serial;
  const bySer = new Map<number, typeof st.metas>();
  for (const m of st.metas) if (m.h.serial !== lastSer) bySer.set(m.h.serial, [...(bySer.get(m.h.serial) || []), m]);
  for (const [ser, ms] of bySer) for (const a of alerts(ms.map((m) => m.h), localNow(), th, null).filter((a) => a.kind === "battery"))
    add("pc" + ser, `Počítač ${ser.toString(16).toUpperCase()} – baterie`, a.level, `${a.title}: ${a.text}`);
  const list = [...groups.values()].sort((x, y) => RANK[x.level] - RANK[y.level]);
  return { list, count: list.length, worst: list[0]?.level ?? null };
}

export function WarningsScreen() {
  const w = useWarnings();
  return (
    <div className="screen">
      {!w.count && <p className="muted center big">✓ Žádná varování</p>}
      {w.list.map((g) => (
        <div key={g.key} className={"alert wgroup " + g.level}>
          <div className={"wg-h" + (g.to ? " link" : "")} onClick={() => g.to && go(g.to)}>
            <b>{g.title}</b>{g.to && <small className="muted">Otevřít ›</small>}
          </div>
          {g.items.length > 0 && <ul>{g.items.map((it, i) => <li key={i} className={"c-" + it.level}>{it.text}</li>)}</ul>}
          {g.prompts.map((p) => <CellPrompt key={p.key} p={p} bare />)}
        </div>
      ))}
      <p className="note center">Na přehled se vrátíš přejetím prstem doleva nebo šipkou nahoře.</p>
    </div>
  );
}
