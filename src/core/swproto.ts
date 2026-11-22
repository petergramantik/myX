// Protokol stahování logů ze Shearwater přes Bluetooth LE – podle libdivecomputer (shearwater_common.c, shearwater_petrel.c, LGPL).
// Čistá logika bez Bluetooth: rámování SLIP (+ 2B hlavička BLE rámců u protokolu V1), pakety FF 01, RDBI, upload (stažení paměti),
// dekomprese LRE + XOR a čtení seznamu ponorů (manifest). Přenos dodá volající (transport) – viz app/ble.ts.

export const SW_SERVICE = "fe25c237-0ece-443c-b0aa-e02033e7029d"; // Perdix/Teric/Peregrine/Tern/Petrel (P)
export const SW_SERVICE_V2 = "1aa44039-1667-4b29-87cc-dfecaaf31d97"; // Perdix 3 – protokol V2

const END = 0xc0, ESC = 0xdb, ESC_END = 0xdc, ESC_ESC = 0xdd;
const RDBI_REQ = 0x22, RDBI_RES = 0x62, UP_INIT = 0x35, UP_INIT_RES = 0x75, UP_DATA = 0x36, UP_DATA_RES = 0x76, UP_EXIT = 0x37, UP_EXIT_RES = 0x77, NAK = 0x7f;
export const ID_SERIAL = 0x8010, ID_FIRMWARE = 0x8011, ID_LOGUPLOAD = 0x8021, ID_MODEL = 0x8060;
export const MANIFEST_ADDR = 0xe0000000, MANIFEST_SIZE = 0x600, DIVE_SIZE = 0xffffff;
/** Čísla modelů Shearwater (ID_MODEL). */
export const SW_MODELS: Record<number, string> = { 2: "Predator", 3: "Petrel 2", 4: "NERD", 5: "Perdix", 6: "Perdix AI", 7: "NERD 2", 8: "Teric", 9: "Peregrine", 10: "Petrel 3", 11: "Perdix 2", 12: "Tern", 13: "Peregrine TX", 14: "Perdix 3" };

export type Proto = 1 | 2;

/** Rámce k odeslání: SLIP (escape END/ESC + END na konci), u BLE V1 po 20 B s hlavičkou [počet rámců, pořadí]. */
export function slipFrames(data: Uint8Array, proto: Proto, mtu = 20): Uint8Array[] {
  const esc: number[] = [];
  for (const c of data) { if (c === END) esc.push(ESC, ESC_END); else if (c === ESC) esc.push(ESC, ESC_ESC); else esc.push(c); }
  esc.push(END);
  if (proto === 2) { const out: Uint8Array[] = []; for (let i = 0; i < esc.length; i += mtu) out.push(Uint8Array.from(esc.slice(i, i + mtu))); return out; }
  // V1: hlavička 2 B v každém rámci; počet rámců spočítaný stejně jako v libdivecomputer
  const nframes = Math.ceil(esc.length / mtu), per = mtu - 2, out: Uint8Array[] = [];
  for (let i = 0, k = 0; i < esc.length; i += per, k++) out.push(Uint8Array.from([nframes, k, ...esc.slice(i, i + per)]));
  return out;
}

/** Skládá příchozí BLE rámce do paketů SLIP. */
export class SlipReader {
  private cur: number[] = [];
  private escaped = false;
  readonly packets: Uint8Array[] = [];
  constructor(private proto: Proto) {}
  push(frame: Uint8Array) {
    for (let i = this.proto === 1 ? 2 : 0; i < frame.length; i++) {
      let c = frame[i];
      if (c === END) { if (this.cur.length) { this.packets.push(Uint8Array.from(this.cur)); this.cur = []; } this.escaped = false; continue; }
      if (c === ESC) { this.escaped = true; continue; }
      if (this.escaped) { c = c === ESC_END ? END : c === ESC_ESC ? ESC : c; this.escaped = false; }
      this.cur.push(c);
    }
  }
}

/** Obalí požadavek hlavičkou FF 01 (V1: délka+1, 00; V2: 00, délka 16 bit). */
export function wrapRequest(payload: Uint8Array, proto: Proto): Uint8Array {
  const h = proto === 2 ? [0xff, 0x01, 0x00, payload.length >> 8, payload.length & 0xff] : [0xff, 0x01, payload.length + 1, 0x00];
  return Uint8Array.from([...h, ...payload]);
}
/** Ověří a sejme hlavičku odpovědi 01 FF. */
export function unwrapResponse(p: Uint8Array, proto: Proto): Uint8Array {
  const hl = proto === 2 ? 5 : 4;
  if (p.length < hl || p[0] !== 0x01 || p[1] !== 0xff || p[proto === 2 ? 2 : 3] !== 0) throw new Error("Neplatná hlavička odpovědi");
  const len = proto === 2 ? (p[3] << 8) | p[4] : p[2] - 1;
  if (len < 0 || len + hl !== p.length) throw new Error("Neplatná délka odpovědi");
  return p.subarray(hl);
}

/** Dekomprese LRE: proud 9bitových hodnot – bit 0x100 = bajt, jinak počet nul, 0 = konec. Vrací true na konci proudu. */
export function lre(data: Uint8Array, out: number[]): boolean {
  const nbits = data.length * 8;
  if (nbits % 9) throw new Error("Chyba dekomprese (LRE)");
  for (let off = 0; off + 9 <= nbits; off += 9) {
    const b = off >> 3, bit = off & 7;
    const v = ((((data[b] << 8) | (data[b + 1] ?? 0)) >> (16 - (bit + 9))) & 0x1ff);
    if (v & 0x100) out.push(v & 0xff);
    else if (v === 0) return true;
    else for (let k = 0; k < v; k++) out.push(0);
  }
  return false;
}
/** Druhá fáze: každý 32B blok XOR s předchozím (na místě). */
export function unxor(d: Uint8Array): Uint8Array { for (let i = 32; i < d.length; i++) d[i] ^= d[i - 32]; return d; }

/** Záznamy seznamu ponorů: 0xA5C4 platný, 0x5A23 smazaný, jinak konec. Otisk (4 B na pozici 4) = čas začátku ponoru. */
export function parseManifest(page: Uint8Array): { dives: { addr: number; fp: number }[]; full: boolean } {
  const dives: { addr: number; fp: number }[] = [];
  let n = 0;
  for (let i = 0; i + 32 <= page.length; i += 32) {
    const h = (page[i] << 8) | page[i + 1];
    if (h === 0x5a23) { n++; continue; }
    if (h !== 0xa5c4) break;
    n++;
    const be = (o: number) => ((page[i + o] << 24) | (page[i + o + 1] << 16) | (page[i + o + 2] << 8) | page[i + o + 3]) >>> 0;
    dives.push({ fp: be(4), addr: be(20) });
  }
  return { dives, full: n === page.length / 32 };
}

/** Přenos: odešle paket a vrátí odpověď (bez hlavičky). */
export type Transfer = (req: Uint8Array) => Promise<Uint8Array>;

export async function rdbi(tx: Transfer, id: number): Promise<Uint8Array> {
  const r = await tx(Uint8Array.from([RDBI_REQ, id >> 8, id & 0xff]));
  if (r[0] === NAK) throw new Error(`Počítač odmítl dotaz ${id.toString(16)} (kód ${r[2]})`);
  if (r.length < 3 || r[0] !== RDBI_RES || r[1] !== id >> 8 || r[2] !== (id & 0xff)) throw new Error("Neočekávaná odpověď (RDBI)");
  return r.subarray(3);
}

/** Stáhne blok paměti (upload); s kompresí LRE+XOR do konce proudu. */
/** out: průběžný výstup (při přerušení v něm zůstane, co se stihlo stáhnout). */
export async function download(tx: Transfer, proto: Proto, addr: number, size: number, compressed: boolean, onBytes?: (n: number) => void, out: number[] = []): Promise<Uint8Array> {
  const init = await tx(Uint8Array.from([UP_INIT, compressed ? 0x10 : 0, 0x34, addr >>> 24, (addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff]));
  if (init.length < 2 || init[0] !== UP_INIT_RES) throw new Error("Neočekávaná odpověď (upload init)");
  let block = 1, n = 0, done = false;
  while (n < size && !done) {
    const req = proto === 2 ? [UP_DATA, block, 0] : [UP_DATA, block];
    const r = await tx(Uint8Array.from(req));
    if (r.length < 2 || r[0] !== UP_DATA_RES || r[1] !== block) throw new Error("Neočekávaná odpověď (blok " + block + ")");
    const data = r.subarray(2);
    if (!data.length) break;
    if (compressed) done = lre(data, out); else out.push(...data);
    n += data.length; onBytes?.(n);
    block = (block + 1) & 0xff;
  }
  const q = await tx(Uint8Array.from([UP_EXIT]));
  if (q[0] !== UP_EXIT_RES) throw new Error("Neočekávaná odpověď (upload exit)");
  const res = Uint8Array.from(out);
  return compressed ? unxor(res) : res;
}

/** Konec ponoru v nativních datech: za prvním závěrečným záznamem (0xFF) po patičce (0x20); −1 = ještě nekončí. */
export function nativeEnd(nat: Uint8Array): number {
  let foot = false;
  for (let i = 0; i + 32 <= nat.length; i += 32) { if (nat[i] === 0x20) foot = true; else if (nat[i] === 0xff && foot) return i + 32; }
  return -1;
}
const cat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
/** Zbytek ponoru po přerušení se čte bez komprese po blocích (nekomprimovaná paměť = nativní data, P). */
export const TAIL_CHUNK = 0x8000;
/** Stav stahování jednoho ponoru mezi pokusy (přes znovupřipojení). */
export interface DiveState { have: Uint8Array | null; noTail?: boolean; resumed?: boolean }

/**
 * Stáhne ponor (LRE+XOR). Po přerušení si pamatuje stažený začátek (celé 32B záznamy) a při dalším pokusu
 * naváže – zbytek čte bez komprese od adresy za staženou částí. Když to počítač neumí nebo zbytek nesedí,
 * stáhne ponor znovu celý. Úplnost ověří volající (hlavička, patička, závěr).
 */
export async function downloadDive(tx: Transfer, proto: Proto, addr: number, st: DiveState, onBytes?: (n: number) => void, log?: (s: string) => void): Promise<Uint8Array> {
  if (st.have?.length && !st.noTail) {
    try {
      log?.(`Navazuji od ${Math.round(st.have.length / 1024)} kB`);
      for (let k = 0; k < 64; k++) {
        const end = nativeEnd(st.have);
        if (end > 0) { st.resumed = true; return st.have.slice(0, end); }
        const base = st.have.length;
        const c = await download(tx, proto, addr + base, TAIL_CHUNK, false, (n) => onBytes?.(base + n));
        const whole = c.subarray(0, c.length - (c.length % 32));
        if (!whole.length) break;
        st.have = cat(st.have, whole);
      }
      log?.("Navázání: konec ponoru nenalezen – stahuji znovu celý");
    } catch (e) {
      const m = (e as Error).message;
      if (!/Neočekávaná|odmítl/.test(m)) throw e; // přerušené spojení: zkusit navázat znovu
      log?.(`Navázání počítač neumí (${m}) – stahuji znovu celý`);
    }
    st.have = null; st.noTail = true;
  }
  const acc: number[] = [];
  try { return await download(tx, proto, addr, DIVE_SIZE, true, onBytes, acc); }
  catch (e) {
    if (!st.noTail) {
      const pre = unxor(Uint8Array.from(acc));
      const n = Math.max(0, Math.floor(pre.length / 32) - 1) * 32; // poslední záznam může být neúplný
      if (n > (st.have?.length || 0)) st.have = pre.slice(0, n);
    }
    throw e;
  }
}

/** Obal ponoru jako v Shearwater Cloud: 4 B délka (LE) + gzip nativních dat. */
export async function wrapBlob(native: Uint8Array): Promise<Uint8Array> {
  const gz = new Uint8Array(await new Response(new Blob([native]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const out = new Uint8Array(4 + gz.length);
  out.set([native.length & 0xff, (native.length >> 8) & 0xff, (native.length >> 16) & 0xff, (native.length >>> 24) & 0xff]);
  out.set(gz, 4);
  return out;
}
