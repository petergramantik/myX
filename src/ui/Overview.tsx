import { useEffect, useRef, useState } from "react";
import { alerts, scrubberInfo } from "../core/analysis";
import { createDraft, importDb, localNow, locate, nearestSite, toast, upsertSite } from "../app/store";
import { AlertBox, Card, RATING, Tiles, fmtDate, fmtDateTime, go, hm, num, useStore } from "./common";
import { CellTiles } from "./Cells";
import { BatteryTiles, useBatteries } from "./Batteries";

export function ImportButton({ label = "Importovat export ze Shearwater Cloud" }: { label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className="btn" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Načítám…" : label}</button>
      <input ref={ref} type="file" accept=".db,application/octet-stream,application/x-sqlite3,*/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setBusy(true);
        try { const n = await importDb(f); toast(n ? `Přidáno ponorů: ${n}` : "Žádné nové ponory"); }
        catch (err) { toast("Import selhal: " + (err as Error).message); }
        finally { setBusy(false); }
      }} />
    </>
  );
}

function ScrubberTile() {
  const st = useStore();
  const lb = st.lb;
  const sc = scrubberInfo(st.metas.map((m) => m.h), localNow(), lb.settings.th, lb.settings.manualFill);
  if (!sc) return null;
  const lvl = sc.alerts.some((a) => a.level === "bad") ? "bad" : sc.alerts.length ? "warn" : "ok";
  const used = sc.total - sc.left;
  return (
    <section className={"card scrub " + lvl} onClick={() => go({ t: "settings" })}>
      <div className="sc-h"><h2>Scrubber</h2><span>zbývá {sc.pct} %</span></div>
      <div className="sc-v">{hm(sc.left)} <small>zbývá</small></div>
      <div className="sc-u">použito {hm(used)} ze {hm(sc.total)}</div>
      <div className="sc-bar"><i style={{ width: `${sc.pct}%` }} /><b style={{ left: `${lb.settings.th.scrubPct}%` }} /></div>
      <div className="sc-lg"><span>◼ zbývá</span><span>◻ použito</span></div>
      <div className="sc-s">{sc.fill ? `Náplň od ${fmtDate(sc.fill)} · ${sc.days} dní` : "Datum náplně neznámé"}</div>
      {sc.alerts.map((a, i) => <div key={i} className={"sc-a " + a.level}>⚠ {a.title}: {a.text}</div>)}
    </section>
  );
}

export function OverviewScreen() {
  const st = useStore();
  useEffect(() => { if (!st.pos) locate(); }, []);
  const lb = st.lb;
  const [busy, setBusy] = useState(false);
  const [hmDur, setHmDur] = useState(false);
  // baterie zvlášť pro každý počítač (sériové číslo)
  const bySerial = new Map<number, typeof st.metas>();
  for (const m of st.metas) bySerial.set(m.h.serial, [...(bySerial.get(m.h.serial) || []), m]);
  const multi = bySerial.size > 1;
  const lastSer = st.metas[st.metas.length - 1]?.h.serial;
  const batAl = [...bySerial].filter(([ser]) => ser !== lastSer).flatMap(([ser, ms]) => alerts(ms.map((m) => m.h), localNow(), lb.settings.th, null)
    .filter((a) => a.kind !== "scrubber").map((a) => (multi ? { ...a, title: `${a.title} (počítač ${ser.toString(16).toUpperCase()})` } : a)));
  const drafts = Object.values(lb.drafts).sort((a, b) => b.created - a.created);
  const last = st.metas[st.metas.length - 1];
  const lastNote = last ? lb.notes[last.id] : undefined;
  const near = nearestSite();
  const here = near && near.km <= 2 ? near.site : null;
  const totalMin = st.metas.reduce((a, m) => a + m.h.diveTimeS, 0) / 60;
  return (
    <div className="screen">
      <ScrubberTile />
      <CellTiles />
      <BatteryTiles />
      {batAl.map((a, i) => <AlertBox key={i} a={a} />)}


      {drafts.length > 0 && (
        <Card title="Čekají na data z počítače">
          {drafts.map((d) => (
            <div key={d.id} className="list-item flat" onClick={() => go({ t: "draft", id: d.id })}>
              <div className="li-main"><b>{d.siteId ? lb.sites[d.siteId]?.name : "bez lokality"}</b><small>{fmtDateTime(d.created)}{d.buddyIds.length ? " · " + d.buddyIds.map((b) => lb.buddies[b]?.name).join(", ") : ""}</small></div>
              {d.rating && <span className="rate">{RATING[d.rating].icon}</span>}
            </div>
          ))}
        </Card>
      )}

      {last ? (
        <Card title="Poslední ponor" right={<a onClick={() => go({ t: "dive", id: last.id })}>Detail ›</a>}>
          <p className="muted">č. {st.metas.length} · {fmtDate(last.start)} · {lastNote?.siteId ? lb.sites[lastNote.siteId]?.name : "lokalita nezadaná"} {lastNote?.rating ? RATING[lastNote.rating].icon : ""}</p>
          <Tiles items={[
            ["Hloubka", <>{num(last.h.maxDepth)} m<small className="sub">prům. {num(last.sum.avgDepth)} m</small></>],
            ["Doba", <><span className="toggle" onClick={() => setHmDur(!hmDur)}>{hmDur ? hm(last.h.diveTimeS / 60) : `${Math.round(last.h.diveTimeS / 60)} min`}</span><small className="sub">{last.sum.decoMin ? `deko ${last.sum.decoMin} min` : "bez deko"}</small></>],
            ["Diluent", <><span className="pair">{num(last.sum.dilStart, 0)} → {num(last.sum.dilEnd, 0)}</span><small className="sub">bar</small></>],
            ["O₂", <><span className="pair">{num(last.sum.o2Start, 0)} → {num(last.sum.o2End, 0)}</span><small className="sub">bar{(last.sum.o2Start ?? 99) < 20 && (last.sum.o2End ?? 99) < 20 ? " · nejspíš mezitlak" : ""}</small></>],
            ["Max. CO₂", last.sum.co2Max != null ? `${num(last.sum.co2Max, 2)} mbar` : "–"],
            ["Baterie", <BatteryMini />],
          ]} />
        </Card>
      ) : (
        <Card title="Začni importem">
          <p>V aplikaci Shearwater Cloud: <b>Profile → Options → Export Database</b>, ulož soubor a načti ho tady.</p>
        </Card>
      )}

      {st.metas.length > 0 && (
        <Card title="Celkem">
          <Tiles items={[
            ["Ponorů", st.metas.length], ["Pod vodou", hm(totalMin)],
            ["Lokalit", Object.keys(lb.sites).length], ["Parťáků", Object.keys(lb.buddies).length],
          ]} />
        </Card>
      )}
      <div className="center"><ImportButton /></div>

      <Card title="Kde jsem">
        {st.pos ? (
          here ? <p>📍 <a onClick={() => go({ t: "site", id: here.id })}>{here.name}</a> <small className="muted">({num(near!.km * 1000, 0)} m)</small></p> : (
            <>
              <p className="muted">{near ? <>Nejbližší známá lokalita: <a onClick={() => go({ t: "site", id: near.site.id })}>{near.site.name}</a> ({num(near.km, 1)} km)</> : "Zatím nemáš lokality s polohou."}</p>
              <NewSiteHere lat={st.pos.lat} lon={st.pos.lon} />
            </>
          )
        ) : <p className="muted">{st.posErr || "Zjišťuji polohu…"} <a onClick={() => locate()}>Zkusit znovu</a></p>}
      </Card>
      <button className="btn primary big" disabled={busy} onClick={async () => { setBusy(true); try { const id = await createDraft(); go({ t: "draft", id }); } finally { setBusy(false); } }}>
        {busy ? "Zjišťuji polohu…" : "＋ Nový ponor"}
      </button>
    </div>
  );
}

function BatteryMini() {
  const b = useBatteries();
  const h = b.last?.h;
  return (
    <div className="batmini">
      <div><span>Petrel</span><br />{h ? `${h.batVStart.toFixed(2).replace(".", ",")} → ${h.batVEnd.toFixed(2).replace(".", ",")} V` : "–"}</div>
      {b.head.map((x) => <div key={x.pos}><span>Hlava {x.pos}</span>{x.cur ? `${num(x.minutes / 60, 1)} h` : "–"}</div>)}
    </div>
  );
}

function NewSiteHere({ lat, lon }: { lat: number; lon: number }) {
  const [name, setName] = useState("");
  return (
    <div className="row">
      <input value={name} placeholder="Název nové lokality zde" onChange={(e) => setName(e.target.value)} />
      <button className="btn" disabled={!name.trim()} onClick={async () => { const s = await upsertSite({ name: name.trim(), lat, lon }); setName(""); go({ t: "site", id: s.id }); }}>Uložit</button>
    </div>
  );
}
