import { useState, useSyncExternalStore } from "react";
import { getState, subscribe, type State } from "../app/store";
import { norm } from "../app/model";

export const useStore = (): State => useSyncExternalStore(subscribe, getState);

// ---------- navigace (zásobník obrazovek + tlačítko zpět v Androidu)
export type Screen =
  | { t: "home" } | { t: "dives"; site?: string; buddy?: string } | { t: "dive"; id: string }
  | { t: "sites" } | { t: "site"; id: string } | { t: "buddies" } | { t: "buddy"; id: string }
  | { t: "settings" } | { t: "about" } | { t: "draft"; id: string } | { t: "cells"; pos?: number; install?: string } | { t: "bats"; pos?: number } | { t: "warn" };

let stack: Screen[] = [{ t: "home" }];
const navSubs = new Set<() => void>();
const emit = () => navSubs.forEach((f) => f());
export const useScreen = () => useSyncExternalStore((f) => { navSubs.add(f); return () => navSubs.delete(f); }, () => stack[stack.length - 1]);
export function go(s: Screen) { stack = [...stack, s]; history.pushState({ d: stack.length }, ""); emit(); window.scrollTo(0, 0); }
export function tab(s: Screen) { stack = [s]; history.replaceState({ d: 1 }, ""); emit(); window.scrollTo(0, 0); }
export function back() { if (stack.length > 1) history.back(); }
window.addEventListener("popstate", () => { if (stack.length > 1) { stack = stack.slice(0, -1); emit(); } });

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

export function Tiles({ items }: { items: [string, React.ReactNode, (() => void)?][] }) {
  return <div className="tiles">{items.map(([k, v, on]) => <div className={"tile" + (on ? " link" : "")} key={k} onClick={on}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>;
}

export function KV({ rows }: { rows: [string, React.ReactNode, string?][] }) {
  return (
    <table className="kv"><tbody>
      {rows.map(([k, v, c]) => <tr key={k}><td>{k}{c && <span className="conf">{c}</span>}</td><td>{v}</td></tr>)}
    </tbody></table>
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
      <input value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
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

export function AlertBox({ a }: { a: { level: string; title: string; text: string } }) {
  return <div className={"alert " + a.level}><b>{a.title}</b><div>{a.text}</div></div>;
}
