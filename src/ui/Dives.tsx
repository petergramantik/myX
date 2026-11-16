import { useEffect, useMemo, useRef, useState } from "react";
import type { Dive } from "../core/shearwater";
import { BTN_NAMES, GAS_COLOR, cellCalibration, diveWarnings, gasLabel, gasSegments, o2Doses, realStops, scrName, setpointChanges, summarize } from "../core/analysis";
import { loadDive, myNum, setNote } from "../app/store";
import { cellDiveWarnings } from "../core/cells";
import { norm, uid, type DiveNote, type ExtGas, type Meta } from "../app/model";
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
      <input className="search" placeholder="Hledat lokalitu, buddyho, poznámku, datum…" value={q} onChange={(e) => setQ(e.target.value)} />
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
  const [slide, setSlide] = useState("");
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setD(null); loadDive(id).then(setD).catch((e) => setErr(e.message)); }, [id]);
  const meta = st.metas.find((m) => m.id === id);
  if (!meta) return <div className="screen"><p>Ponor nenalezen.</p></div>;
  const idx = st.metas.indexOf(meta);
  const prev = st.metas[idx - 1], next = st.metas[idx + 1];
  const onTouchStart = (e: React.TouchEvent) => {
    const el = e.target as HTMLElement;
    // grafy a aktivní prvky mají vlastní gesta – tam přejetí ponor nepřepíná
    touch.current = el.closest(".chart, .tile.link, .toggle, button, input, textarea, select, a, label, .picker, .heat") ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touch.current; touch.current = null;
    if (!t0) return;
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (dx < 0 && next) { setSlide("from-right"); go({ t: "dive", id: next.id }); }
    else if (dx > 0 && prev) { setSlide("from-left"); go({ t: "dive", id: prev.id }); }
  };
  return (
    <div className={"screen " + slide} key={id} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onAnimationEnd={() => setSlide("")}>
      <div className="dive-head">
        <button className="btn small" disabled={!prev} onClick={() => { if (prev) { setSlide("from-left"); go({ t: "dive", id: prev.id }); } }}>‹</button>
        <div><b>Ponor {myNum(id)}</b><small>{fmtDateTime(meta.start)} · v počítači #{meta.num}</small></div>
        <button className="btn small" disabled={!next} onClick={() => { if (next) { setSlide("from-right"); go({ t: "dive", id: next.id }); } }}>›</button>
      </div>
      <div className="tabs">
        {([["log", "Logbook"], ["charts", "Grafy"], ["values", "Hodnoty"], ["events", "Události"]] as [Tab, string][]).map(([k, l]) =>
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <DiveTitle id={id} />
      {err && <p className="alert bad">{err}</p>}
      {tab === "log" && <LogTab id={id} d={d} />}
      {tab !== "log" && !d && !err && <p className="muted center">Dekóduji…</p>}
      {tab === "charts" && d && <ChartsTab d={d} />}
      {tab === "values" && d && <ValuesTab d={d} />}
      {tab === "events" && d && <EventsTab d={d} />}
    </div>
  );
}

const DOSE_COLOR = { sol: "#4fc3f7", man: "#ffb74d", amb: "#b39ddb", dil: "#cfd8dc" } as const;
const fmtSp = (v: number) => v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
/** Značky přepnutí setpointu do grafů. */
function spPins(d: Dive) {
  return setpointChanges(d).map((c) => ({ t: c.t, label: `SP ${fmtSp(c.to)}${c.manual ? "" : "?"}`, color: c.to >= 1 ? "#ffb74d" : c.to < 0.3 ? "#b0bec5" : "#81c784" }));
}

/** Lokalita, buddy a poznámka cizího logu – jen k přečtení (ze Shearwater Cloud). */
function GuestNote({ note }: { note: DiveNote }) {
  const lb = useStore().lb;
  const site = note.siteId ? lb.sites[note.siteId]?.name : null;
  const buddies = note.buddyIds.map((b) => lb.buddies[b]?.name).filter(Boolean);
  return (
    <Card title="Logbook (ze Shearwater Cloud)">
      <p>📍 {site || <span className="muted">lokalita nezadaná</span>}</p>
      {buddies.length > 0 && <p>S kým: {buddies.join(", ")}</p>}
      {note.note && <p className="pre">{note.note}</p>}
      <p className="note">Cizí log je jen k prohlížení.</p>
    </Card>
  );
}

function SpTile({ meta }: { meta: Meta }) {
  const up = meta.sum.sp.find((c) => c.to >= 1);
  const man = meta.sum.sp.filter((c) => c.manual).length;
  return <span className="use">{up ? `${fmtSp(up.to)} v ${Math.round(up.t / 60)}. min` : "beze změny"}<small>{up ? `${num(up.depth)} m · ` : ""}{meta.sum.sp.length}× přepnuto{man ? `, ${man}× ručně` : ""}</small></span>;
}

/** Dvě hodnoty v jedné dlaždici: vlevo a vpravo, každá s malým popiskem. */
function Pair({ l, ll, r, rl }: { l: React.ReactNode; ll: string; r: React.ReactNode; rl: string }) {
  return <span className="pair"><span>{l}<small>{ll}</small></span><span className="r">{r}<small>{rl}</small></span></span>;
}

export function GasChips({ mixes }: { mixes: string[] }) {
  return <span className="gas-chips">{mixes.map((m) => { const g = gasLabel(m); return <span key={m} className={"gchip " + g.cls}>{g.label}</span>; })}</span>;
}

const EXT_KINDS: Record<string, number> = { S80: 11.1, S40: 5.7 };
const fmtL = (l: number) => `${Math.round(l)} l`;

/** Osobní rychlost spotřeby O₂ (l/min) z ponorů se známou spotřebou: měřený tlak vlastní lahve nebo zadaná externí lahev. */
export function personalO2Rate(metas: Meta[], notes: Record<string, DiveNote>, cylO2: number): { lo: number; hi: number; n: number } | null {
  const rates: number[] = [];
  for (const m of metas) {
    const min = m.h.diveTimeS / 60;
    if (min < 15) continue;
    const n = notes[m.id];
    if (n?.useManual?.o2 != null) { rates.push(n.useManual.o2 / min); continue; }
    const own = m.sum.o2Use.ok && !m.sum.o2Use.noisy ? m.sum.o2Use.bar * cylO2 : 0;
    const ext = (n?.ext || []).filter((e) => e.gas === "o2" && e.start != null && e.end != null).reduce((a, e) => a + Math.max(0, e.start! - e.end!) * e.vol, 0);
    // vlastní lahev musí být měřená celý ponor (bez externího plynu), nebo musí být zadaná externí lahev
    if ((own && !m.sum.o2Use.ext.length) || ext) rates.push((own + ext) / min);
  }
  const ok = rates.filter((r) => r > 0.4 && r < 3);
  if (ok.length < 2) return null;
  return { lo: Math.min(...ok) * 0.95, hi: Math.max(...ok) * 1.05, n: ok.length };
}

/** Spotřeba plynu ponoru: vlastní lahev (z průběhu tlaku) + externí lahve, nebo ruční údaj. */
function gasUseOf(gas: "dil" | "o2", meta: Meta, note: DiveNote | undefined, vol: number, rate?: { lo: number; hi: number; n: number } | null) {
  const u = gas === "dil" ? meta.sum.dilUse : meta.sum.o2Use;
  const manual = note?.useManual?.[gas];
  const ext = (note?.ext || []).filter((e) => e.gas === gas);
  const extL = ext.reduce((a, e) => a + (e.start != null && e.end != null ? Math.max(0, e.start - e.end) * e.vol : 0), 0);
  const ownL = u.ok && !u.noisy ? u.bar * vol : null;
  const min = meta.h.diveTimeS / 60;
  const metab = rate ? [rate.lo * min, rate.hi * min] as const : [0.8 * min, 1.5 * min] as const;
  return { u, manual, ext, extL, ownL, total: manual ?? (ownL != null || extL ? (ownL || 0) + extL : null), min, metab, personal: !!rate };
}

/** Externí plyn: snímač ukazuje mezitlak, tlak během ponoru výrazně vzrostl, nebo je zadaná externí lahev. */
const extDetected = (u: Meta["sum"]["dilUse"]) => !u.ok || u.ext.length > 0;
export const hasExt = (meta: Meta, note: DiveNote | undefined, gas: "dil" | "o2") =>
  extDetected(gas === "dil" ? meta.sum.dilUse : meta.sum.o2Use) || (note?.ext || []).some((e) => e.gas === gas);

function UseTile(props: { gas: "dil" | "o2"; meta: Meta; note?: DiveNote }) {
  const g0 = gasUseOf(props.gas, props.meta, props.note, 3);
  const ext = extDetected(g0.u) || g0.ext.length > 0;
  return <>{ext && <span className="extflag">EXT</span>}<UseVal {...props} /></>;
}

function UseVal({ gas, meta, note }: { gas: "dil" | "o2"; meta: Meta; note?: DiveNote }) {
  const st = useStore();
  const vol = st.lb.settings.cyl?.[gas] ?? 3;
  const rate = gas === "o2" ? personalO2Rate(st.metas, st.lb.notes, st.lb.settings.cyl?.o2 ?? 3) : null;
  const g = gasUseOf(gas, meta, note, vol, rate);
  if (g.manual != null) return <span className="use">{fmtL(g.manual)}<small>zadáno ručně</small></span>;
  if (g.total != null) return (
    <span className="use">{fmtL(g.total)}<small>{g.u.ok && !g.u.noisy ? `${g.u.bar} bar · ` : ""}{num(g.total / g.min, 1)} l/min{g.extL ? ` · ext. ${fmtL(g.extL)}` : ""}</small></span>
  );
  if (gas === "o2") return <span className="use">~{Math.round(g.metab[0])}–{Math.round(g.metab[1])} l<small>{g.u.noisy ? "tlak nespolehlivý · " : ""}{g.personal ? "osobní odhad" : "odhad z doby"}</small></span>;
  return <span className="use">–<small>{g.u.noisy ? "tlak nespolehlivý" : "zadej tlak externí lahve"}</small></span>;
}

function GasUseCard({ id, meta, note }: { id: string; meta: Meta; note?: DiveNote }) {
  const st = useStore();
  const cyl = st.lb.settings.cyl || { dil: 3, o2: 3 };
  const ext = note?.ext || [];
  const save = (p: Partial<DiveNote>) => setNote(id, p);
  const setExt = (eid: string, p: Partial<ExtGas>, virt?: ExtGas) => save({ ext: virt && !ext.some((e) => e.id === eid) ? [...ext, { ...virt, ...p, id: uid() }] : ext.map((e) => (e.id === eid ? { ...e, ...p } : e)) });
  const n = (v: string) => { const x = parseFloat(v.replace(",", ".")); return Number.isNaN(x) ? undefined : x; };
  const rate = personalO2Rate(st.metas, st.lb.notes, cyl.o2);
  const row = (gas: "dil" | "o2", name: string) => {
    const g = gasUseOf(gas, meta, note, cyl[gas], gas === "o2" ? rate : null);
    const u = g.u;
    return (
      <div className="pcell ptile">
        <div className="pcell-h"><b>{name}</b><span className="muted">vlastní lahev {num(cyl[gas], 1)} l</span></div>
        <small>{u.ok ? <>Tlak {num(u.start ?? 0, 0)} → {num(u.end ?? 0, 0)} bar · spotřeba {u.noisy ? "nespolehlivá (rozkmitaný tlak)" : `${u.bar} bar = ${fmtL(u.bar * cyl[gas])}`}</>
          : <>Plyn z externí lahve ({gas === "o2" ? "S40" : "S80"}) – snímač ukazuje jen mezitlak. Zadej tlak start/end externí lahve.{gas === "o2" ? (rate
            ? ` Do té doby osobní odhad ${Math.round(g.metab[0])}–${Math.round(g.metab[1])} l (tvoje spotřeba ${num(rate.lo, 2)}–${num(rate.hi, 2)} l/min z ${rate.n} ponorů se známou spotřebou).`
            : ` Do té doby obecný metabolický odhad ${Math.round(g.metab[0])}–${Math.round(g.metab[1])} l (0,8–1,5 l/min; osobní odhad bude po 2 ponorech se známou spotřebou O₂).`) : ""}</>}</small>
        {u.ext.length > 0 && <small className="c-warn">Externí plyn nebo zavřená lahev nejspíš: {u.ext.map(([a, b]) => (a === b ? `${a}. min` : `${a}.–${b}. min`)).join(", ")}</small>}
        {(() => {
          const mine = ext.filter((e) => e.gas === gas);
          const kind = gas === "dil" ? "S80" : "S40";
          const virt: ExtGas | null = !mine.length && extDetected(u) ? { id: "auto-" + gas, gas, kind, vol: EXT_KINDS[kind] } : null;
          return st.guest ? [] : virt ? [virt] : mine;
        })().map((e) => (
          <div key={e.id} className="ext-row">
            <select value={e.kind} onChange={(ev) => setExt(e.id, { kind: ev.target.value, vol: EXT_KINDS[ev.target.value] ?? e.vol }, e)}>
              {["S80", "S40", "jiná"].map((k) => <option key={k}>{k}</option>)}
            </select>
            <input inputMode="decimal" defaultValue={e.vol} title="Objem (l)" onBlur={(ev) => n(ev.target.value) !== e.vol && setExt(e.id, { vol: n(ev.target.value) ?? e.vol }, e)} /><span>l</span>
            <input inputMode="decimal" defaultValue={e.start ?? ""} placeholder="start bar" onBlur={(ev) => n(ev.target.value) !== e.start && setExt(e.id, { start: n(ev.target.value) }, e)} />
            <input inputMode="decimal" defaultValue={e.end ?? ""} placeholder="end bar" onBlur={(ev) => n(ev.target.value) !== e.end && setExt(e.id, { end: n(ev.target.value) }, e)} />
            <button className="btn small" onClick={() => save({ ext: ext.filter((x) => x.id !== e.id) })}>✕</button>
          </div>
        ))}
        {!st.guest && <div className="row">
          <button className="btn" onClick={() => { const kind = gas === "dil" ? "S80" : "S40"; save({ ext: [...ext, { id: uid(), gas, kind, vol: EXT_KINDS[kind] }] }); }}>+ Externí lahev</button>
          <label className="inline">Ručně (l)<input inputMode="decimal" defaultValue={note?.useManual?.[gas] ?? ""} placeholder="–"
            onBlur={(ev) => save({ useManual: { ...note?.useManual, [gas]: n(ev.target.value) } })} /></label>
        </div>}
      </div>
    );
  };
  return (
    <Card title="Spotřeba plynu">
      {row("dil", "Diluent")}
      {row("o2", "O₂")}
      <p className="note">Spotřeba z vlastní lahve = součet poklesů tlaku (malé nárůsty z ohřátí se odečtou, větší nárůst nebo mezitlak = externí plyn). Externí lahev Petrel neměří – zadej typ a tlak start/end. Ruční údaj má přednost. Objemy vlastních lahví nastavíš v Nastavení.</p>
    </Card>
  );
}

function DiveTitle({ id }: { id: string }) {
  const st = useStore();
  const lb = st.lb;
  const meta = st.metas.find((m) => m.id === id);
  const note = lb.notes[id];
  const site = note?.siteId ? lb.sites[note.siteId] : null;
  const buddies = (note?.buddyIds || []).map((b) => lb.buddies[b]?.name).filter(Boolean);
  if (!site) return null;
  return (
    <div className="dive-title">
      <h2 onClick={() => go({ t: "site", id: site.id })}>{site.name}</h2>
      <small>{meta ? fmtDate(meta.start) : ""}{buddies.length ? ` · ${buddies.join(", ")}` : ""}</small>
    </div>
  );
}

function LogTab({ id, d }: { id: string; d: Dive | null }) {
  const st = useStore();
  const lb = st.lb;
  const meta = st.metas.find((m) => m.id === id)!;
  const note = lb.notes[id] || { buddyIds: [], note: "", updated: 0 };
  const idx = st.metas.indexOf(meta);
  const warns = [...(d ? diveWarnings(d, summarize(d), lb.settings.th) : []), ...cellDiveWarnings(st.metas, idx, lb.settings.th)];
  return (
    <>
      {warns.map((a, i) => <AlertBox key={i} a={a} />)}
      <Card title="V kostce" right={<GasChips mixes={meta.sum.gases.map((g) => g.mix)} />}>
        <Tiles cols={2} cls={{ "Max. pO₂": meta.sum.ppo2Max > 1.6 ? "hot" : "", "Max. pN₂": meta.sum.pn2Max > 3.5 ? "hot" : "" }} items={[
          ["Hloubka", <Pair l={`${num(meta.h.maxDepth)} m`} ll="max" r={`${num(meta.sum.avgDepth)} m`} rl="průměr" />],
          ["Doba", <Pair l={`${Math.round(meta.h.diveTimeS / 60)} min`} ll="ponor" r={meta.sum.decoMin ? `${meta.sum.decoMin} min` : "–"} rl="deko" />],
          ["Plyny", <span className="gas-list">{meta.sum.gases.map((g) => <span key={g.mix}><b>{gasLabel(g.mix).label}</b><small>{Math.round(g.s / 60)} min</small></span>)}</span>],
          ["Teplota", <Pair l={`${meta.sum.tempMin} °C`} ll="min" r={`${meta.sum.tempMax} °C`} rl="max" />],
          ["Max. pO₂", `${num(meta.sum.ppo2Max, 2)} bar`],
          ["Max. pN₂", `${num(meta.sum.pn2Max, 2)} bar`],
          ["Max. CO₂", meta.sum.co2Max != null ? `${num(meta.sum.co2Max, 2)} mbar` : "–"],
          ["GF / CNS", <Pair l={`${meta.h.gfLo}/${meta.h.gfHi}`} ll="GF" r={`${meta.h.cnsEnd} %`} rl="CNS" />],
          ["Diluent", <UseTile gas="dil" meta={meta} note={note} />], ["O₂", <UseTile gas="o2" meta={meta} note={note} />],
          ["Baterie", <Pair l={`${meta.h.batVStart.toFixed(2).replace(".", ",")} V`} ll="start" r={`${meta.h.batVEnd.toFixed(2).replace(".", ",")} V`} rl="end" />],
          ["Scrubber zbývá", hm(meta.h.scrubLeftEndMin)],
          ["Dávkování O₂", <Pair l={meta.sum.dose.sol} ll="solenoid" r={meta.sum.dose.man} rl="ručně" />],
          ["Setpoint", <SpTile meta={meta} />],
        ]} />
      </Card>
      {d ? <ProfileCard d={d} /> : <p className="muted center">Dekóduji…</p>}
      {st.guest ? <GuestNote note={note} /> : <NoteEditor note={note} onChange={(p) => setNote(id, p)} />}
      <GasUseCard id={id} meta={meta} note={note} />
    </>
  );
}

function ProfileCard({ d }: { d: Dive }) {
  const s = d.s;
  const [btns, setBtns] = useState(false);
  const stops = useMemo(() => realStops(d), [d]);
  const first = stops.findIndex((v) => v != null);
  const lastStop = stops.length - 1 - [...stops].reverse().findIndex((v) => v != null);
  // tenká spojnice mezi úseky skutečných zastávek (hloubka zastávky podle počítače)
  const link = useMemo(() => s.stop.map((v, i) => (first >= 0 && i >= first && i <= lastStop && v > 0 ? v : null)), [d]);
  const segs = useMemo(() => gasSegments(d).map((g) => ({ ...g, color: GAS_COLOR[gasLabel(g.mix).cls], label: gasLabel(g.mix).label })), [d]);
  const gasAt = useMemo(() => s.o2.map((o, i) => gasLabel(`${o}/${s.he[i]}`).label), [d]);
  return (
    <Card title="Profil a dekompresní strop">
      <LineChart t={s.t} invert height={220} series={[
        { label: "Hloubka", color: C[0], values: s.depth, unit: "m", width: 2 }, { label: "Strop", color: C[5], values: s.ceil, unit: "m", fillUp: true },
        { label: "", color: C[1], values: link, width: 1 },
        { label: "Zastávka", color: C[1], values: stops, unit: "m", width: 3 },
      ]} vlines={first >= 0 ? [{ t: s.t[first], to: stops[first]!, color: C[1] }] : undefined} strip={segs} pins={spPins(d)} marks={btns ? d.buttons.filter((b) => b.t >= 0 && b.t <= d.h.diveTimeS).map((b) => ({ t: b.t, color: b.btn === 2 ? "#ffb74d" : "#b0bec5" })) : undefined} extra={[{ label: "Plyn", values: gasAt }, { label: "Teplota", values: s.temp, unit: "°C" }, { label: "pO₂", values: s.ppo2, unit: "bar" }, { label: "TTS", values: s.tts, unit: "min" }]} />
      <p className="note">Zastávka = úseky, kdy jsi byl na dekompresní zastávce (nejvýš 3 m pod její hloubkou). Vyplněná plocha nad stropem je zakázaná zóna. Barevný pruh dole = použitý plyn. Svislé čárkované značky SP = přepnutí setpointu (? = bez potvrzené obsluhy Petrelu).
        {d.buttons.length > 0 && <> <label className="inline"><input type="checkbox" checked={btns} onChange={(e) => setBtns(e.target.checked)} /> stisky tlačítek</label></>}</p>
    </Card>
  );
}

function ChartsTab({ d }: { d: Dive }) {
  const s = d.s;
  const [cellMode, setCellMode] = useState<"cal" | "mv">("cal");
  const cal = useMemo(() => cellCalibration(d), [d]);
  const doses = useMemo(() => o2Doses(d), [d]);
  const vrate = useMemo(() => s.depth.map((_, i) => {
    const a = Math.max(0, i - 3), b = Math.min(s.t.length - 1, i + 3);
    return s.t[b] === s.t[a] ? 0 : +(-(s.depth[b] - s.depth[a]) / (s.t[b] - s.t[a]) * 60).toFixed(1);
  }), [d]);
  const cells = [s.mv1, s.mv2, s.mv3].map((mv, k) => cellMode === "mv" ? mv : mv.map((v) => (cal[k] ? +(v * cal[k]!).toFixed(2) : null)));
  const hasHe = d.tissues.some((x) => x.he.some((v) => v > 0.02));
  const depthExtra = [{ label: "Hloubka", values: s.depth, unit: "m" }];
  return (
    <>
      <ProfileCard d={d} />
      <Card title="pO₂ a čidla" right={
        <div className="seg"><button className={cellMode === "cal" ? "on" : ""} onClick={() => setCellMode("cal")}>pO₂</button><button className={cellMode === "mv" ? "on" : ""} onClick={() => setCellMode("mv")}>mV</button></div>}>
        {cellMode === "cal" ? (
          <LineChart t={s.t} marks={doses.map((x) => ({ t: x.t, color: DOSE_COLOR[x.kind] }))} pins={spPins(d)} bands={d.alarms.filter((a) => a.kind !== "co2").map((a) => ({ from: a.start, to: a.end, color: a.kind === "po2high" ? "#ef5350" : "#ffb74d" }))} series={[
            { label: "Průměr pO₂", color: C[0], values: s.ppo2, unit: "bar", width: 2 }, { label: "Čidlo 1", color: C[1], values: cells[0], unit: "bar" },
            { label: "Čidlo 2", color: C[2], values: cells[1], unit: "bar" }, { label: "Čidlo 3", color: C[3], values: cells[2], unit: "bar" }, { label: "Setpoint", color: C[4], values: s.sp, unit: "bar", dash: "4 3" },
          ]} extra={depthExtra} />
        ) : (
          <LineChart t={s.t} series={[
            { label: "Čidlo 1", color: C[1], values: cells[0], unit: "mV" }, { label: "Čidlo 2", color: C[2], values: cells[1], unit: "mV" }, { label: "Čidlo 3", color: C[3], values: cells[2], unit: "mV" },
          ]} extra={[{ label: "Průměr pO₂", values: s.ppo2, unit: "bar" }, ...depthExtra]} />
        )}
        <p className="note">
          {cellMode === "cal" ? <>Čidla přepočtená společnou kalibrací odvozenou z průměrného pO₂ tohoto ponoru (rozdíl = jiná citlivost čidla): {cal.map((c, k) => `č. ${k + 1} ${c ? (c * 1000).toFixed(1) + " mbar/mV" : "–"}`).join(", ")}. </> : "Surové hodnoty čidel v mV. "}
          Čárky dole = nárůsty O₂ podle druhu: <span style={{ color: DOSE_COLOR.sol }}>■ solenoid (pravděpodobně) {doses.filter((x) => x.kind === "sol").length}×</span>, <span style={{ color: DOSE_COLOR.man }}>■ ručně O₂ {doses.filter((x) => x.kind === "man").length}×</span>, <span style={{ color: DOSE_COLOR.amb }}>■ ručně O₂, nebo diluent {doses.filter((x) => x.kind === "amb").length}×</span>, <span style={{ color: DOSE_COLOR.dil }}>■ diluent {doses.filter((x) => x.kind === "dil").length}×</span>. Solenoid dávkuje jen pod setpointem – nárůst nad ním je ruční.
        </p>
      </Card>
      <Card title="CO₂ v dýchací smyčce">
        {s.co2.some((v) => v != null && v > 0)
          ? <LineChart t={s.t} bands={d.alarms.filter((a) => a.kind === "co2").map((a) => ({ from: a.start, to: a.end, color: "#ef5350" }))} series={[{ label: "ppCO₂", color: C[5], values: s.co2, unit: "mbar", width: 2 }, { label: "Hloubka", color: C[0], values: s.depth, unit: "m", right: true }]} rightInvert extra={[{ label: "Surová hodnota", values: s.co2raw }]} />
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
        ["Citlivost čidel (odvozená)", cal.map((c) => (c ? (c * 1000).toFixed(1) : "–")).join(" / ") + " mbar/mV", "P"],
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
    <>
    <Card title="Setpoint">
      {(() => { const sp = setpointChanges(d); return sp.length ? (
        <table className="kv"><thead><tr><th>Čas</th><th>Hloubka</th><th>Setpoint</th><th>Obsluha</th></tr></thead>
          <tbody>{sp.map((c, i) => <tr key={i}><td>{Math.round(c.t / 60)}′</td><td>{num(c.depth)} m</td><td>{fmtSp(c.from)} → {fmtSp(c.to)}{c.to < 0.3 && c.depth <= 6 ? " (před výstupem)" : ""}</td><td>{c.manual ? "ručně (menu Petrelu)" : "bez potvrzené obsluhy"}</td></tr>)}</tbody>
        </table>) : <p className="muted">Setpoint se během ponoru neměnil.</p>; })()}
      <p className="note">Ruční přepnutí = levé tlačítko (menu) a pravé (potvrzení první položky) 0–25 s před změnou ve vzorcích. Ruční dávky O₂ před přepnutím na vysoký setpoint: {o2Doses(d).filter((x) => x.preSw && x.kind === "man").length}×.</p>
    </Card>
    <Card title="Ovládání počítače">
      {d.buttons.length ? <>
        <p>{d.buttons.length} stisků · menu otevřeno {d.buttons.filter((b) => b.from === 0xb3 && b.to === 0x06).length}× · mimo hlavní obrazovku {Math.round(summarize(d).offMainS / 60)} min</p>
        <table className="kv"><thead><tr><th>Čas</th><th>Tlačítko</th><th>Obrazovka</th></tr></thead>
          <tbody>{d.buttons.map((b, i) => <tr key={i}><td>{b.clock}<br /><small className="muted">{b.t < 0 ? "před ponorem" : `${Math.floor(b.t / 60)}′${String(Math.round(b.t % 60)).padStart(2, "0")}″`}</small></td><td>{BTN_NAMES[b.btn] ?? `tlačítko ${b.btn}`}</td><td>{scrName(b.from)} → {scrName(b.to)}</td></tr>)}</tbody>
        </table>
      </> : <p className="muted">Bez záznamu o ovládání.</p>}
      <p className="note">Ze záznamů 0x51. Čas = minuta:sekunda na hodinách počítače. Petrel je zapisuje v dávkách, pořadí se řadí podle času.</p>
    </Card>
    <Card title="Alarmy z počítače">
      {d.alarms.length ? (
        <table className="kv"><thead><tr><th>Alarm</th><th>Od</th><th>Do</th><th>Délka</th></tr></thead>
          <tbody>{d.alarms.map((a, i) => <tr key={i}><td>{a.label}</td><td>{Math.round(a.start / 60)}′</td><td>{Math.round(a.end / 60)}′</td><td>{a.end - a.start < 60 ? `${a.end - a.start} s` : `${Math.round((a.end - a.start) / 60)} min`}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">Počítač v tomto ponoru nehlásil alarm CO₂ ani pO₂.</p>}
      <p className="note">Z událostí 9 (spuštění) a 10 (ukončení). V grafech CO₂ a pO₂ jsou alarmy vyznačené podbarvením.</p>
    </Card>
    <Card title="Události v záznamu">
      <p className="note">Bez CO₂ (to je v grafu) a bez stisků tlačítek (výše). Popisy u typů 0, 1 a 2 jsou odhad.</p>
      <table className="kv"><thead><tr><th>Čas</th><th>Typ</th><th>Význam / data</th></tr></thead>
        <tbody>{d.events.map((e, i) => <tr key={i}><td>{Math.round(e.t / 60)}′</td><td>{e.kind}</td><td>{e.label}<br /><code>{e.payload}</code></td></tr>)}</tbody>
      </table>
    </Card>
    </>
  );
}
