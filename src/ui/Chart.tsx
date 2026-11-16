// Jednoduché SVG grafy s dotykovým popiskem (bez knihoven).
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Series { label: string; color: string; values: (number | null)[]; unit?: string; right?: boolean; width?: number; dash?: string; fillUp?: boolean }

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

const fmt = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? "–" : Math.abs(v) >= 100 ? v.toFixed(0) : +v.toFixed(d) + "");
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function LineChart({ t, series, height = 190, invert, zero, markers, extra, rightInvert, xFmt, xTitle, bands, vlines, strip, pins, marks }: {
  t: number[]; series: Series[]; height?: number; invert?: boolean; zero?: boolean; markers?: number[]; rightInvert?: boolean;
  bands?: { from: number; to: number; color: string }[];
  /** Svislé čáry od horního okraje grafu k hodnotě `to` (levá osa). */
  vlines?: { t: number; to: number; color: string }[];
  xFmt?: (v: number) => string; xTitle?: (v: number) => string;
  extra?: { label: string; values: (number | string | null)[]; unit?: string }[];
  /** Svislé čárkované značky přes celý graf s popiskem nahoře (např. přepnutí setpointu). */
  pins?: { t: number; label: string; color: string }[];
  /** Krátké barevné značky u spodní osy (např. dávky O₂ podle druhu). */
  marks?: { t: number; color: string }[];
  /** Tenký barevný pruh dole (např. použitý plyn) se svislými značkami v místě přepnutí. */
  strip?: { from: number; to: number; color: string; label: string }[];
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => setHover(null), [t]);
  if (!t.length) return <div className="chart-empty">Bez dat</div>;
  const left = series.filter((s) => !s.right), right = series.filter((s) => s.right);
  const range = (ss: Series[], fit = false) => {
    let lo = Infinity, hi = -Infinity;
    for (const s of ss) for (const v of s.values) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo === Infinity) return [0, 1];
    if (zero) { const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return [-a, a]; }
    if (fit) { const pad = (hi - lo) * 0.1 || 0.1; return [lo - pad, hi + pad]; }
    lo = Math.min(0, lo);
    if (hi === lo) hi = lo + 1;
    return [lo, hi + (hi - lo) * 0.05];
  };
  const [lo, hi] = range(left), [rlo, rhi] = range(right, !rightInvert);
  const x0 = t[0], x1 = t[t.length - 1] || 1;
  // popisky značek (setpoint, přepnutí plynu) v pruhu nad grafem, rozložené do řádků bez překryvu
  const tags = [
    ...(pins || []).map((p) => ({ t: p.t, label: p.label, color: p.color, dash: "3 3" })),
    ...(strip || []).slice(1).map((g) => ({ t: g.from, label: g.label, color: g.color, dash: "2 3" })),
  ].sort((a, b) => a.t - b.t);
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
  const path = (s: Series) => {
    let d = "", pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const y = s.right ? Y(v, rlo, rhi, !!rightInvert) : Y(v);
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
  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const tv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    let best = 0, bd = Infinity;
    for (let i = 0; i < t.length; i++) { const dd = Math.abs(t[i] - tv); if (dd < bd) { bd = dd; best = i; } }
    setHover(best);
  };
  const hx = hover != null ? X(t[hover]) : 0;
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={height} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} role="img">
        {yt.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={m.l - 4} y={Y(v) + 3} textAnchor="end">{fmt(v, 2)}</text>
          </g>
        ))}
        {right.length > 0 && ticks(rlo, rhi, 4).map((v) => <text key={"r" + v} x={W - m.r + 4} y={Y(v, rlo, rhi, !!rightInvert) + 3}>{fmt(v, 2)}</text>)}
        {xt.map((v) => <text key={"x" + v} x={X(v * xs)} y={height - 5} textAnchor="middle">{xFmt ? xFmt(v) : Math.round(v) + "′"}</text>)}
        {zero && <line x1={m.l} x2={W - m.r} y1={Y(0)} y2={Y(0)} className="ref" />}
        {markers?.map((mt, i) => <line key={"m" + i} x1={X(mt)} x2={X(mt)} y1={xFmt ? m.t : height - m.b - 7} y2={height - m.b} className="marker" />)}
        {bands?.map((b, i) => <rect key={"b" + i} x={X(b.from)} width={Math.max(2, X(b.to) - X(b.from))} y={m.t} height={height - m.t - m.b} fill={b.color} opacity={0.2} />)}
        {series.filter((s) => s.fillUp && !s.right).map((s, i) => <path key={"f" + i} d={area(s)} fill={s.color} opacity={0.18} stroke="none" />)}
        {series.map((s, i) => <path key={i} d={path(s)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.5} strokeDasharray={s.dash} opacity={s.right ? 0.55 : 1} />)}
        {vlines?.map((v, i) => <line key={"v" + i} x1={X(v.t)} x2={X(v.t)} y1={m.t} y2={Y(v.to)} stroke={v.color} strokeWidth={1} />)}
        {marks?.map((k, i) => <line key={"k" + i} x1={X(k.t)} x2={X(k.t)} y1={height - m.b - 9} y2={height - m.b} stroke={k.color} strokeWidth={2} />)}
        {placed.map((p, i) => (
          <g key={"p" + i}>
            <line x1={p.x} x2={p.x} y1={4 + p.row * 11 + 9} y2={height - m.b} stroke={p.color} strokeWidth={1} strokeDasharray={p.dash} opacity={0.85} />
            <text x={p.lx} y={4 + p.row * 11 + 8} fill={p.color} className="strip-l">{p.label}</text>
          </g>
        ))}
        {strip?.map((g, i) => <rect key={"s" + i} x={X(g.from)} width={Math.max(1, X(g.to) - X(g.from))} y={height - m.b - 5} height={4} fill={g.color} opacity={0.85} />)}
        {hover != null && <line x1={hx} x2={hx} y1={m.t} y2={height - m.b} className="ref" />}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: Math.min(Math.max(0, hx + 10), Math.max(0, W - 170)) }}>
          <b>{xTitle ? xTitle(t[hover]) : `Čas ${fmtTime(t[hover])}`}</b>
          {series.filter((s) => s.label).map((s, i) => <div key={i}><i style={{ background: s.color }} />{s.label}: {fmt(s.values[hover])} {s.unit || ""}</div>)}
          {extra?.map((s, i) => { const v = s.values[hover]; return <div key={"e" + i}>{s.label}: {typeof v === "string" ? v : fmt(v)} {s.unit || ""}</div>; })}
        </div>
      )}
      <div className="legend">{series.filter((s) => s.label).map((s, i) => <span key={i}><i style={{ background: s.color }} />{s.label}</span>)}</div>
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
