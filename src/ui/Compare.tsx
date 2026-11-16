// Porovnání mého ponoru s ponorem buddyho z cizího logu: grafy přes sebe, tabulka rozdílů a závěr.
import { useEffect, useMemo, useState } from "react";
import type { Dive } from "../core/shearwater";
import { setpointChanges } from "../core/analysis";
import { alignSeries, conclusion, diffRows, diveStats } from "../core/compare";
import { buddyDivesFor, guestIndexLoad, loadDive, loadGuestDive, ownerName } from "../app/store";
import { Card, fmtDateTime, go, useStore } from "./common";
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
    <Card title="Ponor buddyho">
      {list.map((x) => (
        <div key={x.meta.id} className="kvline link" onClick={() => go({ t: "cmp", id: meta.id, other: x.meta.id })}>
          <span><b>{x.owner || x.log.name}</b> · začátek {fmtDateTime(x.meta.start).split(" ").pop()} · {Math.round(x.meta.h.diveTimeS / 60)} min · {x.meta.h.maxDepth.toLocaleString("cs-CZ")} m</span>
          <span className="muted">Porovnat ›</span>
        </div>
      ))}
    </Card>
  );
}

export function CompareScreen({ id, other }: { id: string; other: string }) {
  const [a, setA] = useState<Dive | null>(null);
  const [b, setB] = useState<Dive | null>(null);
  const [who, setWho] = useState("Buddy");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadDive(id).then(setA).catch((e) => setErr(e.message));
    loadGuestDive(other).then(setB).catch((e) => setErr(e.message));
    guestIndexLoad().then((ix) => { const g = ix.find((x) => x.metas.some((m) => m.id === other)); if (g) setWho(ownerName(g.log) || g.log.name); });
  }, [id, other]);
  const stats = useMemo(() => (a && b ? { sa: diveStats(a), sb: diveStats(b) } : null), [a, b]);
  if (err) return <div className="screen"><p className="alert bad">{err}</p></div>;
  if (!a || !b || !stats) return <div className="screen"><p className="muted center">Dekóduji oba ponory…</p></div>;
  const { sa, sb } = stats;
  const A = "já";
  const al = (pick: (d: Dive) => (number | null)[]) => alignSeries(a, b, pick);
  const dep = al((d) => d.s.depth), ceil = al((d) => d.s.ceil), po2 = al((d) => d.s.ppo2), sp = al((d) => d.s.sp), co2 = al((d) => d.s.co2), tts = al((d) => d.s.tts);
  const inertCum = (d: Dive) => { let acc = 0; return d.s.t.map((_, i) => { const P = (d.h.surfP || 1013) / 1000 + d.s.depth[i] * 0.0981; acc += Math.max(0, P - Math.min(d.s.ppo2[i], P)) * (d.h.rateS || 5) / 60; return Math.round(acc * 10) / 10; }); };
  const inert = al(inertCum);
  const off = dep.off;
  const pins = [
    ...setpointChanges(a).map((c) => ({ t: c.t, label: `SP ${c.to.toLocaleString("cs-CZ")}`, color: ME })),
    ...setpointChanges(b).map((c) => ({ t: c.t + off, label: `SP ${c.to.toLocaleString("cs-CZ")}`, color: BU })),
  ];
  const rows = diffRows(sa, sb);
  const concl = conclusion("já", who, sa, sb).map((s) => s.replace(/U potápěče já/g, "U mě").replace(/^já /, "Já "));
  return (
    <div className="screen">
      <Card title={`Já vs. ${who}`}>
        <p className="muted">Můj ponor {fmtDateTime(a.h.start)} · {who}: začátek o {Math.round(off / 60) === 0 ? `${off} s` : `${Math.round(off / 60)} min`} {off >= 0 ? "později" : "dříve"}</p>
        <p className="legend"><span><i style={{ background: ME }} />já</span><span><i style={{ background: BU }} />{who}</span></p>
      </Card>
      <Card title="Závěr">
        {concl.map((s, i) => <p key={i}>{s}</p>)}
        <p className="note">Odvozeno z dat obou logů. Rozdíl v dekompresi je rozložený na podíl hloubky a podíl pO₂ podle inertní zátěže ∫(okolní tlak − pO₂) dt.</p>
      </Card>
      <Card title="Profil a strop">
        <LineChart t={dep.t} invert height={220} pins={pins} series={[
          { label: "Hloubka – já", color: ME, values: dep.a, unit: "m", width: 2 }, { label: `Hloubka – ${who}`, color: BU, values: dep.b, unit: "m", width: 2 },
          { label: "Strop – já", color: ME, values: ceil.a, unit: "m", dash: "4 3" }, { label: `Strop – ${who}`, color: BU, values: ceil.b, unit: "m", dash: "4 3" },
        ]} />
      </Card>
      <Card title="pO₂ a setpoint">
        <LineChart t={po2.t} pins={pins} series={[
          { label: "pO₂ – já", color: ME, values: po2.a, unit: "bar", width: 2 }, { label: `pO₂ – ${who}`, color: BU, values: po2.b, unit: "bar", width: 2 },
          { label: "SP – já", color: ME, values: sp.a, unit: "bar", dash: "4 3" }, { label: `SP – ${who}`, color: BU, values: sp.b, unit: "bar", dash: "4 3" },
        ]} />
      </Card>
      <Card title="Zbývající deko (TTS)">
        <LineChart t={tts.t} series={[{ label: "TTS – já", color: ME, values: tts.a, unit: "min", width: 2 }, { label: `TTS – ${who}`, color: BU, values: tts.b, unit: "min", width: 2 }]} />
      </Card>
      <Card title="Inertní zátěž (kumulativně)">
        <LineChart t={inert.t} series={[{ label: "já", color: ME, values: inert.a, unit: "bar·min", width: 2 }, { label: who, color: BU, values: inert.b, unit: "bar·min", width: 2 }]} />
        <p className="note">∫ (okolní tlak − pO₂) dt – čím vyšší, tím víc inertního plynu a delší dekomprese.</p>
      </Card>
      {(co2.a.some((v) => v != null && v > 0) || co2.b.some((v) => v != null && v > 0)) && (
        <Card title="CO₂">
          <LineChart t={co2.t} series={[{ label: "CO₂ – já", color: ME, values: co2.a, unit: "mbar", width: 2 }, { label: `CO₂ – ${who}`, color: BU, values: co2.b, unit: "mbar", width: 2 }]} />
        </Card>
      )}
      <Card title="Rozdíly (od největšího)">
        <table className="kv cmp"><thead><tr><th></th><th>já</th><th>{who}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key} className={r.weight >= 1 ? "big" : r.weight > 0.2 ? "" : "small-diff"}><td>{r.label}</td><td>{r.a}</td><td>{r.b}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}
