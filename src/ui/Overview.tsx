import { useEffect, useRef, useState } from "react";
import { alerts, scrubberInfo } from "../core/analysis";
import { createDraft, importDb, localNow, locate, nearestSite, toast, upsertSite } from "../app/store";
import { AlertBox, Card, RATING, Tiles, fmtDate, fmtDateTime, go, hm, num, useStore } from "./common";
import { CellTiles, useCells } from "./Cells";
import { hasExt } from "./Dives";
import type { Meta } from "../app/model";
import { BatteryTiles, useBatteries } from "./Batteries";

export function ImportButton({ label = "Importovat export ze Shearwater Cloud" }: { label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className="btn" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Načítám…" : label}</button>
      <input ref={ref} type="file" hidden onChange={async (e) => {
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

/** Úroveň dlaždice scrubberu: čas pod polovinou nebo starý sorbent = oranžová, poslední čtvrtina = červená. */
function scrubLevel(sc: NonNullable<ReturnType<typeof scrubberInfo>>, scrubDays: number) {
  const old = sc.days != null && sc.days >= scrubDays;
  const timeLvl = sc.pct <= 25 ? "bad" : sc.pct <= 50 || old ? "warn" : "ok";
  return { old, timeLvl, ageLvl: old ? "warn" : "ok", lvl: timeLvl === "bad" ? "bad" : timeLvl === "warn" || old ? "warn" : "ok" };
}

/** Hláška nad scrubberem podle oranžových/červených stavů O₂ čidel, baterií a scrubberu (CO₂ se nepočítá). */
let mottoHidden = false; // schová se do příštího spuštění aplikace
function Motto() {
  const st = useStore();
  const [, force] = useState(0);
  const c = useCells();
  const b = useBatteries();
  if (mottoHidden || st.lb.settings.motto === false || !st.metas.length) return null;
  const hide = () => { mottoHidden = true; force((x) => x + 1); };
  const sc = scrubberInfo(st.metas.map((m) => m.h), localNow(), st.lb.settings.th, st.lb.settings.manualFill);
  const lv: string[] = [];
  if (sc) lv.push(scrubLevel(sc, st.lb.settings.th.scrubDays).lvl);
  if (c.ccr.length) c.status.forEach((s) => lv.push(s.level));
  b.petrelAlerts.forEach((a) => lv.push(a.level));
  b.head.forEach((x) => x.reasons.length && lv.push("warn"));
  const worst = lv.includes("bad") ? "bad" : lv.includes("warn") ? "warn" : "ok";
  return worst === "ok"
    ? <div className="motto ok" onClick={hide}>Všecko v cajku, jdeme na to!</div>
    : <div className={"motto " + worst} onClick={hide}>Mám warningy, nevysereme se dnes na to?!</div>;
}

function ScrubberTile() {
  const st = useStore();
  const lb = st.lb;
  const sc = scrubberInfo(st.metas.map((m) => m.h), localNow(), lb.settings.th, lb.settings.manualFill);
  if (!sc) return null;
  const { timeLvl, ageLvl, lvl } = scrubLevel(sc, lb.settings.th.scrubDays);
  return (
    <section className={"card scrub " + lvl}>
      <h2>Scrubber</h2>
      <div className="sc-two">
        <div><b className={"c-" + timeLvl}>{hm(sc.left)}</b><small>zbývá</small></div>
        <div className="r"><b className={"c-" + ageLvl}>{sc.days != null ? `${sc.days} dní` : "–"}</b><small>stáří</small></div>
      </div>
      <div className={"sc-bar " + timeLvl}><i style={{ width: `${sc.pct}%` }} /></div>
      <div className="sc-s">{sc.fill ? `výměna ${fmtDate(sc.fill)}` : "datum výměny neznámé"} · celkem {hm(sc.total)}</div>
    </section>
  );
}

/** TMX = diluent na začátku ponoru jiný než vzduch (helium nebo O₂ ≠ 21 %), AIR = vzduch. */
const isAirDil = (m: Meta) => (m.sum.dilUsed.split(",")[0] || "").trim() === "21/0";
function DeepestTile() {
  const st = useStore();
  const pick = (air: boolean) => st.metas.filter((m) => isAirDil(m) === air).reduce<Meta | null>((b, m) => (!b || m.h.maxDepth > b.h.maxDepth ? m : b), null);
  const tmx = pick(false), air = pick(true);
  const cell = (lbl: string, m: Meta | null) => (
    <span className={"dp" + (m ? " link" : "")} onClick={(e) => { e.stopPropagation(); if (m) go({ t: "dive", id: m.id }); }}>
      {m ? `${num(m.h.maxDepth)} m` : "–"}<small className="sub">{lbl}</small>
    </span>
  );
  return <span className="dp2">{cell("TMX", tmx)}{cell("AIR", air)}</span>;
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
  const batAl = [...bySerial].filter(([ser]) => ser !== lastSer).flatMap(([ser, ms]) => alerts(ms.map((m) => m.h), localNow(), lb.settings.th, null, lb.settings.batSwap?.[String(ser)])
    .filter((a) => a.kind !== "scrubber").map((a) => (multi ? { ...a, title: `${a.title} (počítač ${ser.toString(16).toUpperCase()})` } : a)));
  const drafts = Object.values(lb.drafts).sort((a, b) => b.created - a.created);
  const last = st.metas[st.metas.length - 1];
  const lastNote = last ? lb.notes[last.id] : undefined;
  const near = nearestSite();
  const here = near && near.km <= 2 ? near.site : null;
  const totalMin = st.metas.reduce((a, m) => a + m.h.diveTimeS, 0) / 60;
  const longest = st.metas.reduce((b, m) => (m.h.diveTimeS > b.h.diveTimeS ? m : b), st.metas[0]);
  return (
    <div className="screen">
      <Motto />
      <ScrubberTile />
      <CellTiles />
      <BatteryTiles />


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
          <p className="muted last-date">č. {st.metas.length} · {fmtDate(last.start)} {lastNote?.rating ? RATING[lastNote.rating].icon : ""}</p>
          {lastNote?.siteId && lb.sites[lastNote.siteId]
            ? <p className="last-site link" onClick={() => go({ t: "site", id: lastNote.siteId! })}>📍 {lb.sites[lastNote.siteId].name}</p>
            : <p className="last-site muted link" onClick={() => go({ t: "dive", id: last.id })}>lokalita nezadaná ›</p>}
          <Tiles items={[
            ["Hloubka", <>{num(last.h.maxDepth)} m<small className="sub">prům. {num(last.sum.avgDepth)} m</small></>],
            ["Doba", <><span className="toggle" onClick={() => setHmDur(!hmDur)}>{hmDur ? hm(last.h.diveTimeS / 60) : `${Math.round(last.h.diveTimeS / 60)} min`}</span><small className="sub">{last.sum.decoMin ? `deko ${last.sum.decoMin} min` : "bez deko"}</small></>],
            ["Diluent", <>{hasExt(last, lastNote, "dil") && <span className="extflag">EXT</span>}<span className="nw">{num(last.sum.dilStart, 0)} → {num(last.sum.dilEnd, 0)}</span><small className="sub">bar</small></>],
            ["O₂", <>{hasExt(last, lastNote, "o2") && <span className="extflag">EXT</span>}<span className="nw">{num(last.sum.o2Start, 0)} → {num(last.sum.o2End, 0)}</span><small className="sub">bar{(last.sum.o2Start ?? 99) < 20 && (last.sum.o2End ?? 99) < 20 ? " · nejspíš mezitlak" : ""}</small></>],
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
            ["Ponorů", st.metas.length, () => go({ t: "dives" })], ["Pod vodou", hm(totalMin)],
            ["Lokalit", Object.keys(lb.sites).length, () => go({ t: "sites" })], ["Buddy", Object.keys(lb.buddies).length, () => go({ t: "buddies" })],
            ["Nejhlubší", <DeepestTile />],
            ["Nejdelší", hm(longest.h.diveTimeS / 60), () => go({ t: "dive", id: longest.id })],
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
