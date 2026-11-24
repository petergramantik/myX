// Před a po ponoru (dřív „Předponorová příprava“): naměřené tlaky on-board lahví, off-board lahve (bailout, off-board O₂) a potvrzení kalibrace čidel.
// Vyplňuje se typicky v rozpracovaném ponoru (večer před ponorem); po spárování s logem se tlaky on-board lahví porovnají s počítačem.
import { useState } from "react";
import { HYD_LABEL, gearVol, tankMix, tankVol, uid, type Prep, type PrepTank } from "../app/model";
import { tankLabel } from "./Gear";
import { rbAssign, saveSettings, saveTank } from "../app/store";
import { diveDilMix, rbMatch } from "../app/gearSync";
import { ask } from "../app/dialog";
import { num, useStore } from "./common";

/** Pod touto hodnotou počítač měří jen středotlak – lahev nebyla otevřená (P). */
const CLOSED = 20;
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

const TANKS = ["S40", "S80", "12 l", "3 l", "2,5 l"];
const GASES = ["vzduch", "O₂", "EAN32", "EAN36", "EAN50", "TMX 21/35", "TMX 18/45", "TMX 15/55", "TMX 10/70", "Argon"];
/** Plyn z poměru O₂/He: vzduch, O₂, EANxx nebo TMX a/b. */
const gasName = (o2: number, he: number) => (he > 0 ? `TMX ${o2}/${he}` : o2 === 21 ? "vzduch" : o2 === 100 ? "O₂" : `EAN${o2}`);
/** Stávající textový zápis plynu → položka seznamu (nebo null = jiný). */
const gasKnown = (g: string) => { if (GASES.includes(g)) return g; if (/^argon$/i.test(g.trim())) return "Argon"; const m = tankMix(g); if (!m) return null; const [o, h] = m.split("/").map(Number); const n = gasName(o, h); return GASES.includes(n) ? n : null; };

/** Řádek off-board lahve: role, lahev a plyn z nabídky; u „Jiná“ / „Jiný“ zadání, po vyplnění jen informační řádek. */
function TankRow({ t, set, del }: { t: PrepTank; set: (p: Partial<PrepTank>) => void; del: () => void }) {
  const known = TANKS.includes(t.name);
  const v = tankVol(t);
  const gk = gasKnown(t.gas);
  const [editVol, setEditVol] = useState(!known && !v);
  const [editGas, setEditGas] = useState(!gk && !t.gas);
  const [o2, setO2] = useState(""), [he, setHe] = useState("");
  const used = t.bar != null && (t.same ? t.bar : t.end) != null ? t.bar - (t.same ? t.bar : t.end)! : null;
  const st = useStore();
  const gear = Object.values(st.lb.tanks || {}).filter((g) => !g.onboard);
  const g = t.gearId ? st.lb.tanks?.[t.gearId] : undefined;
  return (
    <div className="prep-tank">
      {gear.length > 0 && <div className="pt-row">
        <select value={t.gearId || ""} onChange={(e) => {
          const x = st.lb.tanks?.[e.target.value];
          if (!x) { set({ gearId: undefined }); return; }
          set({ gearId: x.id, name: TANKS.includes(x.kind) ? x.kind : "Jiná", vol: gearVol(x), gas: x.mix, bar: x.bar, ...(x.mix === "Argon" ? { role: "suit" as const } : {}) });
        }}>
          <option value="">lahev mimo Výstroj</option>{gear.map((x) => <option key={x.id} value={x.id}>{tankLabel(x)} · {x.mix}{x.bar != null ? ` · ${x.bar} bar` : ""}</option>)}
        </select>
        {g?.check && <span className="small c-warn">ověřit tlak</span>}
      </div>}
      <div className="pt-row">
        <select value={t.role} onChange={(e) => set({ role: e.target.value as PrepTank["role"] })}>
          <option value="bo">BO</option><option value="o2">O₂</option><option value="dil">Dil</option><option value="deco">Deko</option><option value="suit">Oblek</option><option value="other">Jiná</option>
        </select>
        <select value={known ? t.name : "Jiná"} onChange={(e) => { const x = e.target.value; if (x === "Jiná") { set({ name: "Jiná", vol: undefined }); setEditVol(true); } else { set({ name: x, vol: undefined }); setEditVol(false); } }}>
          {TANKS.map((x) => <option key={x}>{x}</option>)}<option>Jiná</option>
        </select>
        <select value={gk ?? "_jiny"} onChange={(e) => { const x = e.target.value; if (x === "_jiny") { setEditGas(true); return; } setEditGas(false); set({ gas: x, ...(x === "Argon" ? { role: "suit" as const } : {}) }); }}>
          {GASES.map((x) => <option key={x}>{x}</option>)}<option value="_jiny">Jiný</option>
        </select>
        <button className="btn small" aria-label="Odebrat" onClick={del}>✕</button>
      </div>
      {(editVol || editGas) && <div className="pt-row">
        {editVol && <><input className="tank-vol" inputMode="decimal" placeholder="objem" defaultValue={v ?? ""} onBlur={(e) => { const x = parseFloat(e.target.value.replace(",", ".")); if (x > 0) { set({ name: "Jiná", vol: x }); setEditVol(false); } }} /><span className="small muted">l</span></>}
        {editGas && <><input className="tank-vol" inputMode="numeric" placeholder="O₂ %" value={o2} onChange={(e) => setO2(e.target.value)} />
          <input className="tank-vol" inputMode="numeric" placeholder="He %" value={he} onChange={(e) => setHe(e.target.value)} />
          <button className="btn small" onClick={() => { const a = Math.round(+o2), h = Math.round(+he || 0); if (a > 0 && a <= 100 && h >= 0 && a + h <= 100) { set({ gas: gasName(a, h) }); setEditGas(false); } }}>OK</button></>}
      </div>}
      {(!known || !gk) && !editVol && !editGas && (
        <div className="pt-info small muted" onClick={() => { if (!known) setEditVol(true); if (!gk) setEditGas(true); }}>{!known ? `Jiná ${v ? num(v, 1) + " l" : "?"}` : t.name}{!gk ? ` · ${t.gas || "plyn?"}` : ""} <span className="link">upravit</span></div>
      )}
      <div className="pt-row">
        <span className="muted small">před</span><BarInput value={t.bar} onSave={(b) => set({ bar: b })} />
        <span className="muted small">po</span>{t.same ? <span className="small">= {t.bar ?? "–"}</span> : <BarInput value={t.end} placeholder="bar" onSave={(b) => set({ end: b })} />}
        <label className="small inline same"><input type="checkbox" checked={!!t.same} onChange={(e) => set({ same: e.target.checked, end: e.target.checked ? t.bar : undefined })} />beze změny</label>
        <span className="muted small">{v ? `${num(v, 1)} l` : ""}{used != null && v ? ` · ${num(used * v, 0)} l` : ""}</span>
      </div>
    </div>
  );
}

/** Krátké shrnutí pro sbalený stav. */
function summary(p?: Prep): string {
  if (!p) return "nevyplněno";
  const parts: string[] = [];
  if (p.o2 != null) parts.push(`O₂ ${p.o2} bar`);
  if (p.dil != null) parts.push(`diluent ${p.dil} bar`);
  if (p.tanks?.length) parts.push(`${p.tanks.length} ${p.tanks.length === 1 ? "off-board lahev" : p.tanks.length < 5 ? "off-board lahve" : "off-board lahví"}`);
  if (p.hyd) parts.push(`hydratace ${HYD_LABEL[p.hyd].toLowerCase()}`);
  const cal = [p.o2Cal && "O₂", p.co2Cal && "CO₂"].filter(Boolean);
  if (cal.length) parts.push(`kalibrace ${cal.join(" + ")}`);
  return parts.join(" · ") || "nevyplněno";
}

export function PrepCard({ prep, onChange, real, cc = true, diveId }: { prep?: Prep; onChange: (p: Prep) => void; real?: { dil: number | null; o2: number | null }; cc?: boolean; /** u ponoru: přiřazení on-board lahví z Výstroje */ diveId?: string }) {
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

  // on-board lahev z Výstroje přiřazená k ponoru (automaticky rozpoznaná nebo ručně vybraná)
  const meta = diveId ? st.metas.find((m) => m.id === diveId) : undefined;
  const rbSel = (key: "o2" | "dil") => {
    if (!meta) return null;
    const list = Object.values(st.lb.tanks || {}).filter((t) => t.onboard === key).sort((a, b) => (a.name || "").localeCompare(b.name || "", "cs", { numeric: true }));
    if (!list.length) return null;
    const cur = st.lb.notes[meta.id]?.rb?.[key];
    const why = !cur ? rbMatch(st.lb, meta, key).why : "";
    return (
      <div className="prep-row rb-row">
        <span className="prep-l small muted">lahev</span>
        <select value={cur?.id || ""} onChange={async (e) => {
          const id = e.target.value || null;
          await rbAssign(meta.id, key, id);
          const t = id ? st.lb.tanks?.[id] : undefined, mix = diveDilMix(meta);
          if (key === "dil" && t && mix && tankMix(t.mix) !== mix && await ask(`Směs v logu je ${mix}, u ${t.name} je ${t.mix}. Změnit směs lahve na ${mix}?`, { ok: "Změnit" }))
            await saveTank({ ...t, mix: (() => { const [o, h] = mix.split("/").map(Number); return gasName(o, h); })() });
        }}>
          <option value="">{cur ? "nepřiřazeno" : "Která lahev?"}</option>{list.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.mix}{t.bar != null ? ` · ${t.bar} bar` : ""}</option>)}
        </select>
        {cur?.auto ? <span className="small muted">auto</span> : !cur ? <span className="small c-warn">{why}</span> : null}
      </div>
    );
  };
  const onboard = (key: "o2" | "dil", label: string) => {
    const r = real?.[key];
    return (<>
      <div className="prep-row">
        <span className="prep-l">{label}</span>
        <BarInput value={p[key]} onSave={(v) => upd({ [key]: v })} />
        <span className="muted small">{r != null && r < CLOSED ? <>bez změny <span title="počítač naměřil jen středotlak – lahev nebyla otevřená">(lahev zavřená)</span></>
          : r != null ? <>reálně <b className={lvl(r)}>{num(r, 0)} bar</b>{p[key] != null ? ` (${r - p[key]! >= 0 ? "+" : ""}${num(r - p[key]!, 0)})` : ""}</> : real ? "počítač tlak nezná" : ""}</span>
      </div>
      {rbSel(key)}
    </>);
  };

  return (
    <section className="card prep">
      <div className="card-h" onClick={() => setOpen(!open)}>
        <h2>{open ? "▾" : "▸"} Před a po ponoru</h2>
      </div>
      {!open && <p className={"small " + (worst || "muted")} onClick={() => setOpen(true)}>{summary(prep)}</p>}
      {open && <>
        {cc && <>
          <h3 className="subh">On-board lahve</h3>
          {onboard("o2", "O₂")}
          {onboard("dil", "Diluent")}
          {real && <p className="note">Reálný tlak = první údaj z počítače v ponoru.</p>}
        </>}
        <h3 className="subh">Off-board lahve</h3>
        {tanks.map((t) => <TankRow key={t.id} t={t} set={(p) => setTank(t.id, p)} del={() => upd({ tanks: tanks.filter((x) => x.id !== t.id) })} />)}
        <div className="row">
          <button className="btn small" onClick={() => upd({ tanks: [...tanks, { id: uid(), role: tanks.length ? "o2" : "bo", name: tanks.length ? "S40" : "S80", gas: tanks.length ? "O₂" : "vzduch" }] })}>＋ Přidat lahev</button>
          {!tanks.length && lastTanks && <button className="btn small" onClick={() => upd({ tanks: lastTanks.map((t) => ({ ...t, id: uid(), bar: undefined })) })}>Lahve jako minule</button>}
        </div>
        <p className="note">Pod 100 bar žlutě, pod 50 bar červeně.</p>
        <h3 className="subh">Hydratace</h3>
        <div className="seg hyd">
          {(["low", "mid", "good"] as const).map((k) => <button key={k} className={p.hyd === k ? "on" : ""} onClick={() => upd({ hyd: p.hyd === k ? undefined : k })}>{HYD_LABEL[k]}</button>)}
        </div>
        <p className="note">Jen informace k ponoru (nic se z ní nepočítá) – při případné nehodě může být důležitá.</p>
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
