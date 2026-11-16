// Porovnání mého ponoru s ponorem buddyho z cizího logu: grafy přes sebe, tabulka rozdílů a závěr.
import { useEffect, useMemo, useState } from "react";
import type { Dive } from "../core/shearwater";
import { setpointChanges } from "../core/analysis";
import { conclusionSections, deeperWindow, diveStats, groupSections, multiRows, profileLag } from "../core/compare";
import { buddyDivesFor, guestIndexLoad, lastExport, nearestPair, loadDive, loadGuestDive, ownerName, toast } from "../app/store";
import { GuestCard } from "./Settings";
import { Card, fmtDate, fmtDateTime, go, useStore } from "./common";
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
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([loadDive(id), ...ids.map((x) => loadGuestDive(x))]).then(setDives).catch((e) => setErr(e.message));
    guestIndexLoad().then((ix) => setNames(["Já", ...ids.map((x) => { const g = ix.find((y) => y.metas.some((m) => m.id === x)); return g ? ownerName(g.log) || g.log.name : "buddy"; })]));
  }, [id, other]);
  const all = dives.filter((d): d is Dive => !!d);
  const stats = useMemo(() => all.map((d) => diveStats(d)), [dives]);
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
  const clockTxt = all.slice(1).map((d, k) => {
    const l = lags[k + 1], who = names[k + 1];
    if (l.rmse > 3) return `${who}: profily se liší (odchylka ${l.rmse.toFixed(1).replace(".", ",")} m) – nejspíš jste nebyli celou dobu spolu, zarovnáno podle hodin.`;
    const diff = l.clock - l.real, a = Math.abs(diff);
    return a < 20 ? `Hodiny Petrelu (${who}) jdou přesně.` : `Hodiny Petrelu (${who}) jdou o ${Math.floor(a / 60)} min ${a % 60} s ${diff > 0 ? "napřed" : "pozadu"}.`;
  });
  const hasCo2 = D.some((d) => d.s.co2.some((v) => v != null && v > 0));
  return (
    <div className="screen">
      <Card title={names.length > 2 ? `Srovnání ${names.length} potápěčů` : `Já vs. ${names[1]}`}>
        <p className="muted">Ponor {fmtDateTime(all[0].h.start)}</p>
        <div className="seg filter">
          <button className={!byClock ? "on" : ""} onClick={() => setByClock(false)}>Zarovnat podle profilu</button>
          <button className={byClock ? "on" : ""} onClick={() => setByClock(true)}>Podle hodin</button>
        </div>
        {clockTxt.map((x, i) => <p key={i} className="note">{x}</p>)}
        <div className="chips">{all.map((d, i) => (
          <label key={i} className="chip" style={{ borderColor: PAL[i % PAL.length], opacity: off.has(i) ? 0.45 : 1 }}>
            <input type="checkbox" checked={!off.has(i)} disabled={!off.has(i) && sel.length <= 2}
              onChange={() => { const n = new Set(off); n.has(i) ? n.delete(i) : n.add(i); setOff(n); }} /> <span style={{ color: PAL[i % PAL.length] }}>●</span> {names[i]}
            {i > 0 && <small className="muted"> start {((startOf(i) - startOf(0)) / 60) >= 0 ? "+" : ""}{(Math.round((startOf(i) - startOf(0)) / 6) / 10).toLocaleString("cs-CZ")} min</small>}
          </label>
        ))}</div>
      </Card>
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

/** Záložka Srovnat: společné ponory s buddyi, cizí logy a sdílení mého logu. */
export function CompareHub() {
  const st = useStore();
  const [rows, setRows] = useState<{ m: Meta; with: { id: string; who: string }[] }[] | null>(null);
  useEffect(() => {
    if (st.guest) return;
    guestIndexLoad().then((ix) => {
      const out: { m: Meta; with: { id: string; who: string }[] }[] = [];
      for (const m of [...st.metas].reverse()) {
        const w = ix.flatMap(({ log, metas }) => nearestPair(metas, m).map((g) => ({ id: g.id, who: ownerName(log) || log.name })));
        if (w.length) out.push({ m, with: w });
      }
      setRows(out);
    });
  }, [st.metas, st.guest, st.lb.computers]);
  return (
    <div className="screen">
      <Card title="Společné ponory">
        {st.guest ? <p className="muted">Zavři prohlížený cizí log – společné ponory se hledají k tvým ponorům.</p>
          : rows == null ? <p className="muted">Hledám…</p>
          : !rows.length ? <p className="muted">Zatím žádné. Načti log buddyho níže (nebo ho nasdílej do myX přes WhatsApp / Quick Share).</p>
          : rows.map(({ m, with: w }) => {
            const site = st.lb.notes[m.id]?.siteId ? st.lb.sites[st.lb.notes[m.id]!.siteId!]?.name : null;
            return (
              <div key={m.id} className="kvline link" onClick={() => go({ t: "cmp", id: m.id, other: w.map((x) => x.id).join(",") })}>
                <span><b>{fmtDate(m.start)}</b>{site ? ` · ${site}` : ""} · {w.map((x) => x.who).join(", ")}</span>
                <span className="muted">{w.length > 1 ? `Srovnat ${w.length + 1} ›` : "Srovnat ›"}</span>
              </div>
            );
          })}
      </Card>
      <GuestCard />
      <ShareMine />
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
