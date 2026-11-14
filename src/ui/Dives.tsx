import { useEffect, useMemo, useState } from "react";
import type { Dive } from "../core/shearwater";
import { cellCalibration, diveWarnings, injections, summarize } from "../core/analysis";
import { loadDive, myNum, setNote } from "../app/store";
import { norm } from "../app/model";
import { AlertBox, Card, KV, RATING, Tiles, fmtDate, fmtDateTime, go, hm, num, useStore } from "./common";
import { NoteEditor } from "./NoteEditor";
import { LineChart, TissueMap } from "./Chart";

const C = ["#4fc3f7", "#ffb74d", "#81c784", "#ce93d8", "#fff176", "#ef5350"];

export function DivesScreen({ site, buddy }: { site?: string; buddy?: string }) {
  const st = useStore();
  const [q, setQ] = useState("");
  const [rate, setRate] = useState<string>("");
  const lb = st.lb;
  const n = norm(q);
  const match = (note: { siteId?: string; buddyIds: string[]; note: string; rating?: string } | undefined, date: number) => {
    if (site && note?.siteId !== site) return false;
    if (buddy && !note?.buddyIds.includes(buddy)) return false;
    if (rate && note?.rating !== rate) return false;
    if (!n) return true;
    const txt = norm([note?.siteId ? lb.sites[note.siteId]?.name : "", ...(note?.buddyIds || []).map((b) => lb.buddies[b]?.name || ""), note?.note || "", fmtDate(date)].join(" "));
    return n.split(" ").every((w) => txt.includes(w));
  };
  const rows = st.metas.map((m, i) => ({ m, no: i + 1, note: lb.notes[m.id] })).reverse().filter(({ m, note }) => match(note, m.start));
  const drafts = Object.values(lb.drafts).filter((d) => match(d, d.created)).sort((a, b) => b.created - a.created);
  return (
    <div className="screen">
      {(site || buddy) && <p className="muted">Filtr: {site ? lb.sites[site]?.name : lb.buddies[buddy!]?.name} · <a onClick={() => go({ t: "dives" })}>zrušit</a></p>}
      <input className="search" placeholder="Hledat lokalitu, parťáka, poznámku, datum…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="seg filter">
        {[["", "Vše"], ["up", "👍"], ["down", "👎"], ["problem", "❗"]].map(([k, l]) => <button key={k} className={rate === k ? "on" : ""} onClick={() => setRate(k)}>{l}</button>)}
      </div>
      {drafts.map((d) => (
        <div key={d.id} className="dive-row draft" onClick={() => go({ t: "draft", id: d.id })}>
          <div className="dr-main"><b>{d.siteId ? lb.sites[d.siteId]?.name : "bez lokality"}</b><small>{fmtDate(d.created)} · čeká na data z počítače</small></div>
          <div className="dr-num muted">⏳</div>
          <div className="dr-rate">{d.rating ? RATING[d.rating].icon : ""}</div>
        </div>
      ))}
      {rows.map(({ m, no, note }) => (
        <div key={m.id} className="dive-row" onClick={() => go({ t: "dive", id: m.id })}>
          <div className="dr-main">
            <b>{note?.siteId ? lb.sites[note.siteId]?.name : <span className="muted">bez lokality</span>}</b>
            <small>č. {no} · {fmtDate(m.start)}{note?.buddyIds.length ? " · " + note.buddyIds.map((b) => lb.buddies[b]?.name).filter(Boolean).join(", ") : ""}</small>
          </div>
          <div className="dr-num"><span>{num(m.h.maxDepth)}<small>m</small></span><span>{Math.round(m.h.diveTimeS / 60)}<small>min</small></span></div>
          <div className="dr-rate">{note?.rating ? RATING[note.rating].icon : m.sum.co2Max != null && m.sum.co2Max >= lb.settings.th.co2Mbar ? <span className="badge bad">CO₂</span> : ""}</div>
        </div>
      ))}
      {!rows.length && !drafts.length && <p className="muted center">Žádné ponory</p>}
    </div>
  );
}

type Tab = "log" | "charts" | "values" | "events";

export function DiveScreen({ id }: { id: string }) {
  const st = useStore();
  const [d, setD] = useState<Dive | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("log");
  useEffect(() => { setD(null); loadDive(id).then(setD).catch((e) => setErr(e.message)); }, [id]);
  const meta = st.metas.find((m) => m.id === id);
  if (!meta) return <div className="screen"><p>Ponor nenalezen.</p></div>;
  const idx = st.metas.indexOf(meta);
  const prev = st.metas[idx - 1], next = st.metas[idx + 1];
  return (
    <div className="screen">
      <div className="dive-head">
        <button className="btn small" disabled={!prev} onClick={() => prev && go({ t: "dive", id: prev.id })}>‹</button>
        <div><b>Ponor {myNum(id)}</b><small>{fmtDateTime(meta.start)} · v počítači #{meta.num}</small></div>
        <button className="btn small" disabled={!next} onClick={() => next && go({ t: "dive", id: next.id })}>›</button>
      </div>
      <div className="tabs">
        {([["log", "Logbook"], ["charts", "Grafy"], ["values", "Hodnoty"], ["events", "Události"]] as [Tab, string][]).map(([k, l]) =>
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {err && <p className="alert bad">{err}</p>}
      {tab === "log" && <LogTab id={id} d={d} />}
      {tab !== "log" && !d && !err && <p className="muted center">Dekóduji…</p>}
      {tab === "charts" && d && <ChartsTab d={d} />}
      {tab === "values" && d && <ValuesTab d={d} />}
      {tab === "events" && d && <EventsTab d={d} />}
    </div>
  );
}

function LogTab({ id, d }: { id: string; d: Dive | null }) {
  const st = useStore();
  const lb = st.lb;
  const meta = st.metas.find((m) => m.id === id)!;
  const note = lb.notes[id] || { buddyIds: [], note: "", updated: 0 };
  const warns = d ? diveWarnings(d, summarize(d), lb.settings.th) : [];
  return (
    <>
      {warns.map((a, i) => <AlertBox key={i} a={a} />)}
      <NoteEditor note={note} onChange={(p) => setNote(id, p)} />
      <Card title="V kostce">
        <Tiles items={[
          ["Max. hloubka", `${num(meta.h.maxDepth)} m`], ["Doba", `${Math.round(meta.h.diveTimeS / 60)} min`], ["Prům. hloubka", `${num(meta.sum.avgDepth)} m`],
          ["Min. teplota", `${meta.sum.tempMin} °C`], ["GF", `${meta.h.gfLo}/${meta.h.gfHi}`], ["CNS konec", `${meta.h.cnsEnd} %`],
          ["Max. pO₂", `${num(meta.sum.ppo2Max, 2)} bar`], ["Max. CO₂", meta.sum.co2Max != null ? `${num(meta.sum.co2Max, 2)} mbar` : "–"],
          ["Diluent", meta.sum.dilUsed], ["Vstřiky O₂ (odhad)", meta.inj], ["Scrubber zbývá", hm(meta.h.scrubLeftEndMin)], ["Baterie konec", `${meta.h.batVEnd.toFixed(2)} V`],
        ]} />
      </Card>
    </>
  );
}

function ChartsTab({ d }: { d: Dive }) {
  const s = d.s;
  const [cellMode, setCellMode] = useState<"cal" | "mv">("cal");
  const cal = useMemo(() => cellCalibration(d), [d]);
  const inj = useMemo(() => injections(d), [d]);
  const vrate = useMemo(() => s.depth.map((_, i) => {
    const a = Math.max(0, i - 3), b = Math.min(s.t.length - 1, i + 3);
    return s.t[b] === s.t[a] ? 0 : +(-(s.depth[b] - s.depth[a]) / (s.t[b] - s.t[a]) * 60).toFixed(1);
  }), [d]);
  const cells = [s.mv1, s.mv2, s.mv3].map((mv, k) => cellMode === "mv" ? mv : mv.map((v) => (cal[k] ? +(v * cal[k]!).toFixed(2) : null)));
  const hasHe = d.tissues.some((x) => x.he.some((v) => v > 0.02));
  const depthExtra = [{ label: "Hloubka", values: s.depth, unit: "m" }];
  return (
    <>
      <Card title="Profil a dekompresní strop">
        <LineChart t={s.t} invert height={220} series={[
          { label: "Hloubka", color: C[0], values: s.depth, unit: "m", width: 2 }, { label: "Strop", color: C[5], values: s.ceil, unit: "m" }, { label: "Zastávka", color: C[1], values: s.stop, unit: "m", dash: "4 3" },
        ]} extra={[{ label: "Teplota", values: s.temp, unit: "°C" }, { label: "pO₂", values: s.ppo2, unit: "bar" }, { label: "TTS", values: s.tts, unit: "min" }]} />
      </Card>
      <Card title="pO₂ a články" right={
        <div className="seg"><button className={cellMode === "cal" ? "on" : ""} onClick={() => setCellMode("cal")}>pO₂</button><button className={cellMode === "mv" ? "on" : ""} onClick={() => setCellMode("mv")}>mV</button></div>}>
        {cellMode === "cal" ? (
          <LineChart t={s.t} markers={inj.map((x) => x.t)} series={[
            { label: "Průměr pO₂", color: C[0], values: s.ppo2, unit: "bar", width: 2 }, { label: "Článek 1", color: C[1], values: cells[0], unit: "bar" },
            { label: "Článek 2", color: C[2], values: cells[1], unit: "bar" }, { label: "Článek 3", color: C[3], values: cells[2], unit: "bar" }, { label: "Setpoint", color: C[4], values: s.sp, unit: "bar", dash: "4 3" },
          ]} extra={depthExtra} />
        ) : (
          <LineChart t={s.t} series={[
            { label: "Článek 1", color: C[1], values: cells[0], unit: "mV" }, { label: "Článek 2", color: C[2], values: cells[1], unit: "mV" }, { label: "Článek 3", color: C[3], values: cells[2], unit: "mV" },
          ]} extra={[{ label: "Průměr pO₂", values: s.ppo2, unit: "bar" }, ...depthExtra]} />
        )}
        <p className="note">
          {cellMode === "cal" ? <>Články přepočtené kalibrací odvozenou z průměrného pO₂ tohoto ponoru: {cal.map((c, k) => `č. ${k + 1} ${c ? (c * 1000).toFixed(1) + " mbar/mV" : "–"}`).join(", ")}. </> : "Surové hodnoty článků v mV. "}
          Čárky dole = odhadnuté vstřiky O₂ ({inj.length}×), podle rychlého nárůstu průměrného pO₂.
        </p>
      </Card>
      <Card title="CO₂ v dýchací smyčce">
        {s.co2.some((v) => v != null && v > 0)
          ? <LineChart t={s.t} series={[{ label: "ppCO₂", color: C[5], values: s.co2, unit: "mbar", width: 2 }, { label: "Hloubka", color: C[0], values: s.depth, unit: "m", right: true }]} rightInvert extra={[{ label: "Surová hodnota", values: s.co2raw }]} />
          : <p className="muted">V tomto ponoru CO₂ čidlo nic nezaznamenalo.</p>}
      </Card>
      <Card title="Dekomprese">
        <LineChart t={s.t} series={[
          { label: "NDL / zastávka", color: C[0], values: s.stopt, unit: "min" }, { label: "TTS", color: C[1], values: s.tts, unit: "min" }, { label: "@+5", color: C[2], values: s.at5, unit: "min" },
          { label: "GF99", color: C[3], values: s.gf99, unit: "%" }, { label: "CNS", color: C[4], values: s.cns, unit: "%" },
        ]} extra={depthExtra} />
      </Card>
      <Card title="Tlak v láhvích">
        <LineChart t={s.t} series={[{ label: "Diluent", color: C[0], values: s.dil, unit: "bar" }, { label: "O₂", color: C[2], values: s.o2p, unit: "bar" }]} extra={depthExtra} />
        <p className="note">Hodnota kolem 8–11 bar u O₂ odpovídá mezitlaku prvního stupně, ne tlaku v láhvi.</p>
      </Card>
      <Card title="Teplota a baterie">
        <LineChart t={s.t} series={[{ label: "Teplota", color: C[1], values: s.temp, unit: "°C" }, { label: "Baterie", color: C[4], values: s.bv, unit: "V", right: true }]} extra={depthExtra} />
      </Card>
      <Card title="Rychlost (+ = výstup)">
        <LineChart t={s.t} zero series={[{ label: "Rychlost", color: C[0], values: vrate, unit: "m/min" }]} extra={depthExtra} />
      </Card>
      <Card title="Nasycení tkání N₂">
        <TissueMap snaps={d.tissues.map((x) => ({ t: x.t, v: x.n2 }))} end={s.t[s.t.length - 1]} />
      </Card>
      {hasHe && <Card title="Nasycení tkání He"><TissueMap snaps={d.tissues.map((x) => ({ t: x.t, v: x.he }))} end={s.t[s.t.length - 1]} /></Card>}
    </>
  );
}

function ValuesTab({ d }: { d: Dive }) {
  const h = d.h, sm = summarize(d);
  const cal = cellCalibration(d);
  return (
    <Card title="Všechny hodnoty z hlavičky a patičky">
      <p className="note">J = jisté, P = pravděpodobné, H = hypotéza.</p>
      <KV rows={[
        ["Začátek", fmtDateTime(h.start), "J"], ["Konec", fmtDateTime(h.end), "J"], ["Režim", h.mode, "J"],
        ["Povrchový interval", h.siMin == null ? ">45 dní" : `${Math.floor(h.siMin / 60)} h ${h.siMin % 60} min`, "J"],
        ["GF", `${h.gfLo}/${h.gfHi}`, "J"], ["CNS začátek / konec", `${h.cnsStart} / ${h.cnsEnd} %`, "J"],
        ["Max. strop / TTS", `${sm.ceilMax} m / ${sm.ttsMax} min`, "J"],
        ["Deko na zastávkách / v deko režimu", `${sm.decoMin} / ${sm.decoModeMin} min`, "J"], ["GF99 na konci", sm.gf99End ?? "–", "J"],
        ["Max. klesání / výstup", `${sm.descMax} / ${sm.ascMax} m/min`, "J"],
        ["Setpointy", `${h.spLo} / ${h.spHi} bar`, "P"], ["OC plyny", h.ocGases.join(", ") || "–", "J"], ["Diluenty", h.ccGases.join(", ") || "–", "P"],
        ["pO₂ min / max", `${sm.ppo2Min} / ${sm.ppo2Max} bar`, "J"],
        ["Kalibrace článků (odvozená)", cal.map((c) => (c ? (c * 1000).toFixed(1) : "–")).join(" / ") + " mbar/mV", "P"],
        ["Max. ppCO₂", sm.co2Max != null ? `${sm.co2Max} mbar` : "–", "P"],
        ["Teplota min / max", `${sm.tempMin} / ${sm.tempMax} °C`, "J"],
        ["Atmosférický tlak", `${h.surfP} → ${h.surfPEnd} mbar`, "J"], ["Salinita", `${h.salinity} kg/m³`, "J"],
        ["Baterie", h.batType, "P"], ["Napětí začátek / min / konec", `${h.batVStart.toFixed(2)} / ${sm.batVMin.toFixed(2)} / ${h.batVEnd.toFixed(2)} V`, "P"],
        ["Baterie %", `${h.batPctStart} → ${h.batPctEnd} %`, "P"], ["Prahy varování / kritický", `${h.batWarn} / ${h.batCrit} V`, "H"],
        ["Scrubber celkem", hm(h.scrubTotalMin), "P"], ["Scrubber zbývá na začátku / na konci", `${hm(h.scrubLeftStartMin)} / ${hm(h.scrubLeftEndMin)}`, "P"],
        ["Diluent začátek / konec", `${num(sm.dilStart, 0)} / ${num(sm.dilEnd, 0)} bar`, "J"], ["O₂ začátek / konec", `${num(sm.o2Start, 0)} / ${num(sm.o2End, 0)} bar`, "J"],
        ["Doba zapnutí počítače", `${h.onTimeH} h`, "P"], ["Verze logu", h.logVersion, "P"], ["Vzorkování", `${h.rateS} s`, "J"],
        ["Sériové číslo", h.serial.toString(16).toUpperCase(), "J"], ["Vzorků / snímků tkání", `${d.s.t.length} / ${d.tissues.length}`],
      ]} />
    </Card>
  );
}

function EventsTab({ d }: { d: Dive }) {
  return (
    <Card title="Události v záznamu">
      <p className="note">Bez CO₂ (to je v grafu). Popisy u typů 0, 1, 9, 10 a 0x51 jsou odhad.</p>
      <table className="kv"><thead><tr><th>Čas</th><th>Typ</th><th>Význam / data</th></tr></thead>
        <tbody>{d.events.map((e, i) => <tr key={i}><td>{Math.round(e.t / 60)}′</td><td>{e.kind}</td><td>{e.label}<br /><code>{e.payload}</code></td></tr>)}</tbody>
      </table>
    </Card>
  );
}
