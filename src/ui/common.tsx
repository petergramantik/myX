import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getState, subscribe, type State } from "../app/store";
import { norm } from "../app/model";

export const useStore = (): State => useSyncExternalStore(subscribe, getState);

// ---------- navigace (zásobník obrazovek + tlačítko zpět v Androidu)
export type Screen =
  | { t: "home" } | { t: "dives"; site?: string; buddy?: string } | { t: "dive"; id: string }
  | { t: "sites" } | { t: "site"; id: string } | { t: "buddies" } | { t: "buddy"; id: string }
  | { t: "settings" } | { t: "about" } | { t: "draft"; id: string } | { t: "cells"; pos?: number; install?: string } | { t: "bats"; pos?: number } | { t: "warn" } | { t: "help" } | { t: "co2" } | { t: "cmp"; id: string; other: string } | { t: "hub"; sub?: "cmp" | "db"; who?: string };

let stack: Screen[] = [{ t: "home" }];
const navSubs = new Set<() => void>();
const emit = () => navSubs.forEach((f) => f());
export const useScreen = () => useSyncExternalStore((f) => { navSubs.add(f); return () => navSubs.delete(f); }, () => stack[stack.length - 1]);
/** Pozice stránky v okamžiku přechodu na další obrazovku (pro obnovení po návratu). */
export let leaveY = 0;
/** Hloubka našich záznamů v historii prohlížeče (1 = první). */
let curD = 1;
let pending: Screen[] | null = null;
let ignorePop = 0;
/** Vrstvy zavíratelné tlačítkem Zpět (záložka, zoom, nabídka, dialog) – poslední je nahoře. */
const layers: { id: number; close: () => void }[] = [];
let layerId = 0;
const setStack = (st: Screen[]) => { stack = st; emit(); window.scrollTo(0, 0); };
function applyTab(target: Screen[]) {
  stack = [target[0]]; history.replaceState({ d: 1 }, ""); curD = 1;
  if (target.length > 1) { stack = target; curD = 2; history.pushState({ d: 2 }, ""); }
  emit(); window.scrollTo(0, 0);
}
export function go(s: Screen) {
  leaveY = window.scrollY;
  layers.length = 0; // otevřené vrstvy s přechodem zanikají (jejich záznamy se při návratu přeskočí)
  curD++; history.pushState({ d: curD }, "");
  setStack([...stack, s]);
}
/** Hlavní záložka: Přehled je základ, ostatní nad ním – Zpět z nich vede na Přehled. */
export function tab(s: Screen) {
  leaveY = window.scrollY;
  layers.length = 0;
  const target: Screen[] = s.t === "home" ? [s] : [{ t: "home" }, s];
  if (curD > 1) { pending = target; history.go(-(curD - 1)); return; }
  applyTab(target);
}
export function back() { if (stack.length > 1 || layers.length) history.back(); }
window.addEventListener("popstate", (e) => {
  const st = e.state as { d?: number; layer?: number } | null;
  const d = st?.d ?? 1;
  if (pending) { const t = pending; pending = null; curD = d; applyTab(t); return; }
  curD = d;
  if (ignorePop > 0) { ignorePop--; return; }
  if (layers.length) { layers.pop()!.close(); return; }
  if (stack.length > 1) { stack = stack.slice(0, -1); emit(); }
  // přistáli jsme na záznamu zaniklé vrstvy → přeskočit
  if (st?.layer && !layers.some((l) => l.id === st.layer)) { ignorePop++; history.back(); }
});
/** Dokud je `active`, tlačítko Zpět místo opuštění obrazovky zavolá `close`. */
export function useBackLayer(active: boolean, close: () => void) {
  const ref = useRef(close); ref.current = close;
  useEffect(() => {
    if (!active) return;
    const id = ++layerId;
    layers.push({ id, close: () => ref.current() });
    curD++; history.pushState({ d: curD, layer: id }, "");
    return () => {
      const i = layers.findIndex((l) => l.id === id);
      if (i >= 0) { layers.splice(i, 1); if (i === layers.length && (history.state as { layer?: number } | null)?.layer === id) { ignorePop++; history.back(); } }
    };
  }, [active]);
}

// ---------- formátování
export const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString("cs-CZ", { timeZone: "UTC", day: "numeric", month: "numeric", year: "numeric" });
export const fmtDateTime = (ts: number) => new Date(ts * 1000).toLocaleString("cs-CZ", { timeZone: "UTC", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtMin = (s: number) => `${Math.round(s / 60)} min`;
export const num = (v: number | null | undefined, d = 1) => (v == null ? "–" : v.toLocaleString("cs-CZ", { maximumFractionDigits: d }));

export function Card({ title, children, right, id }: { title?: string; children: React.ReactNode; right?: React.ReactNode; id?: string }) {
  return (
    <section className="card" id={id}>
      {title && <div className="card-h"><h2>{title}</h2>{right}</div>}
      {children}
    </section>
  );
}

/** Přepínač podkaret B&L (Buddy | Lokality). */
export function BLSwitch({ on }: { on: "buddies" | "sites" }) {
  return (
    <div className="seg bl">
      <button className={on === "buddies" ? "on" : ""} onClick={() => tab({ t: "buddies" })}>Buddy</button>
      <button className={on === "sites" ? "on" : ""} onClick={() => tab({ t: "sites" })}>Lokality</button>
    </div>
  );
}

export function Tiles({ items, cols, cls }: { items: [string, React.ReactNode, (() => void)?][]; cols?: number; cls?: Record<string, string> }) {
  return <div className={"tiles" + (cols === 2 ? " two" : "")}>{items.map(([k, v, on]) => <div className={"tile" + (on ? " link" : "") + (cls?.[k] ? " " + cls[k] : "")} key={k} onClick={on}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>;
}

export function KV({ rows }: { rows: [string, React.ReactNode, string?][] }) {
  return (
    <table className="kv"><tbody>
      {rows.map(([k, v, c]) => <tr key={k}><td>{k}{c && <span className="conf">{c}</span>}</td><td>{v}</td></tr>)}
    </tbody></table>
  );
}

/** Textové pole s křížkem pro vyprázdnění (hledání, výběr jmen). */
export function ClearInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className={"clr " + (className || "")}>
      <input ref={ref} name="myx-search" autoComplete="off" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" className="clr-x" aria-label="Vymazat" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(""); ref.current?.focus(); }}>✕</button>}
    </span>
  );
}

/** Pole s našeptávačem: vybere existující položku, nebo založí novou. */
export function Picker({ items, placeholder, onPick, onCreate }: {
  items: { id: string; name: string; hint?: string }[]; placeholder: string;
  onPick: (id: string) => void; onCreate: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const n = norm(q);
  const hits = n ? items.filter((i) => norm(i.name).includes(n)).slice(0, 8) : [];
  const exact = items.some((i) => norm(i.name) === n);
  return (
    <div className="picker">
      <ClearInput value={q} placeholder={placeholder} onChange={setQ} />
      {n && (
        <div className="picker-list">
          {hits.map((i) => <button key={i.id} onClick={() => { onPick(i.id); setQ(""); }}>{i.name}{i.hint && <small>{i.hint}</small>}</button>)}
          {!exact && <button className="new" onClick={() => { onCreate(q.trim()); setQ(""); }}>+ Přidat „{q.trim()}“</button>}
        </div>
      )}
    </div>
  );
}

export function Chip({ children, onX, onClick }: { children: React.ReactNode; onX?: () => void; onClick?: () => void }) {
  return <span className="chip" onClick={onClick}>{children}{onX && <button onClick={(e) => { e.stopPropagation(); onX(); }} aria-label="Odebrat">×</button>}</span>;
}

export const RATING: Record<string, { icon: string; label: string; cls: string }> = {
  up: { icon: "👍", label: "Dobrý", cls: "ok" }, down: { icon: "👎", label: "Nic moc", cls: "warn" }, problem: { icon: "❗", label: "Problém", cls: "bad" },
};

export function RatingPicker({ value, onChange }: { value?: string; onChange: (v: "up" | "down" | "problem" | undefined) => void }) {
  return (
    <div className="rating">
      {(["up", "down", "problem"] as const).map((k) => (
        <button key={k} className={(value === k ? "on " : "") + RATING[k].cls} onClick={() => onChange(value === k ? undefined : k)}>
          <span>{RATING[k].icon}</span>{RATING[k].label}
        </button>
      ))}
    </div>
  );
}

export { hm } from "../core/analysis";

type ABlock = { head: string; steps: string[]; from: number; to: number; chart: string };
export function AlertBox({ a, fold, onShow }: { a: { level: string; title: string; text: string; parts?: string[]; blocks?: ABlock[] }; fold?: boolean; onShow?: (b: ABlock) => void }) {
  const [open, setOpen] = useState(false);
  const [openB, setOpenB] = useState<number | null>(null);
  if (!fold || !a.text) return <div className={"alert " + a.level}><b>{a.title}</b>{a.text && <div>{a.text}</div>}</div>;
  const bl = a.blocks?.length ? a.blocks : null, many = (bl?.length || 0) > 5;
  return <div className={"alert fold " + a.level + (open ? " open" : "")} onClick={() => setOpen(!open)}><b>{a.title}<span className="fold-arr">{open ? "▴" : "▾"}</span></b>
    {open && (bl ? <div className="ablocks">
      <div>{a.text.split("\n")[0]}</div>
      {bl.map((b, i) => (
        <div key={i} className="ablock" onClick={(e) => e.stopPropagation()}>
          {b.head && <div className="ablock-h" onClick={() => many && setOpenB(openB === i ? null : i)}>{b.head}{many && <span className="fold-arr">{openB === i ? "▴" : "▾"}</span>}</div>}
          {(!many || openB === i) && <>
            {b.steps.map((x, k) => <div key={k} className="ablock-s">• {x}</div>)}
            {onShow && <a className="ablock-l" onClick={() => onShow(b)}>Ukázat v grafu ›</a>}
          </>}
        </div>
      ))}
    </div> : a.parts ? <div className="alert-parts">{a.parts.map((p, i) => <div key={i}>{p}</div>)}</div> : <div>{a.text}</div>)}</div>;
}
