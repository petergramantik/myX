// Baterie: Petrel (z logu) a dvě baterie v hlavě X-CCR (ruční evidence).
import { useState } from "react";
import { alerts } from "../core/analysis";
import { deleteBattery, localNow, saveBattery } from "../app/store";
import type { Battery } from "../app/model";
import { AlertBox, Card, fmtDate, go, hm, num, useStore } from "./common";
import { LineChart } from "./Chart";
import { fmtIso } from "./Cells";

const DAY = 86400;
const isoOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const tsOf = (iso: string) => Date.parse(iso + "T12:00:00Z") / 1000;

export function useBatteries() {
  const st = useStore();
  const now = localNow();
  const th = st.lb.settings.th;
  const last = st.metas[st.metas.length - 1];
  const petrel = last ? st.metas.filter((m) => m.h.serial === last.h.serial) : [];
  const petrelAlerts = petrel.length ? alerts(petrel.map((m) => m.h), now, th, null).filter((a) => a.kind === "battery") : [];
  const head = ([1, 2] as const).map((pos) => {
    const all = Object.values(st.lb.batteries).filter((b) => b.pos === pos).sort((a, b) => b.installed.localeCompare(a.installed));
    const cur = all.find((b) => !b.removed);
    const since = cur ? st.metas.filter((m) => m.start >= tsOf(cur.installed) - 12 * 3600) : [];
    const minutes = since.reduce((a, m) => a + m.h.diveTimeS / 60, 0);
    const months = cur ? (now - tsOf(cur.installed)) / (30.44 * DAY) : null;
    const reasons: string[] = [];
    if (cur && th.headBatHours > 0 && minutes / 60 >= th.headBatHours) reasons.push(`${hm(minutes)} pod vodou od výměny (limit ${th.headBatHours} h)`);
    if (cur && th.headBatMonths > 0 && months != null && months >= th.headBatMonths) reasons.push(`${Math.floor(months)} měsíců od výměny (limit ${th.headBatMonths})`);
    return { pos, all, cur, dives: since.length, minutes, months, reasons };
  });
  return { petrel, petrelAlerts, head, last, th };
}

export function BatteryTiles() {
  const b = useBatteries();
  if (!b.last) return null;
  const h = b.last.h;
  const prev = b.petrel.filter((m) => m.h.batTypeCode === h.batTypeCode).slice(-4, -1);
  const trend = prev.length ? h.batVStart - prev[0].h.batVStart : 0;
  const pLvl = b.petrelAlerts.some((a) => a.level === "bad") ? "bad" : b.petrelAlerts.length ? "warn" : "ok";
  return (
    <>
      <div className="cells">
        <div className={"celltile " + pLvl} onClick={() => go({ t: "bats" })}>
          <div className="ct-h"><b>Petrel</b><span className={"dot " + pLvl} /></div>
          <div className="ct-v">{h.batVStart.toFixed(2).replace(".", ",")} <small>V</small></div>
          <div className="ct-u">na začátku ponoru</div>
          <div className="ct-rows">
            <div><span>Typ</span><b>{h.batType}</b></div>
            <div><span>Trend</span><b>{trend > 0.005 ? "↗" : trend < -0.005 ? "↘" : "→"} {trend >= 0 ? "+" : ""}{Math.round(trend * 1000)} mV</b></div>
          </div>
          <div className={"ct-l " + pLvl}>{pLvl === "ok" ? "V pořádku" : pLvl === "warn" ? "Varování" : "Vyměnit"}</div>
        </div>
        {b.head.map((x) => {
          const lvl = x.reasons.length ? "warn" : x.cur ? "ok" : "info";
          return (
            <div key={x.pos} className={"celltile " + lvl} onClick={() => go({ t: "bats", pos: x.pos })}>
              <div className="ct-h"><b>Hlava {x.pos}</b><span className={"dot " + lvl} /></div>
              {x.cur ? <>
                <div className="ct-v">{num(x.minutes / 60, 1)} <small>h</small></div>
                <div className="ct-u">pod vodou od výměny</div>
                <div className="ct-rows">
                  <div><span>Výměna</span><b>{fmtIso(x.cur.installed)}</b></div>
                  <div><span>Ponorů</span><b>{x.dives}</b></div>
                </div>
              </> : <><div className="ct-v">–</div><div className="ct-u">výměna nezadaná</div></>}
              <div className={"ct-l " + lvl}>{lvl === "ok" ? "V pořádku" : lvl === "warn" ? "Vyměnit" : "Zadat"}</div>
            </div>
          );
        })}
      </div>
      {(b.petrelAlerts.length > 0 || b.head.some((x) => x.reasons.length)) && (
        <div className="cellwarn">
          {b.petrelAlerts.map((a, i) => <div key={"p" + i} className={a.level}><b>Petrel:</b> {a.text}</div>)}
          {b.head.map((x) => x.reasons.map((r, i) => <div key={x.pos + "-" + i} className="warn"><b>Hlava {x.pos}:</b> {r}</div>))}
        </div>
      )}
    </>
  );
}

export function BatteriesScreen({ pos }: { pos?: number }) {
  const b = useBatteries();
  const st = useStore();
  const ms = b.petrel;
  return (
    <div className="screen">
      {!pos && b.last && (
        <Card title="Petrel">
          {b.petrelAlerts.map((a, i) => <AlertBox key={i} a={a} />)}
          <p>{b.last.h.batType} · práh varování {b.last.h.batWarn.toFixed(2)} V · kritický {b.last.h.batCrit.toFixed(2)} V</p>
          <LineChart t={ms.map((m) => st.metas.indexOf(m) + 1)} height={170} xFmt={(v) => String(Math.round(v))}
            xTitle={(v) => `Ponor ${v} (${fmtDate(st.metas[v - 1].start)}, ${st.metas[v - 1].h.batType})`}
            series={[{ label: "Na začátku", color: "#4fc3f7", values: ms.map((m) => m.h.batVStart), unit: "V", width: 2 }, { label: "Minimum v ponoru", color: "#ffb74d", values: ms.map((m) => m.sum.batVMin), unit: "V" }]} />
          <p className="note">Napětí baterie Petrelu z logu. Skok nahoru = výměna baterie.</p>
        </Card>
      )}
      {b.head.filter((x) => !pos || x.pos === pos).map((x) => <HeadBattery key={x.pos} x={x} />)}
      {pos && <button className="btn" onClick={() => go({ t: "bats" })}>Zobrazit všechny baterie</button>}
      <Card title="Baterie v hlavě">
        <p className="note">Napětí baterií v hlavě X-CCR Petrel do logu neukládá, proto se evidují ručně. Hodiny a ponory od výměny se počítají z logbooku. Limity pro varování nastavíš v Nastavení (0 = vypnuto).</p>
      </Card>
    </div>
  );
}

function HeadBattery({ x }: { x: ReturnType<typeof useBatteries>["head"][number] }) {
  const [edit, setEdit] = useState<Partial<Battery> | null>(null);
  return (
    <Card title={`Hlava – baterie ${x.pos}`}>
      {x.reasons.map((r, i) => <div key={i} className="reason warn">{r}</div>)}
      {x.cur ? (
        <p><b>{x.cur.maker || "Baterie"}{x.cur.model ? ` ${x.cur.model}` : ""}{x.cur.volt ? ` (${x.cur.volt})` : ""}</b> · výměna {fmtIso(x.cur.installed)} · {x.dives} ponorů · {hm(x.minutes)} pod vodou{x.months != null ? ` · ${Math.floor(x.months)} měs.` : ""}</p>
      ) : <p className="muted">Zatím nezadaná.</p>}
      <div className="row">
        <button className="btn primary" onClick={() => setEdit({ pos: x.pos, installed: isoOf(localNow()), maker: x.cur?.maker || "", model: x.cur?.model, volt: x.cur?.volt })}>Vyměnit / zadat baterii</button>
        {x.cur && <button className="btn" onClick={() => setEdit({ ...x.cur })}>Upravit</button>}
      </div>
      {edit && <BatteryForm init={edit} onDone={() => setEdit(null)} />}
      {x.all.length > 0 && (
        <table className="kv"><thead><tr><th>Baterie</th><th>Výměna → vyjmutí</th></tr></thead>
          <tbody>{x.all.map((h) => (
            <tr key={h.id} onClick={() => setEdit({ ...h })}>
              <td>{h.maker || "?"}{h.model ? ` ${h.model}` : ""}{h.volt ? <><br /><small>{h.volt}</small></> : null}</td>
              <td>{fmtIso(h.installed)} → {h.removed ? fmtIso(h.removed) : "dosud"}{h.note ? <><br /><small>{h.note}</small></> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function BatteryForm({ init, onDone }: { init: Partial<Battery>; onDone: () => void }) {
  const [f, setF] = useState<Partial<Battery>>(init);
  const set = (k: keyof Battery, v: string | undefined) => setF({ ...f, [k]: v });
  return (
    <div className="form">
      <label>Výrobce a model<div className="row"><input value={f.maker || ""} placeholder="např. Saft" onChange={(e) => set("maker", e.target.value)} /><input value={f.model || ""} placeholder="model (LS14500…)" onChange={(e) => set("model", e.target.value)} /></div></label>
      <label>Napětí / typ<input value={f.volt || ""} placeholder="např. 3,6 V lithiová" onChange={(e) => set("volt", e.target.value)} /></label>
      <label>Datum výměny<input type="date" value={f.installed || ""} onChange={(e) => set("installed", e.target.value)} /></label>
      {f.id && <label>Vyjmuto<input type="date" value={f.removed || ""} onChange={(e) => set("removed", e.target.value || undefined)} /></label>}
      <label>Poznámka<input value={f.note || ""} onChange={(e) => set("note", e.target.value)} /></label>
      <div className="row">
        <button className="btn primary" disabled={!f.installed} onClick={async () => { await saveBattery(f as Battery); onDone(); }}>Uložit</button>
        <button className="btn" onClick={onDone}>Zrušit</button>
        {f.id && <button className="btn danger" onClick={async () => { if (confirm("Smazat záznam o baterii?")) { await deleteBattery(f.id!); onDone(); } }}>Smazat</button>}
      </div>
    </div>
  );
}
