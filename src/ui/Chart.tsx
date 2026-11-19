// Jednoduché SVG grafy s dotykovým popiskem (bez knihoven).
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** Výchozí nastavení grafů v sekci (linka profilu, zoom). */
export const ChartDefs = createContext<{ profile?: (number | null)[]; zoom?: boolean } | null>(null);
/** Společný výřez (zoom) pro grafy jednoho ponoru: [od, do] v sekundách, null = celý ponor. */
export const ZoomCtx = createContext<{ z: [number, number] | null; setZ: React.Dispatch<React.SetStateAction<[number, number] | null>> } | null>(null);

export interface Series { label: string; color: string; values: (number | null)[]; unit?: string; right?: boolean; width?: number; dash?: string; fillUp?: boolean; noTip?: boolean; nullText?: string }

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || 320);
    const ro = new ResizeObserver(() => setW(el.clientWidth || 320));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/** Hodnota v popisku s desetinnou čárkou. */
const fmtCs = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? "–" : (Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(d)).toLocaleString("cs-CZ"));
const fmt = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? "–" : Math.abs(v) >= 100 ? v.toFixed(0) : +v.toFixed(d) + "");
export const fmtTime = (s: number) => { const r = Math.round(s); return `${Math.floor(r / 60)}′${String(r % 60).padStart(2, "0")}″`; };

export function LineChart({ t, series: series0, height = 190, invert, zero, markers, extra, rightInvert, xFmt, xTitle, bands, vlines, strip, pins, marks, profile, toggle, bandLegend, zoomable, focusT }: {
  /** Postavit posuvník na tento čas (odkaz z varování). */
  focusT?: number;
  t: number[]; series: Series[]; height?: number; invert?: boolean; zero?: boolean; markers?: number[]; rightInvert?: boolean;
  /** Barevná pásma; label se ukáže v popisku posuvníku, když na pásmu stojí. */
  bands?: { from: number; to: number; color: string; label?: string }[];
  /** Jemná linka profilu hloubky (vlastní skrytá osa). */
  profile?: (number | null)[];
  /** Legenda řad je klikatelná – zapnutí / vypnutí řady. */
  toggle?: boolean;
  /** Vysvětlivky pásem v legendě. */
  bandLegend?: { color: string; label: string; off?: boolean; onClick?: () => void }[];
  /** Zoom dvěma prsty (výřez sdílený přes ZoomCtx). */
  zoomable?: boolean;
  /** Svislé čáry od horního okraje grafu k hodnotě `to` (levá osa). */
  vlines?: { t: number; to: number; color: string }[];
  xFmt?: (v: number) => string; xTitle?: (v: number) => string;
  extra?: { label: string; values: (number | string | null)[]; unit?: string }[];
  /** Svislé čárkované značky přes celý graf s popiskem nahoře (např. přepnutí setpointu). */
  pins?: { t: number; label: string; color: string }[];
  /** Krátké barevné značky u spodní osy (např. dávky O₂ podle druhu). */
  marks?: { t: number; color: string; h?: number }[];
  /** Tenký barevný pruh dole (např. použitý plyn) se svislými značkami v místě přepnutí. */
  strip?: { from: number; to: number; color: string; label: string }[];
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const zc = useContext(ZoomCtx), defs = useContext(ChartDefs);
  if (profile === undefined && defs?.profile && !series0.some((x) => x.label === "Hloubka") && !invert) profile = defs.profile;
  if (zoomable === undefined) zoomable = defs?.zoom;
  const [zLocal, setZLocal] = useState<[number, number] | null>(null);
  const clipId = useId().replace(/:/g, "");
  const pts = useRef(new Map<number, number>());
  const pinch = useRef<{ d0: number; c0: number; win: [number, number] } | null>(null);
  const lastTap = useRef(0);
  useEffect(() => setHover(null), [t]);
  useEffect(() => { if (focusT == null || !t.length) return; const i = t.findIndex((x) => x >= focusT); setHover(i < 0 ? t.length - 1 : i); }, [focusT]);
  // posuvník u okraje přiblíženého grafu plynule posouvá výřez (−1 vlevo, 1 vpravo)
  const [edge, setEdge] = useState(0);
  const live = useRef<{ setZ: (f: (z: [number, number] | null) => [number, number] | null) => void; T0: number; T1: number } | null>(null);
  useEffect(() => {
    if (!edge) return;
    const id = setInterval(() => {
      const L = live.current; if (!L) return;
      L.setZ((z) => {
        if (!z) return z;
        const span = z[1] - z[0], d = edge * span * 0.012; // asi čtvrtina výřezu za sekundu
        const lo2 = Math.min(Math.max(L.T0, z[0] + d), L.T1 - span);
        const nz: [number, number] = [lo2, lo2 + span];
        const te = edge < 0 ? nz[0] : nz[1];
        let best = 0, bd = Infinity; for (let i = 0; i < t.length; i++) { const dd = Math.abs(t[i] - te); if (dd < bd) { bd = dd; best = i; } }
        setHover(best);
        return nz;
      });
    }, 40);
    return () => clearInterval(id);
  }, [edge, t]);
  if (!t.length) return <div className="chart-empty">Bez dat</div>;
  const z = zoomable ? (zc ? zc.z : zLocal) : null;
  const setZ = zc ? zc.setZ : setZLocal;
  const T0 = t[0], T1 = t[t.length - 1] || 1;
  live.current = { setZ: setZ as (f: (z: [number, number] | null) => [number, number] | null) => void, T0, T1 };
  const win: [number, number] = z ? [Math.max(T0, z[0]), Math.min(T1, z[1])] : [T0, T1];
  const vis = (i: number) => t[i] >= win[0] - 1 && t[i] <= win[1] + 1;
  const series = [...series0.filter((s) => !hidden.has(s.label)), ...(profile && !hidden.has("Hloubka") ? [{ label: "", color: "#90a4ae", values: profile, width: 1, profile: true } as Series & { profile?: boolean }] : [])];
  const isProf = (s: Series) => !!(s as Series & { profile?: boolean }).profile;
  const left = series.filter((s) => !s.right && !isProf(s)), right = series.filter((s) => s.right);
  const range = (ss: Series[], fit = false) => {
    let lo = Infinity, hi = -Infinity;
    for (const s of ss) s.values.forEach((v, i) => { if (v != null && vis(i)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    if (lo === Infinity) return [0, 1];
    if (zero) { const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return [-a, a]; }
    if (fit) { const pad = (hi - lo) * 0.1 || 0.1; return [lo - pad, hi + pad]; }
    lo = Math.min(0, lo);
    if (hi === lo) hi = lo + 1;
    return [lo, hi + (hi - lo) * 0.05];
  };
  const [lo, hi] = range(left, !!z), [rlo, rhi] = range(right, !rightInvert || !!z);
  const pMax = profile ? Math.max(1, ...profile.filter((v, i) => v != null && vis(i)) as number[]) * 1.05 : 1;
  const x0 = win[0], x1 = win[1] > win[0] ? win[1] : win[0] + 1;
  // popisky značek (setpoint, přepnutí plynu) v pruhu nad grafem, rozložené do řádků bez překryvu
  const tags = [
    ...(pins || []).map((p) => ({ t: p.t, label: p.label, color: p.color, dash: "3 3" })),
    ...(strip || []).slice(1).map((g) => ({ t: g.from, label: g.label, color: g.color, dash: "2 3" })),
  ].filter((g) => g.t >= x0 && g.t <= x1).sort((a, b) => a.t - b.t);
  const pl = 36, pr = right.length ? 34 : 8;
  const xOf = (v: number) => pl + ((v - x0) / (x1 - x0 || 1)) * (W - pl - pr);
  const rowEnd: number[] = [];
  const placed = tags.map((g) => {
    const x = xOf(g.t), w = g.label.length * 5.6 + 4;
    const lx = Math.min(Math.max(x - w / 2, 2), W - w - 2);
    let r = rowEnd.findIndex((e) => e < lx - 3);
    if (r < 0) { r = rowEnd.length; rowEnd.push(0); }
    rowEnd[r] = lx + w;
    return { ...g, x, lx, row: r };
  });
  const tagH = rowEnd.length ? rowEnd.length * 11 + 3 : 0;
  height += tagH; // pruh s popisky graf nezmenšuje, přidá se nad něj
  const m = { l: pl, r: pr, t: 8 + tagH, b: 20 };
  const X = (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (v: number, a = lo, b = hi, inv = invert) => { const f = (v - a) / (b - a || 1); return inv ? m.t + f * (height - m.t - m.b) : height - m.b - f * (height - m.t - m.b); };
  /** Krátké výpadky (nejvýš 2 vzorky) se přemostí lineárně – čára se nepřeruší. */
  const bridged = (vals: (number | null)[]) => {
    const out = vals.slice();
    for (let i = 1; i < out.length; i++) {
      if (out[i] != null || out[i - 1] == null) continue;
      let j = i; while (j < out.length && out[j] == null) j++;
      if (j < out.length && j - i <= 2) for (let k = i; k < j; k++) out[k] = out[i - 1]! + ((out[j]! - out[i - 1]!) * (k - i + 1)) / (j - i + 1);
      i = j;
    }
    return out;
  };
  const path = (s: Series) => {
    let d = "", pen = false;
    bridged(s.values).forEach((v, i) => {
      if (v == null) { pen = false; return; }
      if (!vis(i) && !(i > 0 && vis(i - 1)) && !(i + 1 < t.length && vis(i + 1))) { pen = false; return; }
      const y = isProf(s) ? Y(v, 0, pMax, true) : s.right ? Y(v, rlo, rhi, !!rightInvert) : Y(v);
      d += (pen ? "L" : "M") + X(t[i]).toFixed(1) + "," + y.toFixed(1);
      pen = true;
    });
    return d;
  };
  /** Plocha od křivky k nule (u obrácené osy hloubky = nahoru k hladině), po souvislých úsecích s hodnotou > 0. */
  const area = (s: Series) => {
    let d = "", seg: number[] = [];
    const flush = () => {
      if (seg.length > 1) d += "M" + X(t[seg[0]]).toFixed(1) + "," + Y(0).toFixed(1) + seg.map((i) => "L" + X(t[i]).toFixed(1) + "," + Y(s.values[i]!).toFixed(1)).join("") + "L" + X(t[seg[seg.length - 1]]).toFixed(1) + "," + Y(0).toFixed(1) + "Z";
      seg = [];
    };
    s.values.forEach((v, i) => { if (v != null && v > 0) seg.push(i); else flush(); });
    flush();
    return d;
  };
  const xs = xFmt ? 1 : 60;
  const yt = ticks(lo, hi, 4), xt = ticks(x0 / xs, x1 / xs, Math.max(2, Math.floor(W / 70)));
  const tAt = (px: number, w: [number, number]) => w[0] + ((px - m.l) / (W - m.l - m.r)) * (w[1] - w[0]);
  const pxOf = (e: React.PointerEvent) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  const onDown = (e: React.PointerEvent) => {
    if (!zoomable) { const n = Date.now(); if (n - lastTap.current < 300) { setHover(null); lastTap.current = 0; return; } lastTap.current = n; return onMove(e); }
    pts.current.set(e.pointerId, pxOf(e));
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = { d0: Math.max(20, Math.abs(a - b)), c0: (a + b) / 2, win: [x0, x1] };
      setHover(null); return;
    }
    const now = Date.now();
    if (now - lastTap.current < 300) { if (z) setZ(null); setHover(null); lastTap.current = 0; return; }
    lastTap.current = now;
    onMove(e);
  };
  const onUp = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = null; if (!pts.current.size) setEdge(0); };
  const onPMove = (e: React.PointerEvent) => {
    if (zoomable && pts.current.has(e.pointerId)) pts.current.set(e.pointerId, pxOf(e));
    const p = pinch.current;
    if (zoomable && p && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const d = Math.max(20, Math.abs(a - b)), c = (a + b) / 2;
      const full = T1 - T0, span = Math.min(full, Math.max(60, ((p.win[1] - p.win[0]) * p.d0) / d));
      const tc = tAt(p.c0, p.win);
      let lo2 = tc - ((c - m.l) / (W - m.l - m.r)) * span;
      lo2 = Math.min(Math.max(T0, lo2), T1 - span);
      setZ(span >= full - 1 ? null : [lo2, lo2 + span]);
      return;
    }
    onMove(e);
  };
  const onMove = (e: React.PointerEvent) => {
    const px = pxOf(e);
    const tv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    let best = 0, bd = Infinity;
    for (let i = 0; i < t.length; i++) { const dd = Math.abs(t[i] - tv); if (dd < bd) { bd = dd; best = i; } }
    setHover(best);
    // tažení k okraji přiblíženého grafu (posledních 8 % šířky) posouvá výřez
    const pw = W - m.l - m.r, held = pts.current.has(e.pointerId);
    const ed = z && held ? (px < m.l + pw * 0.08 && x0 > T0 + 1 ? -1 : px > W - m.r - pw * 0.08 && x1 < T1 - 1 ? 1 : 0) : 0;
    if (ed !== edge) setEdge(ed);
  };
  // tlačítka přiblížení: 2× kolem posuvníku (bez něj kolem středu), nejvíc na 2 min
  const MINSPAN = 120, full = T1 - T0, span0 = x1 - x0;
  const zoomBy = (k: number) => {
    const c = hover != null ? t[hover] : (x0 + x1) / 2;
    const span = Math.min(full, Math.max(MINSPAN, span0 * k));
    if (span >= full - 1) { setZ(null); return; }
    const f = (c - x0) / (span0 || 1); // posuvník zůstane na stejném místě grafu
    const lo2 = Math.min(Math.max(T0, c - f * span), T1 - span);
    setZ([lo2, lo2 + span]);
  };
  const hx = hover != null ? X(t[hover]) : 0;
  return (
    <div className="chart">
      <div className="chart-row"><div className="chart-plot" ref={ref}>
      <svg width={W} height={height} onPointerMove={onPMove} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={(e) => onUp(e)} role="img" style={zoomable ? { touchAction: "pan-y" } : undefined}>
        <defs><clipPath id={clipId}><rect x={m.l} y={0} width={Math.max(0, W - m.l - m.r)} height={height} /></clipPath></defs>
        {yt.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={m.l - 4} y={Y(v) + 3} textAnchor="end">{fmt(v, 2)}</text>
          </g>
        ))}
        {right.length > 0 && ticks(rlo, rhi, 4).map((v) => <text key={"r" + v} x={W - m.r + 4} y={Y(v, rlo, rhi, !!rightInvert) + 3}>{fmt(v, 2)}</text>)}
        {xt.map((v) => <text key={"x" + v} x={X(v * xs)} y={height - 5} textAnchor="middle">{xFmt ? xFmt(v) : Math.round(v) + "′"}</text>)}
        {zero && <line x1={m.l} x2={W - m.r} y1={Y(0)} y2={Y(0)} className="ref" />}
        <g clipPath={`url(#${clipId})`}>
        {markers?.map((mt, i) => <line key={"m" + i} x1={X(mt)} x2={X(mt)} y1={xFmt ? m.t : height - m.b - 7} y2={height - m.b} className="marker" />)}
        {bands?.map((b, i) => <rect key={"b" + i} x={X(b.from)} width={Math.max(2, X(b.to) - X(b.from))} y={m.t} height={height - m.t - m.b} fill={b.color} opacity={0.2} />)}
        {series.filter((s) => s.fillUp && !s.right).map((s, i) => <path key={"f" + i} d={area(s)} fill={s.color} opacity={0.18} stroke="none" />)}
        {series.map((s, i) => <path key={i} d={path(s)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.5} strokeDasharray={s.dash} opacity={isProf(s) ? 0.45 : s.right ? 0.55 : 1} />)}
        {vlines?.map((v, i) => <line key={"v" + i} x1={X(v.t)} x2={X(v.t)} y1={m.t} y2={Y(v.to)} stroke={v.color} strokeWidth={1} />)}
        {marks?.map((k, i) => <line key={"k" + i} x1={X(k.t)} x2={X(k.t)} y1={height - m.b - (k.h ?? 9)} y2={height - m.b} stroke={k.color} strokeWidth={k.h ? 2.5 : 2} />)}
        {placed.map((p, i) => <line key={"p" + i} x1={p.x} x2={p.x} y1={4 + p.row * 11 + 9} y2={height - m.b} stroke={p.color} strokeWidth={1} strokeDasharray={p.dash} opacity={0.85} />)}
        {strip?.map((g, i) => <rect key={"s" + i} x={X(g.from)} width={Math.max(1, X(g.to) - X(g.from))} y={height - m.b - 5} height={4} fill={g.color} opacity={0.85} />)}
        {hover != null && <line x1={hx} x2={hx} y1={m.t} y2={height - m.b} className="ref" />}
        </g>
        {/* popisky značek mimo ořez – na okraji se posunou dovnitř grafu */}
        {placed.map((p, i) => <text key={"pl" + i} x={p.lx} y={4 + p.row * 11 + 8} fill={p.color} className="strip-l">{p.label}</text>)}
      </svg>
      </div>
      {zoomable && <div className="zbtns">
        <button aria-label="Přiblížit" disabled={span0 <= MINSPAN + 1} onClick={() => zoomBy(0.5)}>+</button>
        <button aria-label="Celý graf" disabled={!z} onClick={() => setZ(null)}>0</button>
        <button aria-label="Oddálit" disabled={!z} onClick={() => zoomBy(2)}>−</button>
      </div>}
      </div>

      <div className={"chart-info" + (hover == null ? " empty" : "")}>
        {hover == null ? <span className="ci-hint">{zoomable ? "Táhni: hodnoty (u okraje posun) · +/−: přiblížení · Dvojklep: zpět" : "Táhni: hodnoty · Dvojklep: zrušit"}</span> : <>
          <button className="ci-x" aria-label="Zrušit" onClick={() => setHover(null)}>✕</button>
          <div className="ci-r"><b>{xTitle ? xTitle(t[hover]) : fmtTime(t[hover])}</b>{profile && profile[hover] != null && <span> · {fmtCs(profile[hover], 1)} m</span>}
            {bands?.filter((b) => b.label && t[hover] >= b.from && t[hover] <= b.to).map((b, i) => <span key={"bl" + i} className="tip-alarm" style={{ color: b.color }}> ⚠ {b.label}</span>)}</div>
          <div className="ci-v">
            {series.filter((s) => s.label && !s.noTip).map((s, i) => { const v = s.values[hover]; return <span key={i}><i style={{ background: s.color }} />{s.label} <b>{v == null && s.nullText ? s.nullText : fmtCs(v)}</b>{v == null && s.nullText ? "" : s.unit ? " " + s.unit : ""}</span>; })}
            {extra?.map((s, i) => { const v = s.values[hover]; return <span key={"e" + i}>{s.label} <b>{typeof v === "string" ? v : fmtCs(v)}</b>{s.unit ? " " + s.unit : ""}</span>; })}
          </div>
        </>}
      </div>
      <div className="legend">
        {(toggle ? series0 : series).filter((s) => s.label).map((s, i) => toggle
          ? <span key={i} className={"lg-t" + (hidden.has(s.label) ? " off" : "")} onClick={() => { const n = new Set(hidden); n.has(s.label) ? n.delete(s.label) : n.add(s.label); setHidden(n); }}><i style={{ background: s.color }} />{s.label}</span>
          : <span key={i}><i style={{ background: s.color }} />{s.label}</span>)}
        {profile && <span className={"lg-t" + (hidden.has("Hloubka") ? " off" : "")} onClick={() => { const n = new Set(hidden); n.has("Hloubka") ? n.delete("Hloubka") : n.add("Hloubka"); setHidden(n); }}><i style={{ background: "#90a4ae" }} />Hloubka</span>}
        {bandLegend?.map((b, i) => <span key={"bd" + i} className={"lg-band" + (b.onClick ? " lg-t" : "") + (b.off ? " off" : "")} onClick={b.onClick}><i style={{ background: b.color }} />{b.label}</span>)}
      </div>
    </div>
  );
}

const viridis = ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"];
const col = (f: number) => viridis[Math.max(0, Math.min(9, Math.round(f * 9)))];

export function TissueMap({ snaps, end }: { snaps: { t: number; v: number[] }[]; end: number }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<string | null>(null);
  if (!snaps.length) return <div className="chart-empty">Bez snímků tkání</div>;
  const all = snaps.flatMap((s) => s.v);
  const lo = Math.min(...all), hi = Math.max(...all);
  const m = { l: 22, r: 6 }, rowH = 10, H = 16 * rowH + 18;
  const X = (t: number) => m.l + (t / (end || 1)) * (W - m.l - m.r);
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} onPointerLeave={() => setTip(null)}>
        {snaps.map((s, si) => {
          const x0 = X(s.t), x1 = si < snaps.length - 1 ? X(snaps[si + 1].t) : W - m.r;
          return s.v.map((v, i) => (
            <rect key={si + "-" + i} x={x0} y={i * rowH} width={Math.max(1, x1 - x0)} height={rowH - 1} fill={col((v - lo) / (hi - lo || 1))}
              onPointerDown={() => setTip(`Kompartment ${i + 1}, čas ${fmtTime(s.t)}: ${v.toFixed(3)} bar`)}
              onPointerEnter={() => setTip(`Kompartment ${i + 1}, čas ${fmtTime(s.t)}: ${v.toFixed(3)} bar`)} />
          ));
        })}
        <text x={m.l - 4} y={rowH - 1} textAnchor="end">1</text>
        <text x={m.l - 4} y={16 * rowH - 1} textAnchor="end">16</text>
        {ticks(0, end / 60, Math.max(2, Math.floor(W / 70))).map((v) => <text key={v} x={X(v * 60)} y={H - 4} textAnchor="middle">{Math.round(v)}′</text>)}
      </svg>
      <div className="note">{tip || `Klepni na políčko. Škála ${lo.toFixed(2)} bar (tmavá) až ${hi.toFixed(2)} bar (žlutá).`}</div>
    </div>
  );
}
