// Před a po ponoru: „Před ponorem“ – lahve (on-board z Výstroje, externí) s tlakem potvrzeným z Výstroje nebo naměřeným,
// hydratace a kalibrace; „Po ponoru“ – tlaky lahví, které počítač neměří (zavřená on-board, externí), a „jenom oblek“.
// Tlaky se převezmou do Výstroje přes historii lahve (gearSync).
import { LOC } from "../app/i18n";
import { useState } from "react";
import { gasDisp } from "../app/gas";
import { HYD_LABEL, gearVol, prepSuitOnly, tankMix, tankVol, uid, type Logbook, type Prep, type PrepTank } from "../app/model";
import { tankLabel } from "./Gear";
import { ownMetas, rbAssign, saveSettings, saveTank, tankCheck } from "../app/store";
import { diveDilMix, onboardPress, rbMatch, tankEvents } from "../app/gearSync";
import { ask } from "../app/dialog";
import { num, useStore } from "./common";

/** Pod touto hodnotou počítač měří jen středotlak – lahev nebyla otevřená (P). */
const CLOSED = 20;
const CAL_GASES = ["AIR", "O₂", "kalibrační plyn"];
/** Úroveň podle tlaku: pod 50 bar červeně, pod 100 bar žlutě. */
const lvl = (bar?: number | null) => (bar == null ? "" : bar < 50 ? "c-bad" : bar < 100 ? "c-warn" : "");
const todayIso = () => new Date().toLocaleDateString("sv-SE");
const fmtAt = (ms: number) => new Date(ms).toLocaleString(LOC, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const parseBar = (v: string) => { const n = Math.round(+v.replace(",", ".")); return v.trim() && n >= 0 && n < 400 ? n : undefined; };

function BarInput({ value, onSave, placeholder }: { value?: number; onSave: (v?: number) => void; placeholder?: string }) {
  const [t, setT] = useState(value != null ? String(value) : "");
  return <input className={"bar-in " + lvl(parseBar(t))} type="number" inputMode="numeric" value={t} placeholder={placeholder || "bar"}
    onChange={(e) => setT(e.target.value)} onBlur={() => { const v = parseBar(t); if (v !== value) onSave(v); }} />;
}

const TANKS = ["S40", "S80", "12 l", "3 l", "2,5 l"];
const GASES = ["AIR", "O₂", "EAN32", "EAN36", "EAN50", "TMX 21/35", "TMX 18/45", "TMX 15/55", "TMX 10/70", "Argon"];
/** Plyn z poměru O₂/He: vzduch, O₂, EANxx nebo TMX a/b. */
const gasName = (o2: number, he: number) => (he > 0 ? `TMX ${o2}/${he}` : o2 === 21 ? "AIR" : o2 === 100 ? "O₂" : `EAN${o2}`);
/** Stávající textový zápis plynu → položka seznamu (nebo null = jiný). */
const gasKnown = (g0: string) => { const g = gasDisp(g0); if (GASES.includes(g)) return g; if (/^argon$/i.test(g.trim())) return "Argon"; const m = tankMix(g); if (!m) return null; const [o, h] = m.split("/").map(Number); const n = gasName(o, h); return GASES.includes(n) ? n : null; };

/** Tlak lahve z Výstroje před ponorem (poslední událost před začátkem ponoru; bez ponoru aktuální tlak). */
function barBefore(lb: Logbook, id: string, t0?: number): number | undefined {
  const t = lb.tanks?.[id];
  if (!t) return undefined;
  if (t0 == null) return t.bar;
  const ev = tankEvents(lb, ownMetas(), id).filter((e) => e.at < t0 && e.bar != null);
  return ev.length ? ev[ev.length - 1].bar! : undefined;
}

/** Tlak do výběru lahve: před ponorem, bez historie před ponorem aktuální („nyní“). */
function optBar(lb: Logbook, id: string, t0?: number): string {
  const b = barBefore(lb, id, t0);
  if (b != null) return ` · ${b} bar`;
  const now = lb.tanks?.[id]?.bar;
  return now != null && t0 != null ? ` · ${now} bar (nyní)` : "";
}

/** Novější záznam lahve než konec ponoru (plnění, kontrola, jiný ponor) – tlak po ponoru se do Výstroje nepřepíše. */
function laterNote(lb: Logbook, id: string | undefined, diveId?: string): string | null {
  if (!id || !diveId) return null;
  const m = ownMetas().find((x) => x.id === diveId);
  if (!m) return null;
  const t1 = (m.start + m.h.diveTimeS) * 1000;
  const e = tankEvents(lb, ownMetas(), id).find((x) => x.at > t1 && x.diveId !== diveId);
  if (!e) return null;
  const d = new Date(e.at).toLocaleDateString(LOC, { day: "numeric", month: "numeric" });
  return `Ve Výstroji se nepřepíše – ${e.kind === "fill" ? `${d} plnění na ${e.bar} bar` : e.kind === "check" ? `${d} kontrola ${e.bar} bar` : `použita v ponoru ${d}`}`;
}

/** Tlak před ponorem: vlastní zadání, nebo potvrzení tlaku z Výstroje. */
function StartBar({ value, mg, onSave }: { value?: number; mg?: number; onSave: (v?: number) => void }) {
  return (<>
    <BarInput key={value ?? "x"} value={value} placeholder={mg != null ? String(mg) : "bar"} onSave={onSave} />
    {mg != null && value == null && <button className="btn small" onClick={() => onSave(mg)}>✓ {mg} bar</button>}
    {mg != null && value != null && (value === mg ? <span className="small c-ok">✓ jako ve Výstroji</span> : <span className="small muted">Výstroj {mg} bar – nový tlak se uloží jako kontrola</span>)}
  </>);
}

/** Před ponorem – externí lahev: lahev z Výstroje (nebo vlastní), role, tlak, oblek. */
function TankPre({ t, set, del, t0 }: { t: PrepTank; set: (p: Partial<PrepTank>) => void; del: () => void; t0?: number }) {
  const known = TANKS.includes(t.name);
  const v = tankVol(t);
  const gk = gasKnown(t.gas);
  const [editVol, setEditVol] = useState(!known && !v);
  const [editGas, setEditGas] = useState(!gk && !t.gas);
  const [o2, setO2] = useState(""), [he, setHe] = useState("");
  const st = useStore();
  const gear = Object.values(st.lb.tanks || {}).filter((g) => !g.onboard).sort((a, b) => tankLabel(a).localeCompare(tankLabel(b), "cs", { numeric: true }));
  const g = t.gearId ? st.lb.tanks?.[t.gearId] : undefined;
  const mg = g ? barBefore(st.lb, g.id, t0) : undefined;
  const argon = /^\s*argon\s*$/i.test(t.gas), isO2 = tankMix(t.gas) === "100/0";
  return (
    <div className="prep-tank">
      <div className="pt-row pt-full">
        <select className="pt-gear" value={t.gearId || ""} onChange={(e) => {
          const x = st.lb.tanks?.[e.target.value];
          if (!x) { set({ gearId: undefined }); return; }
          set({ gearId: x.id, name: TANKS.includes(x.kind) ? x.kind : "Jiná", vol: gearVol(x), gas: gasDisp(x.mix), bar: undefined, ...(/^argon$/i.test(x.mix) ? { role: "suit" as const } : tankMix(x.mix) === "100/0" && t.role === "bo" ? { role: "deco" as const } : {}) });
        }}>
          <option value="">{gear.length ? "lahev mimo Výstroj" : "lahev (Výstroj je prázdná)"}</option>{gear.map((x) => <option key={x.id} value={x.id}>{tankLabel(x)} · {gasDisp(x.mix)}{optBar(st.lb, x.id, t0)}</option>)}
        </select>
        <button className="btn small" aria-label="Odebrat" onClick={del}>✕</button>
      </div>
      {!g && <div className="pt-row">
        <select value={known ? t.name : "Jiná"} onChange={(e) => { const x = e.target.value; if (x === "Jiná") { set({ name: "Jiná", vol: undefined }); setEditVol(true); } else { set({ name: x, vol: undefined }); setEditVol(false); } }}>
          {TANKS.map((x) => <option key={x}>{x}</option>)}<option>Jiná</option>
        </select>
        <select value={gk ?? "_jiny"} onChange={(e) => { const x = e.target.value; if (x === "_jiny") { setEditGas(true); return; } setEditGas(false); set({ gas: x, ...(x === "Argon" ? { role: "suit" as const } : {}) }); }}>
          {GASES.map((x) => <option key={x}>{x}</option>)}<option value="_jiny">Jiný</option>
        </select>
      </div>}
      {!g && (editVol || editGas) && <div className="pt-row">
        {editVol && <><input className="tank-vol" inputMode="decimal" placeholder="objem" defaultValue={v ?? ""} onBlur={(e) => { const x = parseFloat(e.target.value.replace(",", ".")); if (x > 0) { set({ name: "Jiná", vol: x }); setEditVol(false); } }} /><span className="small muted">l</span></>}
        {editGas && <><input className="tank-vol" inputMode="numeric" placeholder="O₂ %" value={o2} onChange={(e) => setO2(e.target.value)} />
          <input className="tank-vol" inputMode="numeric" placeholder="He %" value={he} onChange={(e) => setHe(e.target.value)} />
          <button className="btn small" onClick={() => { const a = Math.round(+o2), h = Math.round(+he || 0); if (a > 0 && a <= 100 && h >= 0 && a + h <= 100) { set({ gas: gasName(a, h) }); setEditGas(false); } }}>OK</button></>}
      </div>}
      {!g && (!known || !gk) && !editVol && !editGas && (
        <div className="pt-info small muted" onClick={() => { if (!known) setEditVol(true); if (!gk) setEditGas(true); }}>{!known ? `Jiná ${v ? num(v, 1) + " l" : "?"}` : t.name}{!gk ? ` · ${t.gas || "plyn?"}` : ""} <span className="link">upravit</span></div>
      )}
      <div className="pt-row">
        <span className="muted small">tlak</span><StartBar value={t.bar} mg={mg} onSave={(b) => set({ bar: b })} />
        <select className="pt-role" value={t.role} onChange={(e) => set({ role: e.target.value as PrepTank["role"] })}>
          <option value="bo">BO</option><option value="deco">Deko</option><option value="o2">O₂</option><option value="dil">Dil</option><option value="suit">Oblek</option><option value="other">Jiná</option>
        </select>
      </div>
      {!isO2 && !argon && t.role !== "suit" && <label className="small inline same"><input type="checkbox" checked={!!t.suit} onChange={(e) => set({ suit: e.target.checked, ...(e.target.checked ? {} : { suitOnly: undefined }) })} />oblek (lahev plní i oblek)</label>}
      {g?.check && <div className="small c-warn">Ve Výstroji: ověřit tlak ({g.check.text}).</div>}
    </div>
  );
}

/** Po ponoru – externí lahev: tlak po, beze změny, jenom oblek. */
function TankPost({ t, set, diveId }: { t: PrepTank; set: (p: Partial<PrepTank>) => void; diveId?: string }) {
  const v = tankVol(t);
  const end = t.same ? t.bar : t.end;
  const used = t.bar != null && end != null ? t.bar - end : null;
  const st = useStore();
  const g = t.gearId ? st.lb.tanks?.[t.gearId] : undefined;
  const suitOnly = prepSuitOnly(t);
  return (
    <div className="prep-tank post">
      <div className="pt-row"><b className="small">{g ? tankLabel(g) : t.name}</b><span className="small muted">{ROLE[t.role]} · {gasDisp(t.gas)} · před {t.bar ?? "–"} bar</span></div>
      <div className="pt-row">
        <span className="muted small">po</span>{t.same ? <span className="small">= {t.bar ?? "–"}</span> : <BarInput value={t.end} placeholder="bar" onSave={(b) => set({ end: b })} />}
        <label className="small inline same"><input type="checkbox" checked={!!t.same} onChange={(e) => set({ same: e.target.checked, end: e.target.checked ? t.bar : undefined })} />beze změny</label>
        <span className="muted small">{used != null && v ? `${used} bar · ${num(used * v, 0)} l${suitOnly ? " oblek" : ""}` : ""}</span>
      </div>
      {(() => { const n = laterNote(st.lb, t.gearId, diveId); return n && <div className="small muted later">{n}</div>; })()}
      {t.suit && <label className="small inline same"><input type="checkbox" checked={!!t.suitOnly} onChange={(e) => set({ suitOnly: e.target.checked || undefined })} />jenom oblek (celý úbytek = plnění obleku)</label>}
    </div>
  );
}
const ROLE: Record<PrepTank["role"], string> = { bo: "BO", o2: "O₂", dil: "Dil", deco: "Deko", suit: "Oblek", other: "Jiná" };

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
  const [gas, setGas] = useState(gasDisp(st.lb.settings.co2Cal?.gas || "AIR"));
  const p: Prep = prep || {};
  const upd = (patch: Partial<Prep>) => onChange({ ...p, ...patch });
  const tanks = p.tanks || [];
  const setTank = (id: string, patch: Partial<PrepTank>) => upd({ tanks: tanks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  // lahve z poslední přípravy (bailouty se obvykle nemění)
  const lastTanks = [...Object.values(st.lb.notes), ...Object.values(st.lb.drafts)].filter((n) => n.prep?.tanks?.length && n.prep !== prep)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))[0]?.prep?.tanks;
  const worst = [p.o2, p.dil, ...tanks.map((t) => t.bar)].some((b) => b != null && b < 50) ? "c-bad" : [p.o2, p.dil, ...tanks.map((t) => t.bar)].some((b) => b != null && b < 100) ? "c-warn" : "";
  const meta = diveId ? st.metas.find((m) => m.id === diveId) : undefined;
  const t0 = meta ? meta.start * 1000 : undefined;

  // on-board lahev z Výstroje: u ponoru přiřazení (automatické / ruční), v rozpracovaném ponoru výběr v přípravě
  const rbList = (key: "o2" | "dil") => Object.values(st.lb.tanks || {}).filter((t) => t.onboard === key).sort((a, b) => (a.name || "").localeCompare(b.name || "", "cs", { numeric: true }));
  const rbCur = (key: "o2" | "dil") => (meta ? st.lb.notes[meta.id]?.rb?.[key] : p[key === "o2" ? "o2Tank" : "dilTank"] ? { id: p[key === "o2" ? "o2Tank" : "dilTank"]!, auto: false } : undefined);
  const rbSel = (key: "o2" | "dil") => {
    const list = rbList(key);
    if (!list.length) return null;
    const cur = rbCur(key);
    const why = meta && !cur ? rbMatch(st.lb, meta, key).why : "";
    return (<>
      <select className="pt-gear" value={cur?.id || ""} onChange={async (e) => {
        const id = e.target.value || null;
        if (!meta) { upd({ [key === "o2" ? "o2Tank" : "dilTank"]: id || undefined }); return; }
        await rbAssign(meta.id, key, id);
        const t = id ? st.lb.tanks?.[id] : undefined, mix = diveDilMix(meta);
        if (key === "dil" && t && mix && tankMix(t.mix) !== mix && await ask(`Směs v logu je ${mix}, u ${t.name} je ${gasDisp(t.mix)}. Změnit směs lahve na ${mix}?`, { ok: "Změnit" }))
          await saveTank({ ...t, mix: (() => { const [o, h] = mix.split("/").map(Number); return gasName(o, h); })() });
      }}>
        <option value="">{cur ? "nepřiřazeno" : "Která lahev?"}</option>{list.map((t) => <option key={t.id} value={t.id}>{t.name} · {gasDisp(t.mix)}{optBar(st.lb, t.id, t0)}</option>)}
      </select>
    </>);
  };
  const obPre = (key: "o2" | "dil", label: string) => {
    const cur = rbCur(key), mg = cur ? barBefore(st.lb, cur.id, t0) : undefined;
    const r = real?.[key], typed = p[key], confKey = key === "o2" ? "o2Conf" : "dilConf";
    const why = meta && !cur && rbList(key).length ? rbMatch(st.lb, meta, key).why : "";
    const rr = r != null ? Math.round(r) : null, diff = rr != null && mg != null && Math.abs(rr - mg) > 15;
    return (
      <div className="prep-ob">
        <div className="prep-row"><span className="prep-l">{label}</span>{cur?.auto ? <span className="small muted">auto</span> : why ? <span className="small c-warn">{why}</span> : null}</div>
        <div className="pt-row pt-full">{rbSel(key)}</div>
        {rr != null && rr >= CLOSED
          ? <div className="prep-row"><span className="prep-l small muted">tlak</span><span><b>{rr} bar</b> <span className="small muted">z logu{mg != null ? ` · Výstroj ${mg} bar` : cur && st.lb.tanks?.[cur.id]?.bar != null ? ` · Výstroj nyní ${st.lb.tanks[cur.id]!.bar} bar` : ""}</span></span></div>
          : <div className="prep-row"><span className="prep-l small muted">tlak</span><StartBar value={typed} mg={mg} onSave={(v) => upd({ [key]: v })} /></div>}
        {rr != null && rr >= CLOSED && diff && (p[confKey] === rr
          ? <div className="small c-ok">✓ {rr} bar potvrzeno (rozdíl proti Výstroji {rr - mg! > 0 ? "+" : ""}{rr - mg!} bar)</div>
          : <div className="small c-warn">Liší se od Výstroje o {rr - mg! > 0 ? "+" : ""}{rr - mg!} bar (plnění, vysílač, nebo jiná lahev?) <button className="btn small" onClick={async () => { upd({ [confKey]: rr }); if (cur && t0 != null) await tankCheck(cur.id, rr, false, undefined, t0 - 60000); }}>Potvrdit {rr} bar</button></div>)}
      </div>
    );
  };
  const obPost = (key: "o2" | "dil", label: string) => {
    const ob = meta ? onboardPress(meta, p, key) : null;
    const endKey = key === "o2" ? "o2End" : "dilEnd";
    return (
      <div className="prep-row">
        <span className="prep-l">{label}</span>
        {ob?.src === "log" ? <span className="small">{ob.start} → <b>{ob.end} bar</b> <span className="muted">z logu</span></span>
          : <><BarInput value={p[endKey]} placeholder="bar" onSave={(v) => upd({ [endKey]: v })} />
            <span className="small muted">{!meta ? "po nahrání logu se při otevřené lahvi doplní z počítače" : ob?.closed ? "lahev byla zavřená – zadej tlak" : "počítač tlak nezná – zadej tlak"}</span></>}
        {(() => { const n = laterNote(st.lb, rbCur(key)?.id, meta?.id); return n && <div className="small muted later">{n}</div>; })()}
      </div>
    );
  };

  return (
    <section className="card prep">
      <div className="card-h" onClick={() => setOpen(!open)}>
        <h2>{open ? "▾" : "▸"} Před a po ponoru</h2>
      </div>
      {!open && <p className={"small " + (worst || "muted")} onClick={() => setOpen(true)}>{summary(prep)}</p>}
      {open && <>
        <div className="prep-sec">
          <h3 className="prep-h">Před ponorem</h3>
          {cc && <>
            <h4 className="subh">On-board lahve</h4>
            {obPre("o2", "O₂")}
            {obPre("dil", "Diluent")}
          </>}
          <h4 className="subh">Externí lahve</h4>
          {tanks.map((t) => <TankPre key={t.id} t={t} t0={t0} set={(x) => setTank(t.id, x)} del={() => upd({ tanks: tanks.filter((x) => x.id !== t.id) })} />)}
          <div className="row">
            <button className="btn small" onClick={() => upd({ tanks: [...tanks, { id: uid(), role: tanks.length ? "deco" : "bo", name: "S80", gas: tanks.length ? "O₂" : "AIR" }] })}>＋ Přidat lahev</button>
            {!tanks.length && lastTanks && <button className="btn small" onClick={() => upd({ tanks: lastTanks.map((t) => ({ ...t, id: uid(), bar: undefined, end: undefined, same: undefined, suitOnly: undefined })) })}>Lahve jako minule</button>}
          </div>
          <p className="note">Tlak předvyplní Výstroj – potvrď ✓, nebo zadej naměřený (nový tlak se ve Výstroji uloží jako kontrola). U lahve, která plní i oblek, zaškrtni „oblek“.</p>
          <h4 className="subh">Hydratace</h4>
          <div className="seg hyd">
            {(["low", "mid", "good"] as const).map((k) => <button key={k} className={p.hyd === k ? "on" : ""} onClick={() => upd({ hyd: p.hyd === k ? undefined : k })}>{HYD_LABEL[k]}</button>)}
          </div>
          <p className="note">Jen informace k ponoru (nic se z ní nepočítá) – při případné nehodě může být důležitá.</p>
          {cc && <>
            <h4 className="subh">Kalibrace čidel</h4>
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
        </div>
        <div className="prep-sec">
          <h3 className="prep-h">Po ponoru</h3>
          {cc && <>{obPost("o2", "O₂")}{obPost("dil", "Diluent")}</>}
          {tanks.map((t) => <TankPost key={t.id} t={t} diveId={meta?.id} set={(x) => setTank(t.id, x)} />)}
          {!tanks.length && !cc && <p className="muted small">Žádné lahve – přidej je v části Před ponorem.</p>}
          <p className="note">Doplň tlak u lahví, které počítač neměří (zavřená on-board lahev, externí lahve). Tlaky po ponoru se převezmou do Výstroje – u staršího ponoru jen u lahví, které od té doby nebyly použity ani kontrolovány.</p>
        </div>
      </>}
    </section>
  );
}
