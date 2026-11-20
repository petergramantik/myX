// Dekódování binárního logu Shearwater Petrel 2 (formát PNF: 32bajtové záznamy).
// Uspořádání podle libdivecomputer, zbytek odvozen porovnáním s aplikací Shearwater Cloud.
import { SqliteFile } from "./sqlite";

export interface RawDive {
  id: string;          // log_id z databáze Shearwater Cloud
  num: number;         // číslo ponoru v počítači
  start: number;       // místní čas počítače jako „UTC“ sekundy
  blob: Uint8Array;    // původní data_bytes_1 (4 B délka + gzip)
  fn?: string;         // název souboru v Shearwater Cloud, např. „Petrel 3[B94F4935]#138 …“
  cnum?: number;       // číslo ponoru v Shearwater Cloud (uživatel ho může přepsat – stejné číslo = jeden ponor)
}

/** Údaje zapsané v Shearwater Cloud (lokalita, buddy, poznámka) podle log_id. */
export interface CloudDetail { site: string; buddies: string[]; notes: string }
/** Čísla ponorů zapsaná v Shearwater Cloud (DiveNumber) podle log_id. */
export function readCloudNumbers(buf: Uint8Array): Map<string, number> {
  const out = new Map<string, number>();
  try { for (const r of new SqliteFile(buf).rows("dive_details")) { const id = String(r["DiveId"] ?? ""), n = Number(r["DiveNumber"]); if (id && Number.isFinite(n) && n > 0) out.set(id, n); } } catch { /* bez tabulky */ }
  return out;
}
export function readCloudDetails(buf: Uint8Array): Map<string, CloudDetail> {
  const out = new Map<string, CloudDetail>();
  let rows: Record<string, unknown>[] = [];
  try { rows = [...new SqliteFile(buf).rows("dive_details")]; } catch { return out; }
  const junk = new Set(["", "-", "no", "ne", "x", "none", "nikdo", "solo", "sólo"]);
  for (const r of rows) {
    const id = String(r["DiveId"] ?? "");
    if (!id) continue;
    const site = String(r["Site"] || r["Location"] || "").trim();
    const buddies = String(r["Buddy"] || "").split(/[,;/]| a | and /).map((x) => x.trim()).filter((x) => !junk.has(x.toLowerCase()));
    const notes = String(r["Notes"] || "").trim();
    if (site || buddies.length || notes) out.set(id, { site, buddies, notes });
  }
  return out;
}

/** Stisk tlačítka na počítači (záznam 0x51): čas od začátku ponoru podle hodin v záznamu. */
export interface Button { t: number; btn: number; from: number; to: number; clock: string }

export interface Tissue { t: number; n2: number[]; he: number[] }
export interface DiveEvent { t: number; kind: string; label: string; payload: string }

export interface Samples {
  t: number[]; depth: number[]; ceil: number[]; stop: number[]; stopt: number[]; tts: number[]; at5: number[];
  ppo2: number[]; mv1: number[]; mv2: number[]; mv3: number[]; sp: number[]; temp: number[]; cns: number[];
  gf99: (number | null)[]; o2: number[]; he: number[]; st: number[]; bv: number[]; bp: number[];
  dil: (number | null)[]; o2p: (number | null)[]; co2raw: (number | null)[]; co2: (number | null)[];
}

export interface Header {
  num: number; start: number; end: number; diveTimeS: number; maxDepth: number; siMin: number | null;
  mode: string; gfLo: number; gfHi: number; spLo: number; spHi: number;
  ocGases: string[]; ccGases: string[]; cnsStart: number; cnsEnd: number;
  surfP: number; surfPEnd: number; salinity: number;
  batType: string; batTypeCode: number; batVStart: number; batVEnd: number; batPctStart: number; batPctEnd: number;
  batWarn: number; batCrit: number;
  scrubTotalMin: number; scrubLeftStartMin: number; scrubLeftEndMin: number;
  onTimeH: number; logVersion: number; rateS: number; serial: number; autoInc: number;
}

/** Alarm z počítače: začátek (událost 9) a konec (událost 10), čas v sekundách od začátku ponoru. */
export interface Alarm { kind: "co2" | "po2low" | "po2high" | "other"; label: string; start: number; end: number }
export interface Dive { id: string; h: Header; s: Samples; tissues: Tissue[]; events: DiveEvent[]; alarms: Alarm[]; buttons: Button[] }
/** Bity alarmů: událost 9 nese masku spuštěných v bajtech 8–11, událost 10 masku ukončených v bajtech 12–15 (stejné rozložení). */
const ALARM_BITS: { kind: Alarm["kind"]; label: string; byte: number; bit: number }[] = [
  { kind: "co2", label: "Alarm CO₂", byte: 2, bit: 0x20 },
  { kind: "po2low", label: "Nízké pO₂", byte: 3, bit: 0x40 },
  { kind: "po2high", label: "Vysoké pO₂", byte: 3, bit: 0x80 },
  { kind: "other", label: "Vyřazené čidlo (P)", byte: 3, bit: 0x20 }, // P: 9. 12. 2024 – pomalé čidlo 3 po přepnutí SP, opakuje se do konce ponoru
  { kind: "other", label: "Hlášení CO₂ z počítače (P)", byte: 2, bit: 0x02 },
  { kind: "other", label: "Porucha solenoidu / baterie v hlavě (P)", byte: 3, bit: 0x10 }, // P: Laďa 9. 5. 2026 – selhal solenoid (baterie v hlavě), dál jen ruční O₂ // P: souběh s nesmyslnými hodnotami CO₂ (Radek 26. 10. 2026)
];

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u24 = (b: Uint8Array, i: number) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const PSI2 = 2 / 14.5038;
export const BAT_TYPES: Record<number, string> = { 1: "Alkalická 1,5 V", 2: "Lithiová 1,5 V", 3: "NiMH 1,2 V" };
const EVN: Record<number, string> = {
  11: "Začátek ponoru", 46: "ID záznamu", 0: "Varování zobrazeno", 1: "Varování potvrzeno / zmizelo", 2: "Varování potvrzeno tlačítkem", 19: "Výběr plynu (P)", 22: "Uložení kurzu (?)",
  9: "Alarm spuštěn (maska)", 10: "Alarm ukončen (maska)",
};

/** Rozbalí gzip. Shearwater ukládá za konec gzipu nulové vyplnění – chyba „junk“ po načtení všech dat se ignoruje. */
export async function gunzip(b: Uint8Array, expected = 0): Promise<Uint8Array> {
  if (expected) b = trimGzip(b, expected);
  const reader = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const parts: Uint8Array[] = [];
  let len = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); len += value.length;
    }
  } catch (e) {
    if (!expected || len < expected) throw e;
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Konec gzipu = poslední výskyt ISIZE (délka dat, 4 B little-endian), za kterým jsou už jen nuly. */
function trimGzip(b: Uint8Array, expected: number): Uint8Array {
  const k = [expected & 255, (expected >>> 8) & 255, (expected >>> 16) & 255, (expected >>> 24) & 255];
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  for (let p = Math.min(end, b.length - 4); p >= 10; p--) {
    if (b[p] === k[0] && b[p + 1] === k[1] && b[p + 2] === k[2] && b[p + 3] === k[3]) return b.subarray(0, p + 4);
  }
  return b;
}

const rawLen = (blob: Uint8Array) => blob[0] | (blob[1] << 8) | (blob[2] << 16) | (blob[3] << 24);

/** Načte z exportu Shearwater Cloud (.db) surové ponory. */
export function readShearwaterDb(buf: Uint8Array): RawDive[] {
  const db = new SqliteFile(buf);
  const rows = db.rows("log_data");
  const out: RawDive[] = [];
  for (const r of rows) {
    const blob = r["data_bytes_1"];
    if (!(blob instanceof Uint8Array) || blob.length < 40) continue;
    const fn = String(r["file_name"] ?? "");
    const m = /#(\d+)/.exec(fn);
    out.push({ id: String(r["log_id"]), num: m ? +m[1] : 0, start: 0, blob, fn });
  }
  return out;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

export async function decodeDive(raw: { id: string; blob: Uint8Array }): Promise<Dive> {
  const d = await gunzip(raw.blob.subarray(4), rawLen(raw.blob));
  const R: Uint8Array[] = [];
  for (let i = 0; i + 32 <= d.length; i += 32) R.push(d.subarray(i, i + 32));
  const H: Record<number, Uint8Array> = {};
  for (const r of R) if ((r[0] >= 0x10 && r[0] <= 0x27) || r[0] === 0xff) if (!H[r[0]]) H[r[0]] = r;
  const O = H[0x10], O1 = H[0x11], O3 = H[0x13], O4 = H[0x14], O5 = H[0x15], O6 = H[0x16];
  const C = H[0x20], C1 = H[0x21], C4 = H[0x24], C6 = H[0x26];
  if (!O || !C) throw new Error("Poškozený záznam ponoru");
  const start = u32(O, 12), end = u32(C, 12);
  const rateS = O5 ? u16(O5, 23) / 1000 || 5 : 5;
  const o2 = Array.from(O.subarray(20, 30));
  const he = [O[30], O[31], ...Array.from(O1.subarray(1, 9))];
  const gas = (i: number) => (o2[i] ? `${o2[i]}/${he[i]}` : "");
  const si = u16(O, 6);
  const surfP = u16(O1, 16), salinity = u16(O3, 3) || 1000;
  const h: Header = {
    num: u16(O, 2), start, end, diveTimeS: u24(C, 6), maxDepth: u16(C, 4) / 10, siMin: si === 65535 ? null : si,
    mode: O4[1] === 0 ? "CCR" : O4[1] === 1 || O4[1] === 6 ? "OC" : String(O4[1]),
    gfLo: O[4], gfHi: O[5], spLo: O[17] / 100, spHi: O[18] / 100,
    ocGases: [0, 1, 2, 3, 4].map(gas).filter(Boolean), ccGases: [5, 6, 7, 8, 9].map(gas).filter(Boolean),
    cnsStart: u16(O, 10), cnsEnd: u16(C, 10), surfP, surfPEnd: u16(C1, 16), salinity,
    batType: BAT_TYPES[O4[9]] ?? `typ ${O4[9]}`, batTypeCode: O4[9], batVStart: O4[6] / 100, batVEnd: C4[6] / 100,
    batPctStart: O4[8], batPctEnd: C4[8], batWarn: O4[12] / 100, batCrit: O4[14] / 100,
    scrubTotalMin: Math.round(u16(O6, 1) / 60), scrubLeftStartMin: Math.round(u16(O6, 3) / 60), scrubLeftEndMin: Math.round(u16(C6, 3) / 60),
    onTimeH: Math.round(u24(C6, 7) / 360) / 10, logVersion: O4[16], rateS, serial: H[0xff] ? u32(H[0xff], 2) : 0, autoInc: u16(O1, 30),
  };
  const s: Samples = { t: [], depth: [], ceil: [], stop: [], stopt: [], tts: [], at5: [], ppo2: [], mv1: [], mv2: [], mv3: [], sp: [], temp: [], cns: [], gf99: [], o2: [], he: [], st: [], bv: [], bp: [], dil: [], o2p: [], co2raw: [], co2: [] };
  const tissues: Tissue[] = [];
  const events: DiveEvent[] = [];
  const alarms: Alarm[] = [];
  const buttons: Button[] = [];
  const sd = new Date(start * 1000), startClock = sd.getUTCMinutes() * 60 + sd.getUTCSeconds();
  const open: Record<string, Alarm> = {};
  let tb: number[] = [];
  const pressure = (depth: number) => surfP / 1000 + depth * salinity / 1000 * 0.0981;
  for (const r of R) {
    const t = r[0];
    const n = s.t.length;
    if (t === 0x01) {
      const dep = u16(r, 1) / 10;
      s.t.push(Math.round(n * rateS)); s.depth.push(dep); s.ceil.push(r[24]); s.stop.push(u16(r, 3)); s.stopt.push(r[10]);
      s.tts.push(u16(r, 5)); s.at5.push(r[27]); s.ppo2.push(r[7] / 100); s.mv1.push(r[13]); s.mv2.push(r[15]); s.mv3.push(r[16]);
      s.sp.push(r[19] / 100); s.temp.push((r[14] << 24) >> 24); s.cns.push(r[23]); s.gf99.push(r[25] === 255 ? null : r[25]);
      s.o2.push(r[8]); s.he.push(r[9]); s.st.push(r[12]); s.bv.push(r[18] / 100); s.bp.push(r[11]);
      s.dil.push(null); s.o2p.push(null); s.co2raw.push(null); s.co2.push(null);
    } else if (t === 0xe1 && n) {
      s.dil[n - 1] = Math.round(u16(r, 5) * PSI2 * 10) / 10;
      s.o2p[n - 1] = Math.round(u16(r, 7) * PSI2 * 10) / 10;
    } else if (t === 0x30) {
      const ts = u32(r, 4) - start;
      if (r[1] === 29) {
        const i = Math.max(n - 1, 0);
        // Petrel 3 zapisuje CO₂ častěji než vzorky – ke vzorku se ukládá maximum z intervalu, aby se neztratily špičky
        if (n) { const v = u32(r, 8); if (s.co2raw[i] == null || v > s.co2raw[i]!) { s.co2raw[i] = v; s.co2[i] = Math.round(v * pressure(s.depth[i]) / 10) / 1000; } }
      } else {
        events.push({ t: ts, kind: String(r[1]), label: EVN[r[1]] ?? `Událost typu ${r[1]}`, payload: hex(r.subarray(8, 16)) });
        if (r[1] === 9 || r[1] === 10) {
          const tt = Math.max(0, ts);
          const bits = [...ALARM_BITS];
          // neznámé bity: obecný alarm s kódem
          if (r[1] === 9) for (let by = 0; by < 4; by++) for (let bit = 1; bit < 256; bit <<= 1)
            if (r[8 + by] & bit && !bits.some((b) => b.byte === by && b.bit === bit)) bits.push({ kind: "other", label: `Neznámý alarm (B${by} 0x${bit.toString(16)})`, byte: by, bit });
          for (const b of bits) {
            const on = r[1] === 9 ? r[8 + b.byte] & b.bit : 0, off = r[1] === 10 ? r[12 + b.byte] & b.bit : 0;
            const key = b.label;
            if (on && !open[key]) { const a: Alarm = { kind: b.kind, label: b.label, start: tt, end: tt }; open[key] = a; alarms.push(a); }
            if (off && open[key]) { open[key]!.end = tt; delete open[key]; }
          }
        }
      }
    } else if (t === 0x51) {
      // 4 položky po 8 B: 0x51, tlačítko (1 pravé, 2 levé, 4 návrat), obrazovka z (u16 BE), obrazovka na (u16 BE), minuta, sekunda
      for (let k = 0; k < 32; k += 8) {
        if (r[k] !== 0x51 || !r[k + 1]) continue;
        const mm = r[k + 6], ss = r[k + 7];
        let tt = (mm * 60 + ss) - startClock;
        const prev = buttons.length ? buttons[buttons.length - 1].t : -600;
        while (tt < prev - 600) tt += 3600;
        buttons.push({ t: tt, btn: r[k + 1], from: (r[k + 2] << 8) | r[k + 3], to: (r[k + 4] << 8) | r[k + 5], clock: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` });
      }
    } else if (t >= 0x70 && t <= 0x75) {
      if (t === 0x70) tb = [];
      const dv = new DataView(r.buffer, r.byteOffset + 4, 28);
      for (let i = 0; i < 7; i++) tb.push(dv.getFloat32(i * 4, true));
      if (t === 0x75 && tb.length >= 32) tissues.push({ t: Math.round(Math.max(n - 1, 0) * rateS), n2: tb.slice(0, 16), he: tb.slice(16, 32) });
    }
  }
  for (const a of Object.values(open)) a!.end = Math.max(a!.start, h.diveTimeS);
  buttons.sort((x, y) => x.t - y.t);
  return { id: raw.id, h, s, tissues, events, alarms, buttons };
}

/** Rychlé přečtení hlavičky bez celého dekódování (číslo, začátek). */
export async function peekHeader(blob: Uint8Array): Promise<{ num: number; start: number }> {
  const d = await gunzip(blob.subarray(4), rawLen(blob));
  for (let i = 0; i + 32 <= d.length; i += 32) if (d[i] === 0x10) return { num: u16(d, i + 2), start: u32(d, i + 12) };
  return { num: 0, start: 0 };
}
