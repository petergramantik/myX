import { useEffect, useState } from "react";
import { cellStatus, detectCellEvents, type CellStatus } from "../core/cells";
import { addPhoto, answerCellPrompt, deleteCell, localNow, photoUrl, saveCell, toast } from "../app/store";
import type { Cell, Meta } from "../app/model";
import { Card, fmtDate, go, num, useStore } from "./common";
import { LineChart } from "./Chart";

const DAY = 86400;
const isoOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const tsOf = (iso: string) => Date.parse(iso + "T12:00:00Z") / 1000;
const monthsSince = (iso: string | undefined, now: number) => (iso ? (now - tsOf(iso)) / (30.44 * DAY) : null);
export const fmtIso = (iso?: string) => (iso ? fmtDate(tsOf(iso)) : "–");

export interface Prompt { key: string; pos: number; meta: Meta; prev: Meta; myNo: number; tentative?: boolean }

export function useCells() {
  const st = useStore();
  const now = localNow();
  const th = st.lb.settings.th;
  const ccr = st.metas.map((m, i) => ({ m, i })).filter(({ m }) => m.cells && m.cells.mvBar.some((x) => x != null));
  const series = ccr.map(({ m }) => m.cells);
  const events = detectCellEvents(series);
  const cells = Object.values(st.lb.cells);
  const current = (pos: number): Cell | undefined =>
    cells.filter((c) => c.pos === pos && !c.removed).sort((a, b) => b.installed.localeCompare(a.installed))[0];
  const lastMeta = ccr[ccr.length - 1]?.m;
  /** Pozice je prázdná: poslední čidlo vyjmuto po posledním ponoru a nové nezadané. */
  const empty = (pos: number): Cell | undefined => {
    if (current(pos)) return undefined;
    const lastRec = cells.filter((c) => c.pos === pos).sort((a, b) => (b.removed || "").localeCompare(a.removed || ""))[0];
    return lastRec?.removed && (!lastMeta || lastRec.removed >= isoOf(lastMeta.start)) ? lastRec : undefined;
  };
  const ref = lastMeta ? ccr.filter(({ m }) => m.start <= lastMeta.start - 30 * DAY && m.start >= lastMeta.start - 120 * DAY).map(({ m }) => m.cells) : [];
  const status: CellStatus[] = [0, 1, 2].map((k) => {
    if (empty(k + 1)) return { level: "info", reasons: ["Pozice prázdná – vlož čidlo"] };
    const c = current(k + 1);
    return cellStatus(k, series.slice(-5), th, monthsSince(c?.installed, now), monthsSince(c?.made, now), c?.lifeM ?? null, ref);
  });
  const lastCalEv = [...events].reverse().find((e) => e.kind === "cal" || e.kind === "change");
  const lastCal = lastCalEv ? ccr[lastCalEv.index].m : null;
  const changes: Prompt[] = [];
  for (const ev of events) {
    if (ev.kind !== "change") continue;
    const meta = ccr[ev.index].m, prev = ccr[ev.index - 1].m;
    for (const pos of ev.pos) changes.push({ key: `${pos}:${meta.id}`, pos, meta, prev, myNo: ccr[ev.index].i + 1, tentative: ev.tentative });
  }
  const prompts = changes.filter((p) => {
    if (st.lb.answered[p.key]) return false;
    const lo = isoOf(p.prev.start), hi = isoOf(p.meta.start);
    return !cells.some((c) => c.pos === p.pos && c.installed >= lo && c.installed <= hi);
  });
  return { ccr, series, events, current, empty, status, lastCal, lastCalNo: lastCalEv ? ccr[lastCalEv.index].i + 1 : null, prompts, changes, now, cells, answered: st.lb.answered };
}

/** Kontrola data výměny proti logu: najde nejbližší zjištěnou výměnu na pozici a ověří, že datum leží mezi posledním ponorem se starým a prvním s novým čidlem. */
export function checkInstallDate(c: ReturnType<typeof useCells>, pos: number, iso: string): { msg: string; fix: string } | null {
  if (!iso) return null;
  const t = tsOf(iso);
  const cand = c.changes.filter((p) => p.pos === pos && c.answered[p.key]?.answer !== "cal")
    .map((p) => ({ p, d: Math.min(Math.abs(t - p.meta.start), Math.abs(t - p.prev.start)) }))
    .filter((x) => x.d <= 120 * DAY).sort((a, b) => a.d - b.d)[0];
  if (!cand) return null;
  const { p } = cand;
  const lo = isoOf(p.prev.start), hi = isoOf(p.meta.start);
  if (iso > hi) return { msg: `Podle logu bylo nové čidlo v rebreatheru už při ponoru č. ${p.myNo} (${fmtIso(hi)}). Výměna proběhla mezi ${fmtIso(lo)} a ${fmtIso(hi)}.`, fix: hi };
  if (iso < lo) return { msg: `Podle logu bylo staré čidlo ještě při ponoru č. ${p.myNo - 1} (${fmtIso(lo)}). Výměna proběhla mezi ${fmtIso(lo)} a ${fmtIso(hi)}.`, fix: hi };
  return null;
}

const LV: Record<string, string> = { ok: "V pořádku", info: "Pozor", warn: "Varování", bad: "Vyměnit" };
const ORDER = ["ok", "info", "warn", "bad"];
const K_OPEN = "myx.cellpanel";

export function CellTiles() {
  const c = useCells();
  if (!c.ccr.length) return null;
  const last = c.series[c.series.length - 1];
  return (
    <>
      <div className="cells">
        {[1, 2, 3].map((pos) => {
          const cell = c.current(pos), s = c.status[pos - 1], mvb = last.mvBar[pos - 1];
          const age = monthsSince(cell?.installed, c.now);
          if (c.empty(pos)) return (
            <div key={pos} className="celltile info" onClick={() => go({ t: "cells", pos })}>
              <div className="ct-h"><b>Čidlo {pos}</b><span className="dot info" /></div>
              <div className="ct-v">–</div>
              <div className="ct-u">pozice prázdná</div>
              <div className="ct-rows"><div><span>Vyjmuto</span><b>{fmtIso(c.empty(pos)!.removed)}</b></div></div>
              <div className="ct-l info">Vlož čidlo</div>
            </div>
          );
          return (
            <div key={pos} className={"celltile " + s.level} onClick={() => go({ t: "cells", pos })}>
              <div className="ct-h"><b>Čidlo {pos}</b><span className={"dot " + s.level} /></div>
              <div className="ct-v">{mvb != null ? num(mvb * 0.21, 1) : "–"} <small>mV</small></div>
              <div className="ct-u">na vzduchu</div>
              <div className="ct-rows">
                <div><span>O₂ 1 bar</span><b>{mvb != null ? `${num(mvb, 0)} mV` : "–"}</b></div>
                <div><span>Výměna</span><b>{cell ? fmtIso(cell.installed) : "nezadaná"}</b></div>
                {age != null && <div><span>Stáří</span><b>{Math.floor(age)} / {cell?.lifeM || 12} měs.</b></div>}
              </div>
              {age != null && <div className="ct-bar"><i style={{ width: `${Math.min(100, (age / (cell?.lifeM || 12)) * 100)}%` }} /></div>}
              <div className={"ct-l " + s.level}>{LV[s.level]}</div>
            </div>
          );
        })}
      </div>
      <CellPanel c={c} />
    </>
  );
}

function CellPanel({ c }: { c: ReturnType<typeof useCells> }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(K_OPEN) === "1"; } catch { return false; } });
  const [form, setForm] = useState<Partial<Cell> | null>(null);
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(K_OPEN, v ? "1" : "0"); } catch { /* */ } };
  const worst = c.status.reduce((w, s) => (ORDER.indexOf(s.level) > ORDER.indexOf(w) ? s.level : w), "ok" as string);
  const problems = c.status.map((s, k) => ({ s, k })).filter(({ s }) => s.level !== "ok");
  const recentPrompts = c.prompts.filter((p) => c.now - p.meta.start < 400 * DAY);
  const summary = problems.length === 0 ? "✓ Čidla v pořádku"
    : problems.length === 1 ? `⚠ Čidlo ${problems[0].k + 1}: ${problems[0].s.reasons[0]?.startsWith("Pozice prázdná") ? "prázdná pozice" : LV[problems[0].s.level].toLowerCase()}`
    : `⚠ ${problems.length} čidla s upozorněním`;
  const cal = c.lastCal ? `kalibrace ${fmtDate(c.lastCal.start)} (před ${Math.floor((c.now - c.lastCal.start) / DAY)} dny)` : "kalibrace nezjištěna";
  return (
    <section className={"panel " + worst}>
      <button className="panel-h" onClick={toggle}>
        <span className="ph-main">{summary}{recentPrompts.length ? ` · ${recentPrompts.length} ${recentPrompts.length === 1 ? "dotaz" : "dotazy"} na výměnu` : ""}</span>
        <span className="ph-sub">{cal}</span>
        <span className="ph-arrow">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="panel-b">
          {[1, 2, 3].map((pos) => {
            const s = c.status[pos - 1], cur = c.current(pos), emp = c.empty(pos);
            return (
              <div key={pos} className="pcell">
                <div className="pcell-h"><b>Čidlo {pos}</b><span className={"pill " + s.level}>{emp ? "Prázdná" : LV[s.level]}</span></div>
                <div className="pcell-row">
                  <Photo ids={(cur || emp)?.photos} />
                  <div className="pcell-info">
                    {cur ? <>
                      <div>{cur.maker || "Čidlo"}{cur.type ? ` ${cur.type}` : ""}{cur.sn ? ` · S/N ${cur.sn}` : ""}</div>
                      <small>výměna {fmtIso(cur.installed)}{cur.made ? ` · výroba ${fmtIso(cur.made)}` : ""} · životnost {cur.lifeM} měs.</small>
                    </> : emp ? <small>Vyjmuto {fmtIso(emp.removed)} ({emp.maker || "čidlo"}{emp.sn ? ` S/N ${emp.sn}` : ""}). Nové čidlo zadej při vložení.</small>
                      : <small>Čidlo na této pozici zatím není zadané.</small>}
                    {s.level === "ok" ? <div className="reason ok">✓ v pořádku</div> : s.reasons.filter((r) => !r.startsWith("Pozice prázdná")).map((r, i) => <div key={i} className={"reason " + s.level}>{r}</div>)}
                  </div>
                </div>
                <div className="row">
                  <button className="btn" onClick={() => setForm({ pos: pos as 1 | 2 | 3, installed: isoOf(c.now), lifeM: 12, maker: cur?.maker || emp?.maker || "" })}>{cur ? "Zadat výměnu" : "Zadat čidlo"}</button>
                  {cur && <button className="btn" onClick={() => setForm({ ...cur })}>Upravit</button>}
                  {cur && <button className="btn" onClick={() => setForm({ ...cur, removed: isoOf(c.now) })}>Vyjmout</button>}
                </div>
                {form && form.pos === pos && <CellForm init={form} c={c} onDone={() => setForm(null)} />}
              </div>
            );
          })}
          {recentPrompts.map((p) => <CellPrompt key={p.key} p={p} onYes={() => setForm({ pos: p.pos as 1 | 2 | 3, installed: isoOf(p.meta.start), lifeM: 12, maker: c.current(p.pos)?.maker || "" })} />)}
          <p className="note">Poslední kalibrace: {c.lastCal ? <>před ponorem č. {c.lastCalNo} ({fmtDate(c.lastCal.start)})</> : "nezjištěno"}. Odvozeno ze změny kalibračních faktorů v logu. <a onClick={() => go({ t: "cells" })}>Historie a grafy čidel ›</a></p>
        </div>
      )}
    </section>
  );
}

function Photo({ ids, big }: { ids?: string[]; big?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const id = ids?.[ids.length - 1];
  useEffect(() => { setUrl(null); if (id) photoUrl(id).then(setUrl); }, [id]);
  if (!id) return big ? null : <div className="thumb empty">bez fotky</div>;
  return (
    <>
      {url ? <img className={big ? "thumb big" : "thumb"} src={url} alt="Fotka čidla" onClick={(e) => { e.stopPropagation(); setZoom(true); }} /> : <div className="thumb empty">načítám…</div>}
      {zoom && url && <div className="zoom" onClick={() => setZoom(false)}><img src={url} alt="Fotka čidla" /></div>}
    </>
  );
}

function CellPrompt({ p, onYes }: { p: Prompt; onYes?: () => void }) {
  return (
    <div className="alert info">
      <b>Čidlo {p.pos}: změna citlivosti{p.tentative ? " (zatím nepotvrzená)" : ""}</b>
      <div>Mezi ponory č. {p.myNo - 1} ({fmtDate(p.prev.start)}) a č. {p.myNo} ({fmtDate(p.meta.start)}) vyskočila citlivost. Vyměnil jsi čidlo?</div>
      <div className="row">
        <button className="btn" onClick={() => (onYes ? onYes() : go({ t: "cells", pos: p.pos, install: isoOf(p.meta.start) }))}>Ano, zadat čidlo</button>
        <button className="btn" onClick={() => answerCellPrompt(p.key, "cal")}>Ne, jen kalibrace</button>
      </div>
    </div>
  );
}

export function CellsScreen({ pos, install }: { pos?: number; install?: string }) {
  const c = useCells();
  const st = useStore();
  return (
    <div className="screen">
      {c.prompts.filter((p) => !pos || p.pos === pos).map((p) => <CellPrompt key={p.key} p={p} />)}
      {[1, 2, 3].filter((x) => !pos || x === pos).map((p) => <CellPosition key={p} pos={p as 1 | 2 | 3} c={c} metas={st.metas} install={p === pos ? install : undefined} />)}
      {pos && <button className="btn" onClick={() => go({ t: "cells" })}>Zobrazit všechny pozice</button>}
      <Card title="Jak se stav čidla počítá">
        <ul className="small">
          <li>Citlivost v mV/bar = mV čidla ÷ pO₂ podle řídicí jednotky, medián přes ponor. Ekvivalent na vzduchu = × 0,21.</li>
          <li>Zdravé čidlo dává na vzduchu zhruba 8–13 mV. Pod {st.lb.settings.th.cellAirWarn} mV varování, pod {st.lb.settings.th.cellAirBad} mV výměna.</li>
          <li>Current limiting: čidlo při pO₂ nad 1,15 bar ukazuje vůči průměru méně než při 0,5–1,0 bar (pod {st.lb.settings.th.cellLinWarn} = podezření).</li>
          <li>Stáří: varování po životnosti čidla (výchozí {st.lb.settings.th.cellLifeM} měsíců), výměna po {st.lb.settings.th.cellMaxM} měsících od instalace nebo výroby.</li>
          <li>Výměna se pozná podle skoku citlivosti nahoru o 10 % a víc, kalibrace podle malého posunu u aspoň dvou čidel.</li>
        </ul>
      </Card>
    </div>
  );
}

function CellPosition({ pos, c, metas, install }: { pos: 1 | 2 | 3; c: ReturnType<typeof useCells>; metas: Meta[]; install?: string }) {
  const cur = c.current(pos);
  const [edit, setEdit] = useState<Partial<Cell> | null>(install ? { pos, installed: install, lifeM: 12, maker: cur?.maker || "" } : null);
  const hist = c.cells.filter((x) => x.pos === pos).sort((a, b) => b.installed.localeCompare(a.installed));
  const s = c.status[pos - 1];
  const xs = c.ccr.map(({ i }) => i + 1);
  const ys = c.ccr.map(({ m }) => m.cells.mvBar[pos - 1]);
  const lin = c.ccr.map(({ m }) => m.cells.lin[pos - 1]);
  const marks = hist.map((h) => { const t = tsOf(h.installed); const j = c.ccr.findIndex(({ m }) => m.start >= t); return j >= 0 ? xs[j] - 0.5 : null; }).filter((x): x is number => x != null);
  const proposed = c.prompts.find((p) => p.pos === pos);
  return (
    <Card title={`Pozice ${pos}`} right={<span className={"pill " + s.level}>{LV[s.level]}</span>}>
      {s.reasons.map((r, i) => <div key={i} className={"reason " + s.level}>{r}</div>)}
      {cur ? (
        <p><b>{cur.maker || "Čidlo"}{cur.type ? ` ${cur.type}` : ""}</b> · instalace {fmtIso(cur.installed)}{cur.sn ? ` · S/N ${cur.sn}` : ""}{cur.made ? ` · výroba ${fmtIso(cur.made)}` : ""} · životnost {cur.lifeM} měs.</p>
      ) : <p className="muted">Pro tuto pozici zatím nemáš zadané čidlo.</p>}
      {xs.length > 1 && (
        <LineChart t={xs} height={150} xFmt={(v) => String(Math.round(v))} xTitle={(v) => `Ponor ${v} (${fmtDate(metas[v - 1].start)})`} markers={marks}
          series={[{ label: "mV/bar", color: "#4fc3f7", values: ys, unit: "mV/bar", width: 2 }]}
          extra={[{ label: "Na vzduchu", values: ys.map((y) => (y != null ? +(y * 0.21).toFixed(1) : null)), unit: "mV" }, { label: "Linearita", values: lin }]} />
      )}
      <div className="row">
        <button className="btn primary" onClick={() => setEdit({ pos, installed: proposed ? isoOf(proposed.meta.start) : isoOf(c.now), lifeM: 12, maker: cur?.maker || "" })}>Vyměnit / zadat čidlo</button>
        {cur && <button className="btn" onClick={() => setEdit({ ...cur })}>Upravit</button>}
      </div>
      {edit && <CellForm init={edit} c={c} onDone={() => setEdit(null)} />}
      {(cur?.photos?.length || 0) > 0 && <div className="row"><Photo ids={cur!.photos} big /></div>}
      {hist.length > 0 && (
        <table className="kv"><thead><tr><th>Čidlo</th><th>Instalace → vyjmutí</th></tr></thead>
          <tbody>{hist.map((h) => (
            <tr key={h.id} onClick={() => setEdit({ ...h })}>
              <td>{h.maker || "?"}{h.type ? ` ${h.type}` : ""}{h.sn ? <><br /><small>S/N {h.sn}</small></> : null}{h.made ? <><br /><small>výroba {fmtIso(h.made)}</small></> : null}</td>
              <td>{fmtIso(h.installed)} → {h.removed ? fmtIso(h.removed) : "dosud"}{h.reason ? <><br /><small>{h.reason}</small></> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

const REASONS = ["Konec životnosti", "Nízké mV", "Current limiting", "Rotace", "Jiné"];

function CellForm({ init, c, onDone }: { init: Partial<Cell>; c: ReturnType<typeof useCells>; onDone: () => void }) {
  const [f, setF] = useState<Partial<Cell>>(init);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Cell, v: string | number | string[] | undefined) => setF({ ...f, [k]: v });
  const chk = f.pos && f.installed ? checkInstallDate(c, f.pos, f.installed) : null;
  return (
    <div className="form">
      <label>Výrobce a typ<div className="row"><input value={f.maker || ""} placeholder="např. Narked@90" onChange={(e) => set("maker", e.target.value)} /><input value={f.type || ""} placeholder="typ" onChange={(e) => set("type", e.target.value)} /></div></label>
      <label>Sériové číslo (S/N)<input value={f.sn || ""} placeholder="např. S01119633" onChange={(e) => set("sn", e.target.value)} /></label>
      <label>Datum výroby (ze štítku)<input type="date" value={f.made || ""} onChange={(e) => set("made", e.target.value || undefined)} /></label>
      <label>Datum výměny (vložení do rebreatheru)<input type="date" value={f.installed || ""} onChange={(e) => set("installed", e.target.value)} /></label>
      {chk && <div className="alert warn"><div>{chk.msg}</div><div className="row"><button className="btn" onClick={() => set("installed", chk.fix)}>Opravit na {fmtIso(chk.fix)}</button></div></div>}
      <label>Životnost (měsíce)<input inputMode="numeric" value={f.lifeM ?? 12} onChange={(e) => set("lifeM", parseInt(e.target.value) || 12)} /></label>
      {f.id && (
        <>
          <label>Vyjmuto<input type="date" value={f.removed || ""} onChange={(e) => set("removed", e.target.value || undefined)} /></label>
          <label>Důvod vyjmutí<select value={f.reason || ""} onChange={(e) => set("reason", e.target.value || undefined)}><option value="">–</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
        </>
      )}
      <label>Poznámka<input value={f.note || ""} onChange={(e) => set("note", e.target.value)} /></label>
      <label className="btn photo-btn">{busy ? "Zpracovávám fotku…" : `📷 ${f.photos?.length ? "Přidat další fotku" : "Vyfotit / vybrat fotku"}`}
        <input type="file" accept="image/*" hidden onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = "";
          if (!file) return;
          setBusy(true);
          try { const id = await addPhoto(file); setF((x) => ({ ...x, photos: [...(x.photos || []), id] })); } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
        }} />
      </label>
      {f.photos?.length ? <div className="row"><Photo ids={f.photos} /><small className="muted">{f.photos.length} fot.</small></div> : null}
      <div className="row">
        <button className="btn primary" disabled={!f.installed || busy} onClick={async () => { await saveCell(f as Cell); onDone(); }}>Uložit</button>
        <button className="btn" onClick={onDone}>Zrušit</button>
        {f.id && <button className="btn danger" onClick={async () => { if (confirm("Smazat záznam o čidle?")) { await deleteCell(f.id!); onDone(); } }}>Smazat</button>}
      </div>
    </div>
  );
}
