// Okno Varování: všechna upozornění na jednom místě (scrubber, čidla, baterie, CO₂, dotazy na výměnu čidla).
import { alerts, scrubberInfo } from "../core/analysis";
import { localNow } from "../app/store";
import { CellPrompt, useCells } from "./Cells";
import { useBatteries } from "./Batteries";
import { fmtDate, go, num, useStore, type Screen } from "./common";

export interface Warn { level: "bad" | "warn" | "info"; title: string; text: string; to?: Screen }
const RANK = { bad: 0, warn: 1, info: 2 };
const DAY = 86400;

export function useWarnings() {
  const st = useStore();
  const c = useCells();
  const b = useBatteries();
  const th = st.lb.settings.th;
  const out: Warn[] = [];
  const sc = scrubberInfo(st.metas.map((m) => m.h), localNow(), th, st.lb.settings.manualFill);
  for (const a of sc?.alerts || []) out.push({ level: a.level, title: a.title, text: a.text });
  c.status.forEach((s, k) => s.reasons.forEach((r) => {
    if (s.level !== "ok") out.push({ level: s.level === "info" ? "info" : s.level, title: `Čidlo ${k + 1}`, text: r, to: { t: "cells", pos: k + 1 } });
  }));
  for (const a of b.petrelAlerts) out.push({ level: a.level, title: `Petrel – ${a.title.toLowerCase()}`, text: a.text, to: { t: "bats" } });
  for (const x of b.head) for (const r of x.reasons) out.push({ level: "warn", title: `Hlava – baterie ${x.pos}`, text: r, to: { t: "bats", pos: x.pos } });
  // baterie dalších počítačů (jiné sériové číslo než poslední ponor)
  const lastSer = st.metas[st.metas.length - 1]?.h.serial;
  const bySer = new Map<number, typeof st.metas>();
  for (const m of st.metas) if (m.h.serial !== lastSer) bySer.set(m.h.serial, [...(bySer.get(m.h.serial) || []), m]);
  for (const [ser, ms] of bySer) for (const a of alerts(ms.map((m) => m.h), localNow(), th, null).filter((a) => a.kind === "battery"))
    out.push({ level: a.level, title: `${a.title} (počítač ${ser.toString(16).toUpperCase()})`, text: a.text });
  const last = st.metas[st.metas.length - 1];
  if (last?.sum.co2Max != null && last.sum.co2Max >= th.co2Mbar)
    out.push({ level: "bad", title: "Vysoké CO₂ v posledním ponoru", text: `Maximum ppCO₂ ${num(last.sum.co2Max, 1)} mbar (ponor ${fmtDate(last.start)}).`, to: { t: "dive", id: last.id } });
  out.sort((x, y) => RANK[x.level] - RANK[y.level]);
  const prompts = c.prompts.filter((p) => c.now - p.meta.start < 400 * DAY);
  return { list: out, prompts, count: out.length + prompts.length, worst: out[0]?.level ?? (prompts.length ? "info" : null) };
}

export function WarningsScreen() {
  const w = useWarnings();
  return (
    <div className="screen">
      {!w.count && <p className="muted center big">✓ Žádná varování</p>}
      {w.list.map((x, i) => (
        <div key={i} className={"alert " + x.level + (x.to ? " link" : "")} onClick={() => x.to && go(x.to)}>
          <b>{x.title}</b><div>{x.text}</div>{x.to && <small className="muted">Otevřít ›</small>}
        </div>
      ))}
      {w.prompts.map((p) => <CellPrompt key={p.key} p={p} />)}
      <p className="note center">Na přehled se vrátíš přejetím prstem doleva nebo šipkou nahoře.</p>
    </div>
  );
}
