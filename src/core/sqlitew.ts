// Minimální zapisovač souborů SQLite: nová databáze s několika tabulkami (b-strom tabulky, přetečení dlouhých záznamů).
// Stačí na sdílení vybraných ponorů ve stejném formátu jako export Shearwater Cloud. Formát: https://www.sqlite.org/fileformat2.html
import type { SqlValue } from "./sqlite";

export interface SqlTable { name: string; sql: string; rows: SqlValue[][] }

const PS = 4096; // velikost stránky
const U = PS;    // použitelná velikost (bez rezervy)
const enc = new TextEncoder();

function varint(v: number): number[] {
  if (v < 0) throw new Error("záporný varint");
  if (v <= 0x7f) return [v];
  // až 8 bajtů po 7 bitech stačí na 2^56
  const out: number[] = [];
  let x = v;
  const bytes: number[] = [];
  while (x > 0) { bytes.unshift(x % 128); x = Math.floor(x / 128); }
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i] | (i < bytes.length - 1 ? 0x80 : 0));
  return out;
}

/** Záznam (řádek) ve formátu SQLite: hlavička se sériovými typy + data. */
export function encodeRecord(vals: SqlValue[]): Uint8Array {
  const types: number[] = [];
  const body: Uint8Array[] = [];
  for (const v of vals) {
    if (v == null) types.push(0);
    else if (typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) {
      if (v === 0) types.push(8); else if (v === 1) types.push(9);
      else {
        const [t, n] = v >= -128 && v < 128 ? [1, 1] : v >= -32768 && v < 32768 ? [2, 2] : v >= -8388608 && v < 8388608 ? [3, 3] : v >= -2147483648 && v < 2147483648 ? [4, 4] : v >= -(2 ** 47) && v < 2 ** 47 ? [5, 6] : [6, 8];
        types.push(t);
        const b = new Uint8Array(n);
        if (n === 8) new DataView(b.buffer).setBigInt64(0, BigInt(v));
        else { let x = v < 0 ? 2 ** (8 * n) + v : v; for (let i = n - 1; i >= 0; i--) { b[i] = x % 256; x = Math.floor(x / 256); } }
        body.push(b);
      }
    } else if (typeof v === "number") { types.push(7); const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); body.push(b); }
    else if (typeof v === "string") { const b = enc.encode(v); types.push(13 + 2 * b.length); body.push(b); }
    else { types.push(12 + 2 * v.length); body.push(v); }
  }
  const th = types.flatMap(varint);
  let hl = th.length + 1;
  while (varint(hl).length + th.length !== hl) hl = varint(hl).length + th.length;
  const head = [...varint(hl), ...th];
  const len = head.length + body.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  out.set(head, 0);
  let p = head.length;
  for (const b of body) { out.set(b, p); p += b.length; }
  return out;
}

/** Vytvoří soubor SQLite s danými tabulkami (rowid = pořadí řádku od 1). */
export function writeSqlite(tables: SqlTable[]): Uint8Array {
  const pages: Uint8Array[] = [new Uint8Array(PS)]; // stránka 1 = sqlite_master, doplní se nakonec
  const alloc = () => { pages.push(new Uint8Array(PS)); return pages.length; }; // číslo nové stránky (od 1)
  const pg = (n: number) => pages[n - 1];

  /** Buňka listu tabulky; dlouhá data jdou do řetězu přetečení. */
  const leafCell = (rowid: number, rec: Uint8Array): Uint8Array => {
    const P = rec.length, X = U - 35;
    const pre = [...varint(P), ...varint(rowid)];
    if (P <= X) { const c = new Uint8Array(pre.length + P); c.set(pre); c.set(rec, pre.length); return c; }
    const M = Math.floor(((U - 12) * 32) / 255) - 23;
    const K = M + ((P - M) % (U - 4));
    const local = K <= X ? K : M;
    // řetěz přetečení
    let first = 0, prev = 0;
    for (let off = local; off < P; off += U - 4) {
      const n = alloc();
      if (prev) new DataView(pg(prev).buffer).setUint32(0, n); else first = n;
      pg(n).set(rec.subarray(off, Math.min(P, off + U - 4)), 4);
      prev = n;
    }
    const c = new Uint8Array(pre.length + local + 4);
    c.set(pre); c.set(rec.subarray(0, local), pre.length);
    new DataView(c.buffer).setUint32(pre.length + local, first);
    return c;
  };

  /** Zapíše buňky do stránky (typ 0x0d list / 0x05 vnitřní); hdrOff = 100 u stránky 1. */
  const fill = (n: number, type: number, cells: Uint8Array[], right = 0, hdrOff = 0) => {
    const b = pg(n), dv = new DataView(b.buffer);
    const hsz = type === 0x05 ? 12 : 8;
    let top = PS;
    b[hdrOff] = type;
    dv.setUint16(hdrOff + 3, cells.length);
    cells.forEach((c, i) => { top -= c.length; b.set(c, top); dv.setUint16(hdrOff + hsz + 2 * i, top); });
    dv.setUint16(hdrOff + 5, top === 65536 ? 0 : top);
    if (type === 0x05) dv.setUint32(hdrOff + 8, right);
  };

  /** Rozdělí buňky do stránek tak, aby se vešly. */
  const pack = (cells: Uint8Array[], hsz: number, extra = 0): Uint8Array[][] => {
    const groups: Uint8Array[][] = [];
    let cur: Uint8Array[] = [], used = hsz + extra;
    for (const c of cells) {
      if (cur.length && used + 2 + c.length > PS) { groups.push(cur); cur = []; used = hsz + extra; }
      cur.push(c); used += 2 + c.length;
    }
    groups.push(cur);
    return groups;
  };

  /** B-strom tabulky, vrací číslo kořenové stránky. */
  const buildTable = (rows: SqlValue[][]): number => {
    const cells = rows.map((r, i) => leafCell(i + 1, encodeRecord(r)));
    let level = pack(cells, 8).map((g, gi, all) => {
      const n = alloc();
      fill(n, 0x0d, g);
      const lastRow = all.slice(0, gi + 1).reduce((a, x) => a + x.length, 0);
      return { page: n, maxKey: lastRow };
    });
    while (level.length > 1) {
      // vnitřní stránky: (levé dítě, klíč) … + pravý ukazatel
      const next: { page: number; maxKey: number }[] = [];
      const entries = level;
      let i = 0;
      while (i < entries.length) {
        const kids: typeof entries = [];
        let used = 12;
        while (i < entries.length) {
          const cellLen = 4 + varint(entries[i].maxKey).length;
          if (kids.length && used + 2 + cellLen > PS) break;
          kids.push(entries[i]); used += 2 + cellLen; i++;
        }
        const n = alloc();
        const right = kids[kids.length - 1];
        const cs = kids.slice(0, -1).map((k) => { const v = varint(k.maxKey); const c = new Uint8Array(4 + v.length); new DataView(c.buffer).setUint32(0, k.page); c.set(v, 4); return c; });
        fill(n, 0x05, cs, right.page);
        next.push({ page: n, maxKey: right.maxKey });
      }
      level = next;
    }
    return level[0].page;
  };

  const master: SqlValue[][] = tables.map((t) => ["table", t.name, t.name, buildTable(t.rows), t.sql]);
  const mcells = master.map((r, i) => leafCell(i + 1, encodeRecord(r)));
  if (pack(mcells, 8, 100).length > 1) throw new Error("Příliš mnoho tabulek");
  fill(1, 0x0d, mcells, 0, 100);

  // hlavička databáze
  const h = pg(1), dv = new DataView(h.buffer);
  h.set(enc.encode("SQLite format 3\0"), 0);
  dv.setUint16(16, PS);
  h[18] = 1; h[19] = 1; h[20] = 0; h[21] = 64; h[22] = 32; h[23] = 32;
  dv.setUint32(24, 1);              // čítač změn
  dv.setUint32(28, pages.length);   // velikost v stránkách
  dv.setUint32(40, 1);              // schema cookie
  dv.setUint32(44, 4);              // formát schématu
  dv.setUint32(56, 1);              // UTF-8
  dv.setUint32(92, 1);              // version-valid-for
  dv.setUint32(96, 3045000);        // verze SQLite

  const out = new Uint8Array(pages.length * PS);
  pages.forEach((p, i) => out.set(p, i * PS));
  return out;
}
