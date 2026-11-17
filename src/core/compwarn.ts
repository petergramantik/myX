import type { Dive } from "./shearwater";

/** Jistota významu příznaku: ✓ potvrzeno daty, P pravděpodobně, ? hypotéza. */
export type Certainty = "✓" | "P" | "?";
export type CompWarnKind = "ndl" | "o2press" | "dilpress" | "po2low" | "po2high" | "co2" | "cellout" | "co2sensor" | "unknown";

/** Bity „varování na displeji“ (události 0 zobrazeno / 1 potvrzeno nebo zmizelo / 2 potvrzeno tlačítkem – Petrel 3), bajty 8–15 záznamu. */
export const WARN_BITS: { byte: number; bit: number; kind: CompWarnKind; label: string; c: Certainty }[] = [
  { byte: 4, bit: 0x02, kind: "ndl", label: "Nízké NDL", c: "✓" },
  { byte: 5, bit: 0x20, kind: "o2press", label: "Nízký tlak O₂", c: "✓" },
  { byte: 5, bit: 0x40, kind: "dilpress", label: "Nízký tlak diluentu", c: "✓" },
  { byte: 7, bit: 0x04, kind: "po2low", label: "Nízké pO₂", c: "✓" },
  { byte: 7, bit: 0x10, kind: "po2high", label: "Vysoké pO₂", c: "✓" },
  { byte: 7, bit: 0x40, kind: "co2", label: "CO₂", c: "✓" },
  { byte: 6, bit: 0x10, kind: "cellout", label: "Vyřazené čidlo", c: "P" },
  { byte: 6, bit: 0x01, kind: "co2sensor", label: "Chyba CO₂ čidla", c: "P" },
  { byte: 6, bit: 0x02, kind: "co2sensor", label: "Chyba CO₂ čidla", c: "P" },
];
/** Obecný příznak „varování na displeji“ – sám nic neznamená. */
const GENERIC = { byte: 3, bit: 0x02 };

export interface CompWarn {
  kind: CompWarnKind; label: string; c: Certainty; code: string;
  start: number; end: number | null;
  /** Jak skončilo: potvrzeno pravým tlačítkem / zmizelo samo / trvá do konce ponoru. */
  how: "ack" | "cleared" | "open";
}

/** Varování zobrazená na počítači a jejich potvrzení. Stejný druh (např. dva bity chyby CO₂ čidla) se slučuje. */
export function computerWarnings(d: Dive): CompWarn[] {
  const out: CompWarn[] = [];
  const open = new Map<string, CompWarn>();
  const bitsOf = (payload: string) => {
    const b = payload.split(" ").map((x) => parseInt(x, 16));
    const res: { byte: number; bit: number }[] = [];
    b.forEach((v, by) => { for (let bit = 1; bit < 256; bit <<= 1) if (v & bit && !(by === GENERIC.byte && bit === GENERIC.bit)) res.push({ byte: by, bit }); });
    return res;
  };
  const def = (x: { byte: number; bit: number }) => WARN_BITS.find((w) => w.byte === x.byte && w.bit === x.bit);
  const keyOf = (x: { byte: number; bit: number }) => { const w = def(x); return w ? w.kind + w.label : `B${x.byte}x${x.bit}`; };
  for (const e of d.events) {
    const k = String(e.kind);
    if (k === "0") {
      for (const x of bitsOf(e.payload)) {
        const key = keyOf(x);
        if (open.has(key)) continue;
        const w = def(x);
        const cw: CompWarn = w ? { kind: w.kind, label: w.label, c: w.c, code: `B${x.byte} 0x${x.bit.toString(16)}`, start: Math.max(0, e.t), end: null, how: "open" }
          : { kind: "unknown", label: `Neznámé varování (B${x.byte} 0x${x.bit.toString(16)})`, c: "?", code: `B${x.byte} 0x${x.bit.toString(16)}`, start: Math.max(0, e.t), end: null, how: "open" };
        open.set(key, cw); out.push(cw);
      }
    } else if (k === "1" || k === "2") {
      const btn = d.buttons.some((b) => b.btn === 1 && b.from === b.to && Math.abs(b.t - e.t) <= 2);
      for (const x of bitsOf(e.payload)) {
        const key = keyOf(x), cw = open.get(key);
        if (!cw) continue;
        cw.end = Math.max(0, e.t); cw.how = k === "2" || btn ? "ack" : "cleared";
        open.delete(key);
      }
    }
  }
  return out;
}

/** Číslo čidla, které se v čase t nejvíc odchyluje od mediánu (pro „vyřazené čidlo“ bez čísla v logu). */
export function deviatingCell(d: Dive, t: number): { cell: number; pct: number } | null {
  const s = d.s;
  let best: { cell: number; pct: number } | null = null;
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] < t - 120 || s.t[i] > t + 10) continue;
    const m = [s.mv1[i], s.mv2[i], s.mv3[i]];
    const med = [...m].sort((a, b) => a - b)[1];
    if (!med) continue;
    m.forEach((v, k) => { const p = Math.abs(v - med) / med * 100; if (!best || p > best.pct) best = { cell: k + 1, pct: Math.round(p) }; });
  }
  return best && best.pct >= 10 ? best : null;
}
