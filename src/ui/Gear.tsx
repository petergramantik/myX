// Výstroj: moje lahve, sestavy (automatiky s hadicemi), revize a servisy, závady a jejich řešení.
// Upozornění na termíny jsou jen tady – nepatří mezi upozornění k ponorům.
import { useEffect, useState } from "react";
import { gasColorOf, gasDisp } from "../app/gas";
import { GEAR_TANK_KINDS, REV_YEARS, SVC_YEARS, TWIN_VOLS, dueState, tankMix, gearKindVol, gearVol, nextDue, uid, type GearFault, type GearHose, type GearReg, type GearStage, type GearTank } from "../app/model";
import { deleteReg, deleteTank, ownMetas, saveReg, saveTank } from "../app/store";
import { RB_TOL, rbMatch } from "../app/gearSync";
import { isCC } from "../core/rig";
import { ask, askText as promptText } from "../app/dialog";
import { Card, go, num, tab, useStore } from "./common";

const GASES = ["AIR", "O₂", "EAN32", "EAN36", "EAN50", "TMX 21/35", "TMX 18/45", "TMX 15/55", "TMX 10/70", "Argon"];
const HOSE_TYPES: GearHose["type"][] = ["HP", "LP", "inflátor", "Swagelok"];
const fmtD = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }) : "–");
const fmtMs = (ms: number) => new Date(ms).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
const DUE_CLS = { over: "c-bad", soon: "c-warn", ok: "", none: "muted" } as const;
const lvlBar = (b?: number) => (b == null ? "muted" : b < 50 ? "c-bad" : b < 100 ? "c-warn" : "");
export const tankLabel = (t: GearTank) => t.name || (t.kind === "Dvojče" ? `Dvojče 2×${num(t.vol, 0)} l` : t.kind === "Jiná" ? `${num(t.vol, 1)} l` : t.kind);
const tankDue = (t: GearTank) => nextDue(t.revLast, t.revNext, t.revYears ?? REV_YEARS);
const stageDue = (s: GearStage) => nextDue(s.svcLast, s.svcNext, s.svcYears ?? SVC_YEARS);
const worst = (xs: ("over" | "soon" | "ok" | "none")[]) => (xs.includes("over") ? "over" : xs.includes("soon") ? "soon" : xs.includes("ok") ? "ok" : "none");

export function GearScreen({ sub = "home", id }: { sub?: "home" | "tanks" | "regs"; id?: string }) {
  return (
    <div className="screen">
      <div className="seg bl">
        <button className={sub === "home" ? "on" : ""} onClick={() => tab({ t: "gear", sub: "home" })}>Přehled</button>
        <button className={sub === "tanks" ? "on" : ""} onClick={() => tab({ t: "gear", sub: "tanks" })}>Láhve</button>
        <button className={sub === "regs" ? "on" : ""} onClick={() => tab({ t: "gear", sub: "regs" })}>Automatiky</button>
      </div>
      {sub === "home" ? <GearHome /> : sub === "tanks" ? <TankList open={id} /> : <RegList open={id} />}
    </div>
  );
}

// ---------- Přehled
type TSec = "onboard" | "stage" | "twin" | "mono" | "argon" | "fill";
const SECS: [TSec, string][] = [["onboard", "On-board"], ["stage", "Stage"], ["twin", "Twin"], ["mono", "Mono"], ["argon", "Argon"], ["fill", "Plnění"]];
const isArgon = (t: GearTank) => /^argon$/i.test(t.mix.trim());
export function tankSec(t: GearTank): TSec {
  if (t.use === "fill") return "fill";
  if (t.onboard) return "onboard";
  if (isArgon(t)) return "argon";
  if (t.kind === "Dvojče") return "twin";
  if (t.kind === "S80" || t.kind === "S40") return "stage";
  return "mono";
}
/** Stav lahve pro dlaždici: Prázdná / Revize (prošlá) červeně, Ověřit / Doplnit / Revize (brzy) žlutě, jinak OK. Plnicí lahve hlídají jen ověření a revizi. */
/** Stav lahve: barva a štítek = plnost (a ověření tlaku); revize zvlášť (fialový pruh na dlaždici). */
export function tankState(t: GearTank): { lvl: "ok" | "warn" | "bad" | "none"; label: string; rev: "over" | "soon" | null } {
  const ds = dueState(tankDue(t)), fill = t.use === "fill";
  const rev = ds === "over" || ds === "soon" ? ds : null;
  if (!fill && t.bar != null && t.bar < 50) return { lvl: "bad", label: "Prázdná", rev };
  if (t.check) return { lvl: "warn", label: "Ověřit", rev };
  if (!fill && t.bar != null && t.bar < 100) return { lvl: "warn", label: "Doplnit", rev };
  if (t.bar == null) return { lvl: "none", label: "Tlak?", rev };
  return { lvl: "ok", label: "OK", rev };
}

/** Pořadí plynů ve skupinách: vzduch, EAN (podle O₂), TMX (podle O₂ sestupně), O₂, argon, ostatní. */
function gasRank(mix: string): [number, number] {
  const m = tankMix(mix);
  if (/^argon$/i.test(mix.trim())) return [5, 0];
  if (!m) return [6, 0];
  const [o, h] = m.split("/").map(Number);
  if (o === 100) return [4, 0];
  if (h > 0) return [3, -o * 100 - h];
  if (o === 21) return [1, 0];
  return [2, o];
}
/** Skupiny lahví v sekci: On-board nejdřív O₂, pak diluenty podle plynu; ostatní podle plynu. Ve skupině od nejvyššího tlaku. */
export function tankGroups(list: GearTank[], sec: string): { key: string; label: string; tanks: GearTank[] }[] {
  const key = (t: GearTank) => (sec === "onboard" && t.onboard === "o2" ? "0|O₂" : `${gasRank(t.mix).join(",")}|${gasDisp(t.mix)}`);
  const map = new Map<string, GearTank[]>();
  for (const t of list) map.set(key(t), [...(map.get(key(t)) || []), t]);
  const rank = (k: string) => (k.startsWith("0|") ? [0, 0] : k.split("|")[0].split(",").map(Number));
  return [...map.entries()]
    .sort((a, b) => { const x = rank(a[0]), y = rank(b[0]); return x[0] - y[0] || x[1] - y[1]; })
    .map(([k, ts]) => ({ key: k, label: gasDisp(k.split("|")[1]), tanks: ts.sort((a, b) => (b.bar ?? -1) - (a.bar ?? -1) || tankLabel(a).localeCompare(tankLabel(b), "cs", { numeric: true })) }));
}

function TankTile({ t }: { t: GearTank }) {
  const s = tankState(t);
  return (
    <div className={"celltile tanktile " + s.lvl} onClick={() => tab({ t: "gear", sub: "tanks", id: t.id })}>
      <div className="ct-h"><b>{tankLabel(t)}</b><span className={"dot " + s.lvl} /></div>
      <div className="ct-sub tt-mix" style={{ color: gasColorOf(t.mix) || undefined }}>{gasDisp(t.mix)}</div>
      <div className="ct-v">{t.bar != null ? t.bar : "–"}<small>bar</small></div>
      <div className={"ct-l " + s.lvl}>{s.label}</div>
      {s.rev && <div className={"tt-rev " + s.rev}><span>Revize {s.rev === "over" ? "po termínu" : fmtD(tankDue(t))}</span></div>}
    </div>
  );
}

/** Přidání on-board lahve (RB O2 / RB DIL); onlyMissing = jen chybějící druh (Přehled). */
function RbAdd({ all, onlyMissing }: { all: GearTank[]; onlyMissing?: boolean }) {
  const hasO2 = all.some((t) => t.onboard === "o2"), hasDil = all.some((t) => t.onboard === "dil");
  if (onlyMissing && hasO2 && hasDil) return null;
  return (
    <span className="row">
      {(!onlyMissing || !hasO2) && <button className="btn small" onClick={() => saveTank({ kind: "3 l", vol: 3, mix: "O₂", onboard: "o2" })}>＋ RB O2</button>}
      {(!onlyMissing || !hasDil) && <button className="btn small" onClick={() => saveTank({ kind: "3 l", vol: 3, mix: all.find((t) => t.onboard === "dil")?.mix || "AIR", onboard: "dil" })}>＋ RB DIL</button>}
    </span>
  );
}

function GearHome() {
  const st = useStore();
  const all = Object.values(st.lb.tanks || {}).sort((a, b) => tankLabel(a).localeCompare(tankLabel(b), "cs", { numeric: true }));
  const regs = Object.values(st.lb.regs || {}).sort((a, b) => a.name.localeCompare(b.name, "cs"));
  const cc = ownMetas().filter((m) => isCC(m.h));
  const last = cc[cc.length - 1];
  const rb = last ? st.lb.notes[last.id]?.rb : undefined;
  const unassigned = (["o2", "dil"] as const).filter((g) => last && all.some((t) => t.onboard === g) && !rb?.[g]);
  return (<>
    {SECS.map(([k, label]) => {
      const list = all.filter((t) => tankSec(t) === k);
      if (!list.length && k !== "onboard") return null;
      return (
        <section key={k} className="card">
          <div className="card-h"><h2>{label}</h2>{k === "onboard" && <RbAdd all={all} onlyMissing />}</div>
          {list.length ? tankGroups(list, k).map((g) => (
            <div key={g.key} className="tgroup">
              {tankGroups(list, k).length > 1 && <div className="tg-l" style={{ color: gasColorOf(g.label) || undefined }}>{g.label}</div>}
              <div className="cells">{g.tanks.map((t) => <TankTile key={t.id} t={t} />)}</div>
            </div>
          )) : <p className="muted small">Zatím žádné lahve rebreatheru.</p>}
          {k === "onboard" && unassigned.map((g) => (
            <div key={g} className="reason warn link" onClick={() => go({ t: "dive", id: last!.id })}>Ponor {fmtMs(last!.start * 1000)}: nepřiřazená lahev {g === "o2" ? "O₂" : "diluentu"} ({rbMatch(st.lb, last!, g).why}) – vyber ji v detailu ponoru v „Před a po ponoru“ ›</div>
          ))}
          {k === "onboard" && <p className="note">Po ponoru myX rozpozná lahev v rebreatheru (diluent podle směsi, pak tlaku ±{RB_TOL} bar; O₂ podle tlaku) a převezme tlak na konci. Zavřená lahev se nepřepíše – „Ověřit“.</p>}
        </section>
      );
    })}
    <div className="row"><button className="btn" onClick={() => tab({ t: "gear", sub: "tanks" })}>Láhve ›</button></div>
    {regs.map((r) => <RegPanel key={r.id} r={r} />)}
    {!regs.length && <Card title="Sestavy"><p className="muted">Zatím žádné sestavy. Přidej automatiky v Automatiky.</p><button className="btn" onClick={() => tab({ t: "gear", sub: "regs" })}>Automatiky ›</button></Card>}
    <p className="note">Dlaždice: OK, Doplnit (pod 100 bar), Prázdná (pod 50 bar), Ověřit (tlak se po ponoru nepřepsal), Revize (30 dní předem žlutě, po termínu červeně). Upozornění na revize a servisy jsou jen tady ve Výstroji.</p>
  </>);
}

function RegPanel({ r }: { r: GearReg }) {
  const open = r.faults.filter((f) => !f.fix);
  const d1 = stageDue(r.s1), d2 = stageDue(r.s2);
  const due = worst([dueState(d1), dueState(d2)]);
  return (
    <Card title={r.name} right={<span>{r.o2 ? <span className="pill info">O₂ čisté</span> : null}{open.length ? <span className="pill bad">závady {open.length}</span> : <span className={"pill " + (due === "over" ? "bad" : due === "soon" ? "warn" : "ok")}>{due === "over" ? "Servis prošlý" : due === "soon" ? "Servis brzy" : "V pořádku"}</span>}</span>}>
      <div className="gear-row"><span>1. stupeň{r.s1.model ? ` · ${r.s1.model}` : ""}</span><small className={DUE_CLS[dueState(d1)]}>servis {fmtD(d1)}</small></div>
      <div className="gear-row"><span>2. stupeň{r.s2.model ? ` · ${r.s2.model}` : ""}</span><small className={DUE_CLS[dueState(d2)]}>servis {fmtD(d2)}</small></div>
      <div className="gear-row"><span>Hadice</span><small className="muted">{r.hoses.length ? r.hoses.map((h) => `${h.type}${h.len ? ` ${h.len} cm` : ""}`).join(", ") : "žádné"}</small></div>
      {open.map((f) => <div key={f.id} className="reason warn">{fmtMs(f.at)}: {f.text}</div>)}
      <div className="row">
        <button className="btn small" onClick={() => addFault(r)}>Zapsat závadu</button>
        <button className="btn small" onClick={() => tab({ t: "gear", sub: "regs", id: r.id })}>Detail ›</button>
      </div>
    </Card>
  );
}

async function addFault(r: GearReg) {
  const text = await promptText(`Závada – ${r.name} (zjištěná po posledním ponoru):`, "");
  if (!text?.trim()) return;
  const last = ownMetas()[ownMetas().length - 1];
  const f: GearFault = { id: uid(), at: Date.now(), text: text.trim(), diveId: last?.id };
  await saveReg({ ...r, faults: [...r.faults, f] });
}

// ---------- Láhve
function TankList({ open }: { open?: string }) {
  const st = useStore();
  const [edit, setEdit] = useState<string | null>(open || null);
  useEffect(() => { if (open && open !== "new") setTimeout(() => document.getElementById("tank-" + open)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }, [open]);
  const tanks = Object.values(st.lb.tanks || {}).sort((a, b) => tankLabel(a).localeCompare(tankLabel(b), "cs", { numeric: true }));
  return (<>
    {SECS.map(([k, label]) => {
      const list = tanks.filter((t) => tankSec(t) === k);
      if (!list.length && k !== "onboard") return null;
      return (
        <div key={k} className="tsec">
          <div className="tsec-h"><h3 className="subh">{label}</h3>{k === "onboard" && <RbAdd all={tanks} />}</div>
          {tankGroups(list, k).map((g) => g.tanks.map((t) => <TankCard key={t.id} t={t} edit={edit === t.id} setEdit={(v) => setEdit(v ? t.id : null)} />))}
        </div>
      );
    })}
    {edit === "new" ? <Card title="Nová lahev"><TankForm init={{ kind: "S80", vol: 11.1, mix: "AIR" }} onDone={() => setEdit(null)} /></Card>
      : <button className="btn primary" onClick={() => setEdit("new")}>＋ Přidat lahev</button>}
    <p className="note">Dvojče = 2 ocelové lahve jako jedna lahev. Revize se dopočítá z poslední ({REV_YEARS} let), termín i interval jde změnit.</p>
  </>);
}

function TankCard({ t, edit, setEdit }: { t: GearTank; edit: boolean; setEdit: (v: boolean) => void }) {
  const due = tankDue(t), ds = dueState(due);
  const [bar, setBar] = useState(t.bar != null ? String(t.bar) : "");
  const saveBar = () => { const n = Math.round(+bar.replace(",", ".")); if (bar.trim() && n >= 0 && n < 400 && (n !== t.bar || t.check)) saveTank({ ...t, bar: n, barAt: Date.now(), check: undefined }); };
  return (
    <section className="card gear-tank" id={"tank-" + t.id}>
      <div className="card-h"><h2 className="gear-name">{tankLabel(t)}</h2><span>{t.o2 ? <span className="pill info">O₂ čisté</span> : null}{t.onboard ? <span className="pill">on-board {t.onboard === "o2" ? "O₂" : "dil"}</span> : null}</span></div>
      <div className="gear-big">
        <span className="gear-mix" style={{ color: gasColorOf(t.mix) || undefined }}>{gasDisp(t.mix)}</span>
        <span className="gear-bar"><input className={"bar-in " + lvlBar(t.bar)} type="number" inputMode="numeric" value={bar} placeholder="bar" onChange={(e) => setBar(e.target.value)} onBlur={saveBar} /> bar</span>
      </div>
      {t.check && <div className="reason warn">Ověřit tlak: {t.check.text}. <button className="btn small" onClick={() => saveTank({ ...t, check: undefined, barAt: Date.now() })}>Tlak sedí</button></div>}
      <small className="muted">{num(gearVol(t), 1)} l{t.use === "fill" ? " · plnění" : ""}{t.barAt ? ` · tlak z ${fmtMs(t.barAt)}` : ""} · revize <span className={DUE_CLS[ds]}>{fmtD(due)}</span>{t.revLast ? ` (poslední ${fmtD(t.revLast)})` : ""}</small>
      {t.note && <p className="small">{t.note}</p>}
      <button className="ev-head" onClick={() => setEdit(!edit)}>{edit ? "▾" : "▸"} Upravit</button>
      {edit && <TankForm init={t} onDone={() => setEdit(false)} />}
    </section>
  );
}

function TankForm({ init, onDone }: { init: Partial<GearTank> & { kind: string; vol: number; mix: string }; onDone: () => void }) {
  const [f, setF] = useState({ ...init, mix: gasDisp(init.mix) });
  const set = (p: Partial<GearTank>) => setF({ ...f, ...p });
  const customMix = !GASES.includes(f.mix);
  return (
    <div className="gear-form">
      <label>Lahev<select value={f.kind} onChange={(e) => { const k = e.target.value; set({ kind: k, vol: gearKindVol(k) ?? f.vol }); }}>{GEAR_TANK_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
      {f.kind === "Dvojče" && <label>Objem jedné lahve<select value={f.vol} onChange={(e) => set({ vol: +e.target.value })}>{TWIN_VOLS.map((v) => <option key={v} value={v}>{v} l</option>)}</select></label>}
      {f.kind === "Jiná" && <label>Objem (l)<input inputMode="decimal" defaultValue={f.vol} onBlur={(e) => { const v = parseFloat(e.target.value.replace(",", ".")); if (v > 0) set({ vol: v }); }} /></label>}
      <label>Název (nepovinný)<input defaultValue={f.name || ""} placeholder="např. Stage 1, BO" onBlur={(e) => set({ name: e.target.value.trim() || undefined })} /></label>
      <label>Směs<select value={customMix ? "_" : f.mix} onChange={(e) => set({ mix: e.target.value === "_" ? "" : e.target.value })}>{GASES.map((g) => <option key={g}>{g}</option>)}<option value="_">Jiná</option></select></label>
      {customMix && <label>Směs (např. TMX 18/45)<input defaultValue={f.mix} onBlur={(e) => set({ mix: e.target.value.trim() })} /></label>}
      <label>Poslední revize<input type="date" value={f.revLast || ""} onChange={(e) => set({ revLast: e.target.value || undefined })} /></label>
      <label>Interval revize (roky)<input inputMode="numeric" defaultValue={f.revYears ?? REV_YEARS} onBlur={(e) => { const v = Math.round(+e.target.value); if (v > 0) set({ revYears: v }); }} /></label>
      <label>Příští revize (jinak dopočítaná: {fmtD(nextDue(f.revLast, undefined, f.revYears ?? REV_YEARS))})<input type="date" value={f.revNext || ""} onChange={(e) => set({ revNext: e.target.value || undefined })} /></label>
      <label className="small inline gear-chk"><input type="checkbox" checked={!!f.o2} onChange={(e) => set({ o2: e.target.checked })} />O₂ čisté</label>
      <label>Účel<select value={f.use || ""} onChange={(e) => set({ use: (e.target.value || undefined) as GearTank["use"] })}><option value="">běžná lahev</option><option value="fill">Plnění (přepouštění plynu)</option></select></label>
      <label>On-board lahev rebreatheru<select value={f.onboard || ""} onChange={(e) => set({ onboard: (e.target.value || undefined) as GearTank["onboard"] })}><option value="">ne</option><option value="o2">O₂</option><option value="dil">diluent</option></select></label>
      <label>Poznámka<input defaultValue={f.note || ""} onBlur={(e) => set({ note: e.target.value.trim() || undefined })} /></label>
      <div className="row">
        <button className="btn primary" onClick={async () => { if (!f.mix) return; await saveTank(f); onDone(); }}>Uložit</button>
        <button className="btn" onClick={onDone}>Zrušit</button>
        {f.id && <button className="btn danger" onClick={async () => { if (await ask(`Smazat lahev ${tankLabel(f as GearTank)}?`, { danger: true, ok: "Smazat" })) { await deleteTank(f.id!); onDone(); } }}>Smazat</button>}
      </div>
    </div>
  );
}

// ---------- Automatiky (sestavy)
function RegList({ open }: { open?: string }) {
  const st = useStore();
  const [edit, setEdit] = useState<string | null>(open || null);
  const regs = Object.values(st.lb.regs || {}).sort((a, b) => a.name.localeCompare(b.name, "cs"));
  return (<>
    {regs.map((r) => <RegCard key={r.id} r={r} open={edit === r.id} setOpen={(v) => setEdit(v ? r.id : null)} />)}
    <button className="btn primary" onClick={async () => { const name = await promptText("Název sestavy (např. Rekre 1, Tech 1 L, Stage 1):", ""); if (name?.trim()) await saveReg({ name: name.trim() }); }}>＋ Přidat automatiku</button>
    <p className="note">Sestava = automatika: 1. a 2. stupeň (servis se dopočítá z posledního, {SVC_YEARS} roky) a hadice. Závady po ponoru a jejich řešení se ukládají do historie.</p>
  </>);
}

function StageForm({ label, s, set }: { label: string; s: GearStage; set: (s: GearStage) => void }) {
  const due = stageDue(s);
  return (
    <div className="gear-form">
      <h3 className="subh">{label} <small className={DUE_CLS[dueState(due)]}>servis {fmtD(due)}</small></h3>
      <label>Model<input defaultValue={s.model || ""} onBlur={(e) => set({ ...s, model: e.target.value.trim() || undefined })} /></label>
      <label>Poslední servis<input type="date" value={s.svcLast || ""} onChange={(e) => set({ ...s, svcLast: e.target.value || undefined })} /></label>
      <label>Interval (roky)<input inputMode="numeric" defaultValue={s.svcYears ?? SVC_YEARS} onBlur={(e) => { const v = Math.round(+e.target.value); if (v > 0) set({ ...s, svcYears: v }); }} /></label>
      <label>Příští servis (jinak dopočítaný)<input type="date" value={s.svcNext || ""} onChange={(e) => set({ ...s, svcNext: e.target.value || undefined })} /></label>
    </div>
  );
}

function RegCard({ r, open, setOpen }: { r: GearReg; open: boolean; setOpen: (v: boolean) => void }) {
  const up = (p: Partial<GearReg>) => saveReg({ ...r, ...p });
  const openF = r.faults.filter((f) => !f.fix);
  return (
    <section className="card">
      <div className="card-h" onClick={() => setOpen(!open)}><h2>{open ? "▾" : "▸"} {r.name}</h2><span>{r.o2 ? <span className="pill info">O₂ čisté</span> : null}{openF.length ? <span className="pill bad">závady {openF.length}</span> : null}</span></div>
      {!open && <small className="muted">1. st. servis {fmtD(stageDue(r.s1))} · 2. st. servis {fmtD(stageDue(r.s2))} · hadic {r.hoses.length}</small>}
      {open && <>
        <label>Název<input defaultValue={r.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.name && up({ name: e.target.value.trim() })} /></label>
        <label className="small inline gear-chk"><input type="checkbox" checked={!!r.o2} onChange={(e) => up({ o2: e.target.checked })} />O₂ čistá</label>
        <StageForm label="1. stupeň" s={r.s1} set={(s1) => up({ s1 })} />
        <StageForm label="2. stupeň" s={r.s2} set={(s2) => up({ s2 })} />
        <h3 className="subh">Hadice</h3>
        {r.hoses.map((h) => (
          <div key={h.id} className="gear-hose">
            <select value={h.type} onChange={(e) => up({ hoses: r.hoses.map((x) => (x.id === h.id ? { ...x, type: e.target.value as GearHose["type"] } : x)) })}>{HOSE_TYPES.map((x) => <option key={x}>{x}</option>)}</select>
            <input className="num-s" inputMode="numeric" defaultValue={h.len ?? ""} placeholder="cm" onBlur={(e) => { const v = Math.round(+e.target.value); up({ hoses: r.hoses.map((x) => (x.id === h.id ? { ...x, len: v > 0 ? v : undefined } : x)) }); }} /><span className="small">cm</span>
            <label className="small inline"><input type="checkbox" checked={!!h.o2} onChange={(e) => up({ hoses: r.hoses.map((x) => (x.id === h.id ? { ...x, o2: e.target.checked } : x)) })} />O₂ čistá</label>
            <button className="btn small" aria-label="Odebrat" onClick={() => up({ hoses: r.hoses.filter((x) => x.id !== h.id) })}>✕</button>
          </div>
        ))}
        <button className="btn small" onClick={() => up({ hoses: [...r.hoses, { id: uid(), type: "LP" }] })}>＋ Přidat hadici</button>
        <h3 className="subh">Závady a jejich řešení</h3>
        {!r.faults.length && <p className="muted small">Bez závad.</p>}
        {[...r.faults].sort((a, b) => b.at - a.at).map((f) => <FaultRow key={f.id} f={f} set={(nf) => up({ faults: r.faults.map((x) => (x.id === f.id ? nf : x)) })} del={() => up({ faults: r.faults.filter((x) => x.id !== f.id) })} />)}
        <div className="row">
          <button className="btn small" onClick={() => addFault(r)}>Zapsat závadu</button>
          <button className="btn small danger" onClick={async () => { if (await ask(`Smazat sestavu ${r.name}?`, { danger: true, ok: "Smazat" })) await deleteReg(r.id); }}>Smazat sestavu</button>
        </div>
      </>}
    </section>
  );
}

function FaultRow({ f, set, del }: { f: GearFault; set: (f: GearFault) => void; del: () => void }) {
  const resolve = async (kind: "oprava" | "výměna") => {
    const text = await promptText(kind === "oprava" ? "Co se opravilo?" : "Co se vyměnilo?", "");
    if (text == null) return;
    set({ ...f, fix: { at: Date.now(), kind, text: text.trim() || undefined } });
  };
  return (
    <div className={"fault " + (f.fix ? "fixed" : "open")}>
      <div><b>{fmtMs(f.at)}</b> {f.text}</div>
      {f.fix ? <small className="c-ok">✓ {f.fix.kind} {fmtMs(f.fix.at)}{f.fix.text ? ` – ${f.fix.text}` : ""} <span className="link" onClick={() => set({ ...f, fix: undefined })}>zrušit</span></small>
        : <div className="row"><button className="btn small" onClick={() => resolve("oprava")}>Opraveno</button><button className="btn small" onClick={() => resolve("výměna")}>Vyměněno</button><button className="btn small" aria-label="Smazat" onClick={del}>✕</button></div>}
    </div>
  );
}
