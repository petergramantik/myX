// Baterie: Petrel (z logu) a dvě baterie v hlavě X-CCR (ruční evidence).
import { isCC } from "../core/rig";
import { ask, askText } from "../app/dialog";
import { useState } from "react";
import type { Header } from "../core/shearwater";
import { alerts, batSinceSwap } from "../core/analysis";
import { compName, deleteBattery, localNow, saveBattery, setBatSwap } from "../app/store";
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
  const petrelAlerts = petrel.length ? alerts(petrel.map((m) => m.h), now, th, null, last ? st.lb.settings.batSwap?.[String(last.h.serial)] : null).filter((a) => a.kind === "battery") : [];
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
  const sw = last ? st.lb.settings.batSwap?.[String(last.h.serial)] : undefined;
  const swapped = !!(last && sw != null && sw > last.h.start);
  return { petrel, petrelAlerts, head, last, th, swapped, guest: !!st.guest };
}

/** Procenta baterie Petrelu: u NiMH je v logu vždy 100 %, proto odhad z napětí mezi kritickým prahem a plnou baterií. */
export function petrelPct(h: Header): { pct: number; est: boolean } {
  if (h.batTypeCode === 3) {
    const full = 1.4, lo = h.batCrit || 1.15;
    return { pct: Math.round(Math.max(0, Math.min(1, (h.batVEnd - lo) / (full - lo))) * 100), est: true };
  }
  return { pct: h.batPctEnd, est: false };
}

export function BatteryTiles() {
  const b = useBatteries();
  if (!b.last) return null;
  const h = b.last.h;
  const pLvl = b.petrelAlerts.some((a) => a.level === "bad") ? "bad" : b.petrelAlerts.length ? "warn" : "ok";
  return (
    <>
      <div className="cells">
        <div className={"celltile " + pLvl} onClick={() => go({ t: "bats" })}>
          <div className="ct-h"><b>{compName(h.serial)}</b><span className={"dot " + pLvl} /></div>
          <div className="ct-v">{h.batVStart.toFixed(2).replace(".", ",")} <small>V</small></div>
          <div className="ct-u">na začátku ponoru</div>
          <div className={"ct-l " + pLvl}>{pLvl === "ok" ? "V pořádku" : pLvl === "warn" ? "Varování" : "Vyměnit"}</div>
        </div>
        {!b.guest && isCC(h) && b.head.map((x) => {
          const lvl = x.reasons.length ? "warn" : x.cur ? "ok" : "info";
          return (
            <div key={x.pos} className={"celltile " + lvl} onClick={() => go({ t: "bats", pos: x.pos })}>
              <div className="ct-h"><b>Hlava {x.pos}</b><span className={"dot " + lvl} /></div>
              {x.cur ? <>
                <div className="ct-v">{num(x.minutes / 60, 1)} <small>h</small></div>
                <div className="ct-u">pod vodou od výměny</div>
              </> : <><div className="ct-v">–</div><div className="ct-u">výměna nezadaná</div></>}
              <div className={"ct-l " + lvl}>{lvl === "ok" ? "V pořádku" : lvl === "warn" ? "Vyměnit" : "Zadat"}</div>
            </div>
          );
        })}
      </div>
      <BatPanel b={b} />
    </>
  );
}

const K_OPEN = "myx.batpanel";

function BatPanel({ b }: { b: ReturnType<typeof useBatteries> }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(K_OPEN) === "1"; } catch { return false; } });
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(K_OPEN, v ? "1" : "0"); } catch { /* */ } };
  const h = b.last!.h;
  const pp = petrelPct(h);
  const since = batSinceSwap(b.petrel.map((m) => m.h)); // ponory od poslední výměny baterie
  const prev = since.slice(-4, -1);
  const trend = prev.length ? h.batVStart - prev[0].batVStart : 0;
  const headTxt = (x: (typeof b.head)[number]) => !x.cur ? "–" : b.th.headBatHours > 0 ? `${Math.max(0, Math.round(100 - (x.minutes / 60 / b.th.headBatHours) * 100))} %` : `${num(x.minutes / 60, 1)} h`;
  const bad = b.petrelAlerts.some((a) => a.level === "bad");
  const warn = b.petrelAlerts.length > 0 || b.head.some((x) => x.reasons.length);
  const lvl = bad ? "bad" : warn ? "warn" : "ok";
  return (
    <section className={"panel " + lvl}>
      <button className="panel-h" onClick={toggle}>
        <span className="ph-main">{lvl === "ok" ? "✓" : "⚠"} {compName(h.serial)} {pp.est ? "~" : ""}{pp.pct} %{isCC(h) ? <> · Hlava 1 {headTxt(b.head[0])} · Hlava 2 {headTxt(b.head[1])}</> : null}</span>
        <span className="ph-sub">{lvl === "ok" ? "Baterie v pořádku" : "Baterie – upozornění"}</span>
        <span className="ph-arrow">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="panel-b">
          <div className={"pcell ptile " + (bad ? "bad" : b.petrelAlerts.length ? "warn" : "ok")}>
            <div className="pcell-h"><b className={"c-" + (bad ? "bad" : b.petrelAlerts.length ? "warn" : "ok")}>{compName(h.serial)}</b><span className={"pill " + (bad ? "bad" : b.petrelAlerts.length ? "warn" : "ok")}>{bad ? "Vyměnit" : b.petrelAlerts.length ? "Varování" : "V pořádku"}</span></div>
            <div className="kvline"><span>Typ</span><b>{h.batType}</b><span>Trend</span><b>{trend > 0.005 ? "↗" : trend < -0.005 ? "↘" : "→"} {trend >= 0 ? "+" : ""}{Math.round(trend * 1000)} mV</b></div>
            <small>{h.batVStart.toFixed(2).replace(".", ",")} → {h.batVEnd.toFixed(2).replace(".", ",")} V v posledním ponoru · {pp.est ? `odhad z napětí ${pp.pct} % (NiMH procenta Petrel neukládá)` : `${pp.pct} % podle Petrelu`}</small>
            {b.petrelAlerts.length ? b.petrelAlerts.map((a, i) => <div key={i} className={"reason " + a.level}>{a.text}</div>) : <div className="reason ok">✓ v pořádku{b.swapped ? " · výměna baterie zadaná ručně, platí do dalšího ponoru" : ""}</div>}
            {!b.guest && (b.petrelAlerts.length > 0 || b.swapped) && <button className="btn small" onClick={() => setBatSwap(h.serial, !b.swapped)}>{b.swapped ? "Zrušit „Baterii jsem vyměnil“" : "Baterii jsem vyměnil"}</button>}
          </div>
          {!b.guest && isCC(h) && b.head.map((x) => (
            <div key={x.pos} className={"pcell ptile " + (x.reasons.length ? "warn" : x.cur ? "ok" : "none")}>
              <div className="pcell-h"><b className={"c-" + (x.reasons.length ? "warn" : x.cur ? "ok" : "none")}>Hlava – baterie {x.pos}</b><span className={"pill " + (x.reasons.length ? "warn" : x.cur ? "ok" : "")}>{x.reasons.length ? "Vyměnit" : x.cur ? "V pořádku" : "Nezadaná"}</span></div>
              {x.cur ? <small>{x.cur.maker || "Baterie"}{x.cur.model ? ` ${x.cur.model}` : ""}{x.cur.volt ? ` (${x.cur.volt})` : ""} · výměna {fmtIso(x.cur.installed)} · {x.dives} ponorů · {hm(x.minutes)} pod vodou{b.th.headBatHours > 0 ? ` z limitu ${b.th.headBatHours} h` : ""}</small> : <small>Výměna zatím nezadaná.</small>}
              {x.reasons.length ? x.reasons.map((r, i) => <div key={i} className="reason warn">{r}</div>) : x.cur ? <div className="reason ok">✓ v pořádku</div> : null}
            </div>
          ))}
          <p className="note"><a onClick={() => go({ t: "bats" })}>Zadat výměnu, historie a graf napětí ›</a>{b.th.headBatHours > 0 ? "" : " · Procenta baterií v hlavě se ukážou po nastavení limitu hodin v Nastavení."}</p>
        </div>
      )}
    </section>
  );
}

export function BatteriesScreen({ pos }: { pos?: number }) {
  const b = useBatteries();
  const st = useStore();
  const ms = b.petrel;
  return (
    <div className="screen">
      {!pos && b.last && (
        <Card title={compName(b.last.h.serial)}>
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
        {f.id && <button className="btn danger" onClick={async () => { if (await ask("Smazat záznam o baterii?")) { await deleteBattery(f.id!); onDone(); } }}>Smazat</button>}
      </div>
    </div>
  );
}
