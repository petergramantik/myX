// Předponorová příprava: naměřené tlaky onboard lahví, offboard lahve (bailout, offboard O₂) a potvrzení kalibrace čidel.
// Vyplňuje se typicky v rozpracovaném ponoru (večer před ponorem); po spárování s logem se tlaky onboard lahví porovnají s počítačem.
import { useState } from "react";
import { uid, type Prep, type PrepTank } from "../app/model";
import { saveSettings } from "../app/store";
import { num, useStore } from "./common";

const CAL_GASES = ["vzduch", "O₂", "kalibrační plyn"];
/** Úroveň podle tlaku: pod 50 bar červeně, pod 100 bar žlutě. */
const lvl = (bar?: number | null) => (bar == null ? "" : bar < 50 ? "c-bad" : bar < 100 ? "c-warn" : "");
const todayIso = () => new Date().toLocaleDateString("sv-SE");
const fmtAt = (ms: number) => new Date(ms).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const parseBar = (v: string) => { const n = Math.round(+v.replace(",", ".")); return v.trim() && n >= 0 && n < 400 ? n : undefined; };

function BarInput({ value, onSave, placeholder }: { value?: number; onSave: (v?: number) => void; placeholder?: string }) {
  const [t, setT] = useState(value != null ? String(value) : "");
  return <input className={"bar-in " + lvl(parseBar(t))} type="number" inputMode="numeric" value={t} placeholder={placeholder || "bar"}
    onChange={(e) => setT(e.target.value)} onBlur={() => { const v = parseBar(t); if (v !== value) onSave(v); }} />;
}

/** Krátké shrnutí pro sbalený stav. */
function summary(p?: Prep): string {
  if (!p) return "nevyplněno";
  const parts: string[] = [];
  if (p.o2 != null) parts.push(`O₂ ${p.o2} bar`);
  if (p.dil != null) parts.push(`diluent ${p.dil} bar`);
  if (p.tanks?.length) parts.push(`${p.tanks.length} ${p.tanks.length === 1 ? "offboard lahev" : p.tanks.length < 5 ? "offboard lahve" : "offboard lahví"}`);
  const cal = [p.o2Cal && "O₂", p.co2Cal && "CO₂"].filter(Boolean);
  if (cal.length) parts.push(`kalibrace ${cal.join(" + ")}`);
  return parts.join(" · ") || "nevyplněno";
}

export function PrepCard({ prep, onChange, real, cc = true }: { prep?: Prep; onChange: (p: Prep) => void; real?: { dil: number | null; o2: number | null }; cc?: boolean }) {
  const st = useStore();
  const [open, setOpen] = useState(false);
  const [gas, setGas] = useState(st.lb.settings.co2Cal?.gas || "vzduch");
  const p: Prep = prep || {};
  const upd = (patch: Partial<Prep>) => onChange({ ...p, ...patch });
  const tanks = p.tanks || [];
  const setTank = (id: string, patch: Partial<PrepTank>) => upd({ tanks: tanks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  // lahve z poslední přípravy (bailouty se obvykle nemění)
  const lastTanks = [...Object.values(st.lb.notes), ...Object.values(st.lb.drafts)].filter((n) => n.prep?.tanks?.length && n.prep !== prep)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))[0]?.prep?.tanks;
  const worst = [p.o2, p.dil, ...tanks.map((t) => t.bar)].some((b) => b != null && b < 50) ? "c-bad" : [p.o2, p.dil, ...tanks.map((t) => t.bar)].some((b) => b != null && b < 100) ? "c-warn" : "";

  const onboard = (key: "o2" | "dil", label: string) => {
    const r = real?.[key];
    return (
      <div className="prep-row">
        <span className="prep-l">{label}</span>
        <BarInput value={p[key]} onSave={(v) => upd({ [key]: v })} />
        <span className="muted small">{r != null ? <>reálně <b className={lvl(r)}>{num(r, 0)} bar</b>{p[key] != null ? ` (${r - p[key]! >= 0 ? "+" : ""}${num(r - p[key]!, 0)})` : ""}</> : real ? "počítač tlak nezná" : ""}</span>
      </div>
    );
  };

  return (
    <section className="card prep">
      <div className="card-h" onClick={() => setOpen(!open)}>
        <h2>{open ? "▾" : "▸"} Předponorová příprava</h2>
      </div>
      {!open && <p className={"small " + (worst || "muted")} onClick={() => setOpen(true)}>{summary(prep)}</p>}
      {open && <>
        {cc && <>
          <h3 className="subh">Onboard lahve</h3>
          {onboard("o2", "O₂")}
          {onboard("dil", "Diluent")}
          {real && <p className="note">Reálný tlak = první údaj z počítače v ponoru.</p>}
        </>}
        <h3 className="subh">Offboard lahve</h3>
        {tanks.map((t) => (
          <div key={t.id} className="prep-tank">
            <select value={t.role} onChange={(e) => setTank(t.id, { role: e.target.value as PrepTank["role"] })}>
              <option value="bo">BO</option><option value="o2">O₂</option><option value="deco">Deko</option><option value="other">Jiná</option>
            </select>
            <input className="tank-name" value={t.name} placeholder="S80" onChange={(e) => setTank(t.id, { name: e.target.value })} />
            <input className="tank-gas" value={t.gas} placeholder="vzduch" onChange={(e) => setTank(t.id, { gas: e.target.value })} />
            <BarInput value={t.bar} onSave={(v) => setTank(t.id, { bar: v })} />
            <button className="btn small" aria-label="Odebrat" onClick={() => upd({ tanks: tanks.filter((x) => x.id !== t.id) })}>✕</button>
          </div>
        ))}
        <div className="row">
          <button className="btn small" onClick={() => upd({ tanks: [...tanks, { id: uid(), role: tanks.length ? "o2" : "bo", name: tanks.length ? "S40" : "S80", gas: tanks.length ? "O₂" : "vzduch" }] })}>＋ Přidat lahev</button>
          {!tanks.length && lastTanks && <button className="btn small" onClick={() => upd({ tanks: lastTanks.map((t) => ({ ...t, id: uid(), bar: undefined })) })}>Lahve jako minule</button>}
        </div>
        <p className="note">Pod 100 bar žlutě, pod 50 bar červeně.</p>
        {cc && <>
          <h3 className="subh">Kalibrace čidel</h3>
          <div className="prep-row">
            <span className="prep-l">Čidla O₂</span>
            {p.o2Cal ? <span>✓ potvrzeno {fmtAt(p.o2Cal)} <button className="btn small" onClick={() => upd({ o2Cal: undefined })}>✕</button></span>
              : <button className="btn small" onClick={async () => { upd({ o2Cal: Date.now() }); await saveSettings({ o2Cal: { date: todayIso() } }); }}>Potvrdit kalibraci</button>}
          </div>
          <div className="prep-row">
            <span className="prep-l">Čidlo CO₂</span>
            {p.co2Cal ? <span>✓ {p.co2Cal.gas} · {fmtAt(p.co2Cal.at)} <button className="btn small" onClick={() => upd({ co2Cal: undefined })}>✕</button></span>
              : <>
                <select value={CAL_GASES.includes(gas) ? gas : "jiný"} onChange={(e) => setGas(e.target.value === "jiný" ? "" : e.target.value)}>
                  {CAL_GASES.map((g) => <option key={g}>{g}</option>)}<option>jiný</option>
                </select>
                {!CAL_GASES.includes(gas) && <input className="tank-gas" value={gas} placeholder="1 % CO₂" onChange={(e) => setGas(e.target.value)} />}
                <button className="btn small" onClick={async () => { const g = gas || "jiný"; upd({ co2Cal: { at: Date.now(), gas: g } }); await saveSettings({ co2Cal: { date: todayIso(), gas: g } }); }}>Potvrdit</button>
              </>}
          </div>
        </>}
      </>}
    </section>
  );
}
