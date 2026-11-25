import { askText } from "../app/dialog";
import { isCC } from "../core/rig";
import { useEffect, useRef, useState } from "react";
import { alerts, scrubberInfo } from "../core/analysis";
import { compName, computerCfg, rigInfo, setComputerRig, createDraft, importDb, localNow, locate, nearestSite, toast, upsertSite } from "../app/store";
import { AlertBox, Card, RATING, Tiles, fmtDate, fmtDateTime, go, hm, num, useStore } from "./common";
import { CellTiles, useCells } from "./Cells";
import { hasExt, suitUseOf } from "./Dives";
import type { Meta } from "../app/model";
import { BatteryTiles, useBatteries } from "./Batteries";
import { BleDownload } from "./BleDownload";
import { LineChart } from "./Chart";
import { SURF_GF_LIM } from "../app/noteWarns";

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
  const ccH = st.metas.filter((m) => isCC(m.h)).map((m) => m.h); // scrubber a čidla jen u CC ponorů
  const sc = ccH.length ? scrubberInfo(ccH, localNow(), st.lb.settings.th, st.guest ? null : st.lb.settings.manualFill) : null;
  const lv: string[] = [];
  if (sc) lv.push(scrubLevel(sc, st.lb.settings.th.scrubDays).lvl);
  if (c.ccr.length && ccH.length) c.status.forEach((s) => lv.push(s.level));
  b.petrelAlerts.forEach((a) => lv.push(a.level));
  b.head.forEach((x) => x.reasons.length && lv.push(x.suspect ? "bad" : "warn"));
  const worst = lv.includes("bad") ? "bad" : lv.includes("warn") ? "warn" : "ok";
  return worst === "ok"
    ? <div className="motto ok" onClick={hide}>Všecko v cajku, jdeme na to!</div>
    : <div className={"motto " + worst} onClick={hide}>Mám warningy, nevysereme se dnes na to?!</div>;
}

/** Scrubber u rebreatheru bez časovače v logu (např. pSCR s Peregrine v Gauge módu): ruční datum naplnění a výdrž u počítače. */
function ManualScrubTile() {
  const st = useStore(), th = st.lb.settings.th;
  const last = st.metas[st.metas.length - 1];
  if (!last) return null;
  const ri = rigInfo(last.h.serial, last.id, last.h);
  if (!ri.rig || ri.rig === "OC") return null;
  const cfg = computerCfg(last.h.serial), fill = cfg?.scrubFill, lim = cfg?.scrubMin;
  const used = fill ? st.metas.filter((m) => m.h.serial === last.h.serial && m.start >= fill - 43200).reduce((a, m) => a + m.h.diveTimeS, 0) / 60 : null;
  const left = lim && used != null ? Math.max(0, lim - used) : null;
  const days = fill ? Math.floor((localNow() - fill) / 86400) : null;
  const old = days != null && days >= th.scrubDays;
  const timeLvl = left == null ? "none" : left < 30 ? "bad" : left < (th.scrubLeftMin ?? 90) ? "warn" : "ok";
  const lvl = timeLvl === "bad" ? "bad" : timeLvl === "warn" || old ? "warn" : !fill ? "warn" : "ok";
  const setFill = async () => {
    const v = await askText("Datum naplnění sorbentu (d. m. rrrr, prázdné = dnes)", fill ? fmtDate(fill) : "");
    if (v == null) return;
    const m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(v.trim());
    const t = m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) / 1000 : v.trim() ? NaN : localNow() - (localNow() % 86400);
    if (Number.isNaN(t)) { toast("Neplatné datum"); return; }
    await setComputerRig(last.h.serial, { scrubFill: t });
  };
  const setLim = async () => {
    const v = await askText("Výdrž náplně scrubberu (min) – podle výrobce přístroje", lim ? String(lim) : "");
    if (v != null) await setComputerRig(last.h.serial, { scrubMin: Math.round(+v.replace(",", ".")) || undefined });
  };
  return (
    <section className={"card scrub " + lvl}>
      <h2>Scrubber <small className="muted">{compName(last.h.serial)} · {ri.rig} · ručně</small></h2>
      <div className="sc-two">
        <div onClick={setLim}><b className={"c-" + timeLvl}>{left != null ? hm(left) : used != null ? hm(used) : "–"}</b><small>{left != null && lim ? `zbývá ${Math.round((left / lim) * 100)} %` : left != null ? "zbývá" : used != null ? "použito (zadej výdrž ›)" : "zbývá"}</small></div>
        <div className="r" onClick={setFill}><b className={"c-" + (old ? "warn" : "ok")}>{days != null ? `${days} dní` : "–"}</b><small>stáří</small></div>
      </div>
      {left != null && lim ? <div className={"sc-bar " + timeLvl}><i style={{ width: `${Math.round((left / lim) * 100)}%` }} /></div> : null}
      <div className="sc-s"><a onClick={setFill}>{fill ? `naplněno ${fmtDate(fill)}` : "Zadej datum naplnění ›"}</a> · <a onClick={setLim}>{lim ? `výdrž ${hm(lim)}` : "výdrž nezadaná ›"}</a></div>
    </section>
  );
}

function ScrubberTile() {
  const st = useStore();
  const lb = st.lb;
  const sc = scrubberInfo(st.metas.map((m) => m.h), localNow(), lb.settings.th, st.guest ? null : lb.settings.manualFill);
  if (!sc) return null;
  const { timeLvl, ageLvl, lvl } = scrubLevel(sc, lb.settings.th.scrubDays);
  return (
    <section className={"card scrub " + lvl}>
      <h2>Scrubber</h2>
      <div className="sc-two">
        <div><b className={"c-" + timeLvl}>{hm(sc.left)}</b><small>zbývá {Math.round(sc.pct)} %</small></div>
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

// easter egg: dvojklik na „Kde jsem“
const EGG = ["Cype, ty jsi pěkně v piči, když ani nevíš, kaj jsi!", "Dycky Most!", "Kaj su? Šak v prdeli, jak dycky.", "Pyčo, GPS ti nepomože, ty se ztratíš aj na hajzlu.", "Ty vole, aj kompas by s tebu skončil.", "Kaj jsi? Na šachtě, ne? Šak tma je jak v řiti.", "Cype, pod vodu nevíš kaj, nad vodu taky ne. Talent!", "Šak se podívej kolem, ty kokote, je tam voda.", "Dycky Ostrava, aj kdyby to byl Egypt.", "Kurva, dyť jsi tu byl minule, ne?", "Pyčo, buddy ví kaj je. A ty?", "Kaj jsi? V piči. Kaj jinde, cype.", "Ty se ztratíš aj s navigací v řiti.", "Šak ti to tu hlídám, ty vole, a ty eště furt nevíš.", "Cype, Strany potápěčské to vědí, jen ty ne.", "Jak se ti tu líbí, ty ztracená duše?", "Kaj su, kaj su… Šak u lomu, pyčo!", "Dycky Heřmanice. Aj když nejsou.", "Mapa je na nic, když ji čte kokot.", "Kurva, eště jednu a jdeme do hospody.", "Ty jsi tak ztracený, že tě nenajde aj Petrel.", "Pyčo, napřed se nauč, kaj je sever.", "Kaj jsi? Daleko od rozumu, cype.", "Šak se nestresuj, aj ryba neví, kaj je.", "Dycky je to tam, kaj nejsi ty.", "Cype, eště jednou klikneš a pošlu tě do Mostu.", "Ty vole, aj plovák má lepší orientaci.", "Kaj su? Šak doma neni, to je jisté.", "Pyčo, pod vodu je to jedno, tam si každý v piči.", "Ztratit se umíš líp jak ponořit, cype.", "Slimák ve scrubberu, ty pyčo. To nevymyslíš!", "Staré čínské přísloví říká: nepij vodu z wrapovek po ponoru..."];
let eggBag: number[] = [], eggN = 0;
const EGG_WARN = EGG.findIndex((x) => x.includes("eště jednou klikneš"));
function useEgg() {
  const [text, setText] = useState<string | null>(null);
  const last = useRef(0);
  const tap = () => {
    const n = Date.now();
    if (n - last.current < 500) {
      // každé 4. zobrazení „eště jednou klikneš…“, ostatní náhodně bez opakování v kolečku
      eggN++;
      if (eggN % 4 === 0) setText(EGG[EGG_WARN]);
      else {
        if (!eggBag.length) eggBag = EGG.map((_, i) => i).filter((i) => i !== EGG_WARN).sort(() => Math.random() - 0.5);
        setText(EGG[eggBag.pop()!]);
      }
      last.current = 0;
    } else last.current = n;
  };
  return { text, tap, close: () => setText(null) };
}

export function OverviewScreen() {
  const egg = useEgg();
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
  const batAl = [...bySerial].filter(([ser]) => ser !== lastSer).flatMap(([ser, ms]) => alerts(ms.map((m) => m.h), localNow(), lb.settings.th, null, (st.guest ? null : lb.settings.batSwap?.[String(ser)]))
    .filter((a) => a.kind !== "scrubber").map((a) => (multi ? { ...a, title: `${a.title} (${compName(ser)})` } : a)));
  const drafts = Object.values(lb.drafts).sort((a, b) => b.created - a.created);
  const last = st.metas[st.metas.length - 1];
  const lastNote = last ? lb.notes[last.id] : undefined;
  const near = nearestSite();
  const here = near && near.km <= 2 ? near.site : null;
  const totalMin = st.metas.reduce((a, m) => a + m.h.diveTimeS, 0) / 60;
  // scrubber, čidla, lahve, CO₂ jen u logu s ponory v CC módu (Gauge / OC je nemá)
  const cc = st.metas.some((m) => isCC(m.h));
  const longest = st.metas.reduce((b, m) => (m.h.diveTimeS > b.h.diveTimeS ? m : b), st.metas[0]);
  return (
    <div className="screen">
      <Motto />
      {cc && <ScrubberTile />}
      {!cc && <ManualScrubTile />}
      {cc && <CellTiles />}
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
          <Tiles hide={isCC(last.h) ? [] : ["Diluent", "O₂", "Max. CO₂"]} items={[
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
      {!st.guest && <SurfGfTrend />}
      {!st.guest && <SuitUse />}
      <div className="center"><BleDownload /><ImportButton /></div>

      <Card title="Kde jsem" onTitle={egg.tap} id="where">
        {egg.text && <div className="egg"><span>{egg.text}</span><button className="egg-x" aria-label="Zavřít" onClick={egg.close}>✕</button></div>}
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

/** Trend SurfGF při vynoření (z GF99 Petrelu u hladiny) s hranicí – vypínatelné v Nastavení → Výbava. */
/** Spotřeba na oblek z ponorů s lahví „jenom oblek“. */
function SuitUse() {
  const st = useStore();
  const xs = st.metas.map((m) => ({ m, s: suitUseOf(st.lb.notes[m.id]) })).filter((x) => x.s && x.s.l > 0);
  if (!xs.length) return null;
  const avg = xs.reduce((a, x) => a + x.s!.l, 0) / xs.length;
  const perH = xs.reduce((a, x) => a + x.s!.l, 0) / (xs.reduce((a, x) => a + x.m.h.diveTimeS, 0) / 3600);
  const last = xs[xs.length - 1];
  return (
    <Card title="Oblek">
      <p><b>{Math.round(avg)} l</b> na ponor · {Math.round(perH)} l/h <span className="muted small">({xs.length} {xs.length === 1 ? "ponor" : xs.length < 5 ? "ponory" : "ponorů"} s lahví „jenom oblek“; poslední {fmtDate(last.m.start)}: {Math.round(last.s!.l)} l)</span></p>
    </Card>
  );
}

function SurfGfTrend() {
  const st = useStore();
  const set = st.lb.settings;
  if (set.surfGfOff) return null;
  const lim = set.surfGfLim || SURF_GF_LIM;
  const ms = st.metas.filter((m) => m.sum.surfGF != null && m.sum.ceilMax > 0);
  if (ms.length < 3) return null;
  const over = ms.filter((m) => m.sum.surfGF! > lim);
  const vals = ms.map((m) => m.sum.surfGF!).sort((a, b) => a - b);
  return (
    <Card title="SurfGF při vynoření">
      <LineChart t={ms.map((_, i) => i + 1)} height={140} xFmt={(v) => { const m = ms[Math.round(v) - 1]; return m ? new Date(m.start * 1000).toLocaleDateString("cs-CZ", { month: "numeric", year: "2-digit" }) : ""; }}
        xTitle={(v) => { const m = ms[v - 1]; return m ? `${fmtDate(m.start)} · mělko ${m.sum.shallowMin ?? "?"} min` : ""; }}
        series={[{ label: "SurfGF", color: "#4fc3f7", values: ms.map((m) => m.sum.surfGF!), unit: "%", width: 2 }, { label: "Hranice", color: "#ffb74d", values: ms.map(() => lim), unit: "%", dash: "4 3" }]} />
      <p className="note">Ponory se stropem: medián {vals[vals.length >> 1]} %, nad hranicí {lim} %: {over.length}{over.length ? ` (naposledy ${fmtDate(over[over.length - 1].start)})` : ""}. Hodnota = GF99 z Petrelu v prvním vzorku u hladiny.</p>
    </Card>
  );
}

function BatteryMini() {
  const b = useBatteries();
  const h = b.last?.h;
  return (
    <div className="batmini">
      <div><span>{h ? compName(h.serial) : "Počítač"}</span><br />{h ? `${h.batVStart.toFixed(2).replace(".", ",")} → ${h.batVEnd.toFixed(2).replace(".", ",")} V` : "–"}</div>
      {!b.guest && h && isCC(h) && b.head.map((x) => <div key={x.pos}><span>Hlava {x.pos}</span>{x.cur ? `${num(x.minutes / 60, 1)} h` : "–"}</div>)}
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
