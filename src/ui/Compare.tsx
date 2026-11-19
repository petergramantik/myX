// Porovnání mého ponoru s ponorem buddyho z cizího logu: grafy přes sebe, tabulka rozdílů a závěr.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dive } from "../core/shearwater";
import { setpointChanges } from "../core/analysis";
import { computerDiff, conclusionSections, deeperWindow, diveStats, groupSections, multiRows, profileLag, type MultiRow } from "../core/compare";
import { buddyDivesFor, guestIndexLoad, lastExport, nearestPair, suggestionsFor, loadDive, loadGuestDive, logName, ownerName, saveSettings, toast } from "../app/store";
import { GuestCard } from "./Settings";
import { shareDb } from "./share";
import { dur } from "../core/analysis";
import { askText } from "../app/dialog";
import { compareHtml, shareHtml } from "./cmpExport";
import { Card, fmtDate, fmtDateTime, go, leaveY, tab, useStore } from "./common";
import { LineChart } from "./Chart";
import type { Meta } from "../app/model";

const ME = "#4fc3f7", BU = "#ffb74d";

/** Karta v detailu mého ponoru: ponory buddyů ze stejné doby. */
export function BuddyDivesCard({ meta }: { meta: Meta }) {
  const st = useStore();
  const [list, setList] = useState<Awaited<ReturnType<typeof buddyDivesFor>>>([]);
  useEffect(() => { if (!st.guest) buddyDivesFor(meta).then(setList); }, [meta.id, st.guest, st.guestRev, st.lb.computers]);
  if (st.guest || !list.length) return null;
  return (
    <Card title={list.length > 1 ? "Ponory ostatních" : "Ponor z cizího logu"} right={list.length > 1 ? <a onClick={() => go({ t: "cmp", id: meta.id, other: list.map((x) => x.meta.id).join(",") })}>Srovnat všechny ›</a> : undefined}>
      {list.map((x) => (
        <div key={x.meta.id} className="kvline link" onClick={() => go({ t: "cmp", id: meta.id, other: x.meta.id })}>
          <span><b>{x.owner || x.log.model || "Cizí log"}</b> · začátek {fmtDateTime(x.meta.start).split(" ").pop()} · {Math.round(x.meta.h.diveTimeS / 60)} min · {x.meta.h.maxDepth.toLocaleString("cs-CZ")} m</span>
          <span className="muted">Porovnat ›</span>
        </div>
      ))}
    </Card>
  );
}

// barvy potápěčů – bez červené a fialové (ty značí nejvyšší / nejnižší hodnotu v tabulce rozdílů)
const PAL = ["#4fc3f7", "#ffb74d", "#81c784", "#fff176", "#4db6ac", "#bcaaa4"];

/** Srovnání mého ponoru s ponory buddyů (other = id ponorů z cizích logů oddělená čárkou). */
export function CompareScreen({ id, other }: { id: string; other: string }) {
  const ids = other.split(",").filter(Boolean);
  const [dives, setDives] = useState<(Dive | null)[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [byClock, setByClock] = useState(false);
  const [showClock, setShowClock] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [twoComp, setTwoComp] = useState(false);
  const [more, setMore] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // výška horní lišty pro „přilepenou“ hlavičku se jmény (zvětšené písmo v telefonu ji mění)
  useEffect(() => { const t = document.querySelector(".top") as HTMLElement | null; if (t) document.documentElement.style.setProperty("--toph", t.offsetHeight - 1 + "px"); });
  const st0 = useStore();
  useEffect(() => {
    const m = st0.metas.find((x) => x.id === id), sid = st0.lb.notes[id]?.siteId;
    if (sid && st0.lb.sites[sid]) setSite(st0.lb.sites[sid].name);
    else if (m) suggestionsFor(m).then((sg) => { const x = sg.find((y) => y.site); setSite(x?.site ? (x.site.mine && st0.lb.sites[x.site.mine]?.name) || x.site.name : null); });
  }, [id, st0.lb.notes[id]?.siteId]);
  useEffect(() => {
    Promise.all([loadDive(id), ...ids.map((x) => loadGuestDive(x))]).then(setDives).catch((e) => setErr(e.message));
    guestIndexLoad().then((ix) => {
      const grp = (x: string) => ix.findIndex((y) => y.metas.some((m) => m.id === x) || y.alts.some((m) => m.id === x));
      const same = ids.length === 1 && grp(id) >= 0 && grp(id) === grp(ids[0]);
      // jméno účastníka (bez ID počítače); jen u srovnání dvou počítačů jednoho člověka i počítač
      const nm = (x: string) => {
        const g = ix[grp(x)];
        if (!g) return null;
        const m = [...g.metas, ...g.alts].find((q) => q.id === x);
        return (ownerName(g.log) || g.log.model || "parťák") + (same && m?.comp ? ` (${m.comp})` : "");
      };
      setNames([st0.guest ? nm(id) || "parťák" : "Já", ...ids.map((x) => nm(x) || "parťák")]);
      setTwoComp(same);
    });
  }, [id, other]);
  const all = dives.filter((d): d is Dive => !!d);
  const th = useStore().lb.settings.th;
  const stats = useMemo(() => all.map((d) => diveStats(d, { below: th.spBelow ?? 0.15, above: th.spAbove ?? 0.2 })), [dives, th.spBelow, th.spAbove]);
  const [site, setSite] = useState<string | null>(null);
  // zarovnání podle profilu hloubky (hodiny počítačů se rozcházejí); při neshodě profilů zůstanou hodiny
  const lags = useMemo(() => all.map((d, i) => (i === 0 ? { real: 0, clock: 0, rmse: 0 } : profileLag(all[0], d))), [dives]);
  if (err) return <div className="screen"><p className="alert bad">{err}</p></div>;
  if (all.length < ids.length + 1 || names.length < all.length) return <div className="screen"><p className="muted center">Dekóduji ponory…</p></div>;
  const sel = all.map((_, i) => i).filter((i) => !off.has(i));
  const D = sel.map((i) => all[i]), N = sel.map((i) => names[i]), S = sel.map((i) => stats[i]), C = sel.map((i) => PAL[i % PAL.length]);
  const base = D[0];
  // společná časová osa od začátku prvního vybraného ponoru, krok 10 s
  const startOf = (i: number) => { const l = lags[i]; return byClock || l.rmse > 3 ? l.clock : l.real; };
  const offs = sel.map((i) => startOf(i) - startOf(sel[0]));
  const t0 = Math.min(0, ...offs), t1 = Math.max(...D.map((d, k) => offs[k] + d.h.diveTimeS));
  const T: number[] = []; for (let x = t0; x <= t1; x += 10) T.push(x);
  const at = (d: Dive, v: (number | null)[], tt: number) => { if (tt < 0 || tt > d.h.diveTimeS) return null; const i = d.s.t.findIndex((x) => x >= tt); return i < 0 ? null : v[i]; };
  const ser = (pick: (d: Dive) => (number | null)[], label: string, unit: string, dash?: string, width = 2) =>
    D.map((d, k) => { const v = pick(d); return { label: `${label}${label ? " – " : ""}${N[k]}`, color: C[k], values: T.map((x) => at(d, v, x - offs[k])), unit, dash, width }; });
  const inertCum = (d: Dive) => { let acc = 0; return d.s.t.map((_, i) => { const P = (d.h.surfP || 1013) / 1000 + d.s.depth[i] * 0.0981; acc += Math.max(0, P - Math.min(d.s.ppo2[i], P)) * (d.h.rateS || 5) / 60; return Math.round(acc * 10) / 10; }); };
  const pins = D.flatMap((d, k) => setpointChanges(d).map((c) => ({ t: c.t + offs[k], label: `SP ${c.to.toLocaleString("cs-CZ")}`, color: C[k] })));
  const rows = multiRows(S);
  const sections = D.length === 2 ? conclusionSections(N[0], N[1], S[0], S[1], deeperWindow(D[0], D[1], offs[1])) : groupSections(N, S);
  const clockInfo = all.slice(1).map((_, k) => {
    const l = lags[k + 1], who = names[k + 1], diff = l.clock - l.real, a = Math.abs(diff);
    return { who, bad: l.rmse > 3, rmse: l.rmse, txt: l.rmse > 3 ? "≠ profil" : `${diff >= 0 ? "+" : "−"}${dur(a)}${Math.abs(a - 3600) <= 900 ? " (1 h – letní/zimní čas)" : ""}` };
  });
  const hasCo2 = D.some((d) => d.s.co2.some((v) => v != null && v > 0));
  const shareCmp = async () => {
    setMore(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = rootRef.current; if (!el) return;
    const day = new Date(all[0].h.start * 1000).toISOString().slice(0, 10);
    const title = `${site || "Ponor"} ${fmtDateTime(all[0].h.start)}`;
    let me = st0.lb.settings.myName;
    if (!me && !st0.guest) { me = (await askText("Tvoje jméno ve sdíleném srovnání (místo „Já“):", ""))?.trim() || undefined; if (me) await saveSettings({ myName: me }); }
    const nm = N.map((n) => (n === "Já" && me ? me : n));
    await shareHtml(compareHtml(el, title, `${fmtDateTime(all[0].h.start)} · ${nm.join(", ")}`, st0.guest ? undefined : me), `myX_srovnani_${day}.html`, title);
  };
  return (
    <div className="screen" ref={rootRef}>
      <section className="card cmphead">
        <h2 className="cmp-site">{site || "Lokalita nezadaná"}</h2>
        <div className="muted small">{fmtDateTime(all[0].h.start)}<span className="cmp-mine-link"> · <a onClick={() => go({ t: "dive", id })}>Detail mého ponoru ›</a></span></div>
        <button className="btn small cmp-share" onClick={shareCmp}>⤴ Sdílet srovnání</button>
        <div className="cmp-align">
          <label className="switch"><input type="checkbox" checked={!byClock} onChange={(e) => setByClock(!e.target.checked)} /> ⇆ Podle profilu</label>
          <span className="small muted link" onClick={() => setShowClock(!showClock)}>hodiny {clockInfo.map((c) => `${c.who.split(" ")[0]} ${c.txt}`).join(" · ")}</span>
        </div>
        {showClock && <p className="note">Odchylka hodin cizího počítače proti tvému (+ = jdou napřed), zjištěná posunem profilu hloubky. {clockInfo.some((c) => c.bad) ? "„≠ profil“ = profily se ani po posunu nekryjí (odchylka nad 3 m), nejspíš jste nebyli celou dobu spolu – pro toho potápěče se používá čas podle hodin." : ""}</p>}
        <div className="chips">{all.map((d, i) => (
          <label key={i} className="chip" style={{ borderColor: PAL[i % PAL.length], opacity: off.has(i) ? 0.45 : 1 }}>
            <input type="checkbox" checked={!off.has(i)} disabled={!off.has(i) && sel.length <= 2}
              onChange={() => { const n = new Set(off); n.has(i) ? n.delete(i) : n.add(i); setOff(n); }} /> <span style={{ color: PAL[i % PAL.length] }}>●</span> {names[i]}
            {i > 0 && <small className="muted"> start {((startOf(i) - startOf(0)) / 60) >= 0 ? "+" : ""}{(Math.round((startOf(i) - startOf(0)) / 6) / 10).toLocaleString("cs-CZ")} min</small>}
          </label>
        ))}</div>
      </section>
      {twoComp && D.length === 2 && <Card title="Rozdíly počítačů">
        <p className="note">Stejný ponor ze dvou počítačů jednoho potápěče – co by mohlo ukazovat na závadu.</p>
        {computerDiff(D[0], D[1], offs[1], lags[sel[1]].clock - lags[sel[1]].real).map((x, i) => <p key={i} className={x.level === "warn" ? "warn-t" : "ok-t"}>{x.level === "warn" ? "⚠ " : "✓ "}{x.text}</p>)}
      </Card>}
      <Card title="Závěr">
        {sections.filter((x) => x.level > 0).map((x) => (
          <div key={x.key} className={"csec l" + x.level}><b>{x.title}</b>{x.lines.map((l, i) => <p key={i}>{l}</p>)}</div>
        ))}
        {sections.some((x) => x.level === 0) && <p className="note">Bez výrazného rozdílu: {sections.filter((x) => x.level === 0).map((x) => x.title).join(", ")}.</p>}
        <p className="note">Odvozeno z dat logů. Rozdíl v dekompresi je rozložený na podíl hloubky a podíl pO₂ podle inertní zátěže ∫(okolní tlak − pO₂) dt.</p>
      </Card>
      <Card title="Profil a strop">
        <LineChart t={T} invert height={220} pins={pins} series={[...ser((d) => d.s.depth, "Hloubka", "m"), ...ser((d) => d.s.ceil, "", "m", "4 3", 1).map((x) => ({ ...x, label: "" }))]} />
      </Card>
      <Card title="pO₂ a setpoint">
        <LineChart t={T} pins={pins} series={[...ser((d) => d.s.ppo2, "pO₂", "bar"), ...ser((d) => d.s.sp, "", "bar", "4 3", 1).map((x) => ({ ...x, label: "" }))]} />
      </Card>
      <Card title="Zbývající deko (TTS)"><LineChart t={T} series={ser((d) => d.s.tts, "TTS", "min")} /></Card>
      <Card title="Inertní zátěž (kumulativně)">
        <LineChart t={T} series={ser(inertCum, "", "bar·min")} />
        <p className="note">∫ (okolní tlak − pO₂) dt – čím vyšší, tím víc inertního plynu a delší dekomprese.</p>
      </Card>
      {hasCo2 && <Card title="CO₂"><LineChart t={T} series={ser((d) => d.s.co2, "CO₂", "mbar")} /></Card>}
      <Card title="Rozdíly (od největšího)">
        {D.length > 2 && <p className="note cmp-legend"><span className="hi">▲ nejvyšší</span> <span className="lo">▼ nejnižší</span> hodnota u výrazných rozdílů</p>}
        <div className="cmpb">
          <div className="cmpb-h" style={{ gridTemplateColumns: `repeat(${N.length}, minmax(0, 1fr))` }}>{N.map((n, k) => <span key={k} style={{ color: C[k] }}>{n.split(" ")[0]}</span>)}</div>
          {rows.filter((r) => !r.muted && r.weight > 0.2).map((r) => <DiffBlock key={r.key} r={r} n={N.length} hl={D.length > 2 && r.weight >= 1} />)}
          {(() => { const rest = rows.filter((r) => r.muted || r.weight <= 0.2); return rest.length > 0 && <>
            <button className="cmpb-more" onClick={() => setMore(!more)}>Další údaje ({rest.length}) {more ? "▴" : "▾"}</button>
            {more && rest.map((r) => <DiffBlock key={r.key} r={r} n={N.length} hl={false} />)}
          </>; })()}
        </div>
      </Card>
    </div>
  );
}

/** Jeden ukazatel srovnání: název přes celou šířku, pod ním hodnoty potápěčů ve sloupcích. */
function DiffBlock({ r, n, hl }: { r: MultiRow; n: number; hl: boolean }) {
  const cls = r.muted ? "muted" : r.weight >= 1 ? "hot" : r.weight > 0.2 ? "" : "small";
  return (
    <div className={"cmpb-r " + cls}>
      <div className="cmpb-l">{r.label}</div>
      <div className="cmpb-v" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {r.vals.map((v, k) => { const m = hl ? (k === r.hi ? "hi" : k === r.lo ? "lo" : "") : "";
          return <span key={k} className={m}>{m === "hi" ? "▲ " : m === "lo" ? "▼ " : ""}{v}</span>; })}
      </div>
    </div>
  );
}

/** Společné ponory: můj ponor + nejbližší ponory buddyů z načtených cizích logů. */
export interface Common { m: Meta; with: { id: string; who: string }[] }
export async function commonDives(metas: Meta[]): Promise<Common[]> {
  const ix = await guestIndexLoad();
  const out: Common[] = [];
  for (const m of [...metas].reverse()) {
    const w = ix.flatMap(({ log, metas: g }) => nearestPair(g, m).map((x) => ({ id: x.id, who: logName(log) })));
    if (w.length) out.push({ m, with: w });
  }
  return out;
}

/** Záložka DB: podkarty Srovnání (společné ponory s filtry) a Databáze (cizí logy, sdílení mého logu). */
export function CompareHub({ sub = "cmp", who }: { sub?: "cmp" | "db"; who?: string }) {
  const st = useStore();
  return (
    <div className="screen">
      <div className="seg bl">
        <button className={sub === "cmp" ? "on" : ""} onClick={() => tab({ t: "hub", sub: "cmp" })}>Srovnání</button>
        <button className={sub === "db" ? "on" : ""} onClick={() => tab({ t: "hub", sub: "db" })}>Databáze</button>
      </div>
      {sub === "db" ? <><GuestCard /><ShareMine /></>
        : st.guest ? <p className="muted">Zavři prohlížený cizí log – společné ponory se hledají k tvým ponorům.</p>
        : <CommonList who={who} />}
    </div>
  );
}

/** Filtr a pozice seznamu společných ponorů – přežije otevření srovnání a návrat (do zavření aplikace). */
const cmMemo: { who?: string; sel: string[]; year: string; month: string; day: string; y: number } = { sel: [], year: "", month: "", day: "", y: 0 };
function CommonList({ who }: { who?: string }) {
  const st = useStore();
  const [rows, setRows] = useState<Common[] | null>(null);
  // nový požadavek na konkrétního člověka (z Databáze) má přednost před zapamatovaným filtrem
  if (who && who !== cmMemo.who) Object.assign(cmMemo, { who, sel: [who], year: "", month: "", day: "", y: 0 });
  const [sel, setSel0] = useState<string[]>(cmMemo.sel);
  const [year, setYear0] = useState(cmMemo.year), [month, setMonth0] = useState(cmMemo.month), [day, setDay0] = useState(cmMemo.day);
  const setSel = (v: string[]) => { cmMemo.sel = v; setSel0(v); };
  const setYear = (v: string) => { cmMemo.year = v; setYear0(v); };
  const setMonth = (v: string) => { cmMemo.month = v; setMonth0(v); };
  const setDay = (v: string) => { cmMemo.day = v; setDay0(v); };
  useEffect(() => { commonDives(st.metas).then(setRows); }, [st.metas, st.guestRev, st.lb.computers]);
  // pozice v seznamu: uložit při odchodu, obnovit po načtení
  useEffect(() => () => { cmMemo.y = leaveY; }, []);
  useEffect(() => { if (rows && cmMemo.y) requestAnimationFrame(() => window.scrollTo(0, cmMemo.y)); }, [rows]);
  if (rows == null) return <p className="muted">Hledám…</p>;
  if (!rows.length) return <p className="muted">Zatím žádné společné ponory. Načti log ostatních v Databázi (nebo ho nasdílej do myX přes WhatsApp / Quick Share).</p>;
  const ymd = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  const dateOk = (r: Common) => { const d = ymd(r.m.start); return (!year || d.startsWith(year)) && (!month || d.slice(5, 7) === month) && (!day || d === day); };
  const has = (r: Common, who: string[]) => who.every((w) => r.with.some((x) => x.who === w));
  const people = [...new Set(rows.flatMap((r) => r.with.map((x) => x.who)))];
  const list = rows.filter((r) => dateOk(r) && has(r, sel));
  const years = [...new Set(rows.map((r) => ymd(r.m.start).slice(0, 4)))].sort().reverse();
  const months = [...new Set(rows.filter((r) => !year || ymd(r.m.start).startsWith(year)).map((r) => ymd(r.m.start).slice(5, 7)))].sort();
  const MON = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
  return (
    <>
      <div className="chips buddyfilter">
        <button className={"chip" + (!sel.length && !year && !month && !day ? " on" : "")} onClick={() => { setSel([]); setYear(""); setMonth(""); setDay(""); cmMemo.y = 0; }}>Vše</button>
        {people.map((p) => {
          const on = sel.includes(p), next = on ? sel.filter((x) => x !== p) : [...sel, p];
          const n = rows.filter((r) => dateOk(r) && has(r, next)).length;
          return <button key={p} className={"chip" + (on ? " on" : "")} disabled={!on && !n} onClick={() => setSel(next)}>{p} ({on ? rows.filter((r) => dateOk(r) && has(r, sel)).length : n})</button>;
        })}
      </div>
      <div className="row datefilter">
        <select value={year} onChange={(e) => { setYear(e.target.value); setMonth(""); setDay(""); }}><option value="">rok</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
        <select value={month} onChange={(e) => { setMonth(e.target.value); setDay(""); }}><option value="">měsíc</option>{months.map((m) => <option key={m} value={m}>{MON[+m - 1]}</option>)}</select>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      <Card title={`Společné ponory (${list.length})`}>
        {list.map((r) => <CommonRow key={r.m.id} r={r} />)}
        {!list.length && <p className="muted">Filtru nic neodpovídá.</p>}
      </Card>
    </>
  );
}

export function CommonRow({ r }: { r: Common }) {
  const st = useStore();
  const sid = st.lb.notes[r.m.id]?.siteId;
  const mine = sid ? st.lb.sites[sid]?.name : null;
  const [from, setFrom] = useState<string | null>(null);
  useEffect(() => { if (!mine) suggestionsFor(r.m).then((sg) => { const x = sg.find((y) => y.site); setFrom(x?.site ? (x.site.mine && st.lb.sites[x.site.mine]?.name) || x.site.name : null); }); }, [r.m.id, mine]);
  return (
    <div className="kvline link" onClick={() => go({ t: "cmp", id: r.m.id, other: r.with.map((x) => x.id).join(",") })}>
      <span><b>{fmtDate(r.m.start)}</b> · {mine ? mine : from ? <i className="sugg">{from}</i> : <span className="muted">bez lokality</span>}</span>
      <span className="muted">⇄ {r.with.length + 1} ›</span>
    </div>
  );
}

/** Sdílení mého logu: původní export Shearwater Cloud z posledního importu. */
function ShareMine() {
  const [last, setLast] = useState<Awaited<ReturnType<typeof lastExport>>>();
  useEffect(() => { lastExport().then(setLast); }, []);
  const share = async () => { if (last) await shareDb(last.data, last.name, "Můj log"); };
  return (
    <Card title="Sdílet můj log">
      {last ? <>
        <button className="btn primary" onClick={share}>Sdílet můj log</button>
        <p className="note">Původní export Shearwater Cloud z posledního importu ({new Date(last.at).toLocaleDateString("cs-CZ")}, {last.count} ponorů). Parťák ho otevře v myX i ve Shearwater Cloud. Lokality a poznámky z myX v něm nejsou.</p>
      </> : <p className="muted">Zatím tu není žádný import. Po příštím načtení exportu ze Shearwater Cloud půjde sdílet.</p>}
    </Card>
  );
}
