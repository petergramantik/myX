// Porovnání mého ponoru s ponorem buddyho z cizího logu: grafy přes sebe, tabulka rozdílů a závěr.
import { useEffect, useMemo, useState } from "react";
import type { Dive } from "../core/shearwater";
import { setpointChanges } from "../core/analysis";
import { conclusionSections, deeperWindow, diveStats, groupSections, multiRows, profileLag } from "../core/compare";
import { buddyDivesFor, guestIndexLoad, lastExport, nearestPair, suggestionsFor, loadDive, loadGuestDive, ownerName, toast } from "../app/store";
import { GuestCard } from "./Settings";
import { Card, fmtDate, fmtDateTime, go, tab, useStore } from "./common";
import { LineChart } from "./Chart";
import type { Meta } from "../app/model";

const ME = "#4fc3f7", BU = "#ffb74d";

/** Karta v detailu mého ponoru: ponory buddyů ze stejné doby. */
export function BuddyDivesCard({ meta }: { meta: Meta }) {
  const st = useStore();
  const [list, setList] = useState<Awaited<ReturnType<typeof buddyDivesFor>>>([]);
  useEffect(() => { if (!st.guest) buddyDivesFor(meta).then(setList); }, [meta.id, st.guest, st.lb.computers]);
  if (st.guest || !list.length) return null;
  return (
    <Card title={list.length > 1 ? "Ponory buddyů" : "Ponor buddyho"} right={list.length > 1 ? <a onClick={() => go({ t: "cmp", id: meta.id, other: list.map((x) => x.meta.id).join(",") })}>Srovnat všechny ›</a> : undefined}>
      {list.map((x) => (
        <div key={x.meta.id} className="kvline link" onClick={() => go({ t: "cmp", id: meta.id, other: x.meta.id })}>
          <span><b>{x.owner || x.log.name}</b> · začátek {fmtDateTime(x.meta.start).split(" ").pop()} · {Math.round(x.meta.h.diveTimeS / 60)} min · {x.meta.h.maxDepth.toLocaleString("cs-CZ")} m</span>
          <span className="muted">Porovnat ›</span>
        </div>
      ))}
    </Card>
  );
}

const PAL = ["#4fc3f7", "#ffb74d", "#81c784", "#f06292", "#ba68c8", "#fff176"];

/** Srovnání mého ponoru s ponory buddyů (other = id ponorů z cizích logů oddělená čárkou). */
export function CompareScreen({ id, other }: { id: string; other: string }) {
  const ids = other.split(",").filter(Boolean);
  const [dives, setDives] = useState<(Dive | null)[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [byClock, setByClock] = useState(false);
  const [showClock, setShowClock] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const st0 = useStore();
  useEffect(() => {
    const m = st0.metas.find((x) => x.id === id), sid = st0.lb.notes[id]?.siteId;
    if (sid && st0.lb.sites[sid]) setSite(st0.lb.sites[sid].name);
    else if (m) suggestionsFor(m).then((sg) => { const x = sg.find((y) => y.site); setSite(x?.site ? (x.site.mine && st0.lb.sites[x.site.mine]?.name) || x.site.name : null); });
  }, [id, st0.lb.notes[id]?.siteId]);
  useEffect(() => {
    Promise.all([loadDive(id), ...ids.map((x) => loadGuestDive(x))]).then(setDives).catch((e) => setErr(e.message));
    guestIndexLoad().then((ix) => setNames(["Já", ...ids.map((x) => { const g = ix.find((y) => y.metas.some((m) => m.id === x)); return g ? ownerName(g.log) || g.log.name : "buddy"; })]));
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
    return { who, bad: l.rmse > 3, rmse: l.rmse, txt: l.rmse > 3 ? "≠ profil" : `${diff >= 0 ? "+" : "−"}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}` };
  });
  const hasCo2 = D.some((d) => d.s.co2.some((v) => v != null && v > 0));
  return (
    <div className="screen">
      <section className="card cmphead">
        <h2 className="cmp-site">{site || "Lokalita nezadaná"}</h2>
        <div className="muted small">{fmtDateTime(all[0].h.start)} · <a onClick={() => go({ t: "dive", id })}>Detail mého ponoru ›</a></div>
        <div className="cmp-align">
          <label className="switch"><input type="checkbox" checked={!byClock} onChange={(e) => setByClock(!e.target.checked)} /> ⇆ Podle profilu</label>
          <span className="small muted link" onClick={() => setShowClock(!showClock)}>hodiny {clockInfo.map((c) => `${c.who.split(" ")[0]} ${c.txt}`).join(" · ")}</span>
        </div>
        {showClock && <p className="note">Odchylka hodin počítače buddyho proti tvému (+ = jdou napřed), zjištěná posunem profilu hloubky. {clockInfo.some((c) => c.bad) ? "„≠ profil“ = profily se ani po posunu nekryjí (odchylka nad 3 m), nejspíš jste nebyli celou dobu spolu – pro toho potápěče se používá čas podle hodin." : ""}</p>}
        <div className="chips">{all.map((d, i) => (
          <label key={i} className="chip" style={{ borderColor: PAL[i % PAL.length], opacity: off.has(i) ? 0.45 : 1 }}>
            <input type="checkbox" checked={!off.has(i)} disabled={!off.has(i) && sel.length <= 2}
              onChange={() => { const n = new Set(off); n.has(i) ? n.delete(i) : n.add(i); setOff(n); }} /> <span style={{ color: PAL[i % PAL.length] }}>●</span> {names[i]}
            {i > 0 && <small className="muted"> start {((startOf(i) - startOf(0)) / 60) >= 0 ? "+" : ""}{(Math.round((startOf(i) - startOf(0)) / 6) / 10).toLocaleString("cs-CZ")} min</small>}
          </label>
        ))}</div>
      </section>
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
        <table className="kv cmp"><thead><tr><th></th>{N.map((n, k) => <th key={k} style={{ color: C[k] }}>{n}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key} className={r.weight >= 1 ? "big" : r.weight > 0.2 ? "" : "small-diff"}><td>{r.label}</td>
              {r.vals.map((v, k) => <td key={k} className={D.length > 2 && r.weight >= 1 ? (k === r.hi ? "hi" : k === r.lo ? "lo" : "") : ""}>{v}</td>)}</tr>
          ))}</tbody>
        </table>
        {D.length > 2 && <p className="note">V řádcích s výrazným rozdílem: <span className="hi">nejvyšší</span> a <span className="lo">nejnižší</span> hodnota.</p>}
      </Card>
    </div>
  );
}

/** Společné ponory: můj ponor + nejbližší ponory buddyů z načtených cizích logů. */
export interface Common { m: Meta; with: { id: string; who: string }[] }
export async function commonDives(metas: Meta[]): Promise<Common[]> {
  const ix = await guestIndexLoad();
  const out: Common[] = [];
  for (const m of [...metas].reverse()) {
    const w = ix.flatMap(({ log, metas: g }) => nearestPair(g, m).map((x) => ({ id: x.id, who: ownerName(log) || log.name })));
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

function CommonList({ who }: { who?: string }) {
  const st = useStore();
  const [rows, setRows] = useState<Common[] | null>(null);
  const [sel, setSel] = useState<string[]>(who ? [who] : []);
  const [year, setYear] = useState(""), [month, setMonth] = useState(""), [day, setDay] = useState("");
  useEffect(() => { commonDives(st.metas).then(setRows); }, [st.metas, st.lb.computers]);
  if (rows == null) return <p className="muted">Hledám…</p>;
  if (!rows.length) return <p className="muted">Zatím žádné společné ponory. Načti log buddyho v Databázi (nebo ho nasdílej do myX přes WhatsApp / Quick Share).</p>;
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
        <button className={"chip" + (!sel.length && !year && !month && !day ? " on" : "")} onClick={() => { setSel([]); setYear(""); setMonth(""); setDay(""); }}>Vše</button>
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
  const site = st.lb.notes[r.m.id]?.siteId ? st.lb.sites[st.lb.notes[r.m.id]!.siteId!]?.name : null;
  return (
    <div className="kvline link" onClick={() => go({ t: "cmp", id: r.m.id, other: r.with.map((x) => x.id).join(",") })}>
      <span><b>{fmtDate(r.m.start)}</b>{site ? ` · ${site}` : ""} · {r.with.map((x) => x.who).join(", ")}</span>
      <span className="muted">⇄ {r.with.length + 1} ›</span>
    </div>
  );
}

/** Sdílení mého logu: původní export Shearwater Cloud z posledního importu. */
function ShareMine() {
  const [last, setLast] = useState<Awaited<ReturnType<typeof lastExport>>>();
  useEffect(() => { lastExport().then(setLast); }, []);
  const share = async () => {
    if (!last) return;
    const f = new File([last.data], last.name.endsWith(".db") ? last.name : last.name + ".db", { type: "application/octet-stream" });
    try {
      if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: "Můj log ponorů", text: "Log ze Shearwater Cloud – otevři v myX nebo Shearwater Cloud." }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Soubor uložen – pošli ho buddymu");
  };
  return (
    <Card title="Sdílet můj log">
      {last ? <>
        <button className="btn primary" onClick={share}>Sdílet můj log</button>
        <p className="note">Původní export Shearwater Cloud z posledního importu ({new Date(last.at).toLocaleDateString("cs-CZ")}, {last.count} ponorů). Buddy ho otevře v myX i ve Shearwater Cloud. Lokality a poznámky z myX v něm nejsou.</p>
      </> : <p className="muted">Zatím tu není žádný import. Po příštím načtení exportu ze Shearwater Cloud půjde sdílet.</p>}
    </Card>
  );
}
