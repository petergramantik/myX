// Minimální čtečka souborů SQLite (jen čtení celých tabulek) – stačí na export databáze Shearwater Cloud.
// Formát: https://www.sqlite.org/fileformat2.html

export type SqlValue = null | number | string | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export class SqliteFile {
  private dv: DataView;
  private pageSize: number;
  private usable: number;
  private dec = new TextDecoder("utf-8");

  constructor(private buf: Uint8Array) {
    const magic = new TextDecoder().decode(buf.subarray(0, 15));
    if (magic !== "SQLite format 3") throw new Error("Soubor není databáze SQLite");
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let ps = this.dv.getUint16(16);
    if (ps === 1) ps = 65536;
    this.pageSize = ps;
    this.usable = ps - buf[20];
  }

  private page(n: number): number { return (n - 1) * this.pageSize; }

  private varint(pos: number): [number, number] {
    let v = 0;
    for (let i = 0; i < 9; i++) {
      const b = this.buf[pos + i];
      if (i === 8) { v = v * 256 + b; return [v, 9]; }
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return [v, i + 1];
    }
    return [v, 9];
  }

  /** Projde všechny řádky tabulky (b-strom od kořenové stránky). */
  private *scan(root: number): Generator<Uint8Array> {
    const stack = [root];
    while (stack.length) {
      const pg = stack.pop()!;
      const base = this.page(pg);
      const hdr = pg === 1 ? base + 100 : base;
      const type = this.buf[hdr];
      const n = this.dv.getUint16(hdr + 3);
      if (type === 0x05) {
        const kids: number[] = [];
        for (let i = 0; i < n; i++) kids.push(this.dv.getUint32(base + this.dv.getUint16(hdr + 12 + 2 * i)));
        kids.push(this.dv.getUint32(hdr + 8));
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      } else if (type === 0x0d) {
        for (let i = 0; i < n; i++) {
          let p = base + this.dv.getUint16(hdr + 8 + 2 * i);
          const [len, a] = this.varint(p); p += a;
          const [, b] = this.varint(p); p += b;
          yield this.payload(p, len);
        }
      } else throw new Error("Neočekávaný typ stránky " + type);
    }
  }

  private payload(p: number, len: number): Uint8Array {
    const U = this.usable, X = U - 35;
    if (len <= X) return this.buf.subarray(p, p + len);
    const M = Math.floor(((U - 12) * 32) / 255) - 23;
    const K = M + ((len - M) % (U - 4));
    const local = K <= X ? K : M;
    const out = new Uint8Array(len);
    out.set(this.buf.subarray(p, p + local), 0);
    let off = local, next = this.dv.getUint32(p + local);
    while (next && off < len) {
      const b = this.page(next);
      const take = Math.min(U - 4, len - off);
      out.set(this.buf.subarray(b + 4, b + 4 + take), off);
      off += take;
      next = this.dv.getUint32(b);
    }
    return out;
  }

  private record(rec: Uint8Array): SqlValue[] {
    const dv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    let [hlen, a] = (() => { const s = new SqliteFileVarint(rec); return s.read(0); })();
    const types: number[] = [];
    let p = a;
    const vr = new SqliteFileVarint(rec);
    while (p < hlen) { const [t, n] = vr.read(p); types.push(t); p += n; }
    let d = hlen;
    const out: SqlValue[] = [];
    for (const t of types) {
      if (t === 0) out.push(null);
      else if (t >= 1 && t <= 6) {
        const sz = [0, 1, 2, 3, 4, 6, 8][t];
        let v = 0;
        if (t === 6) { v = Number(dv.getBigInt64(d)); }
        else { for (let i = 0; i < sz; i++) v = v * 256 + rec[d + i]; if (rec[d] & 0x80) v -= 2 ** (8 * sz); }
        out.push(v); d += sz;
      } else if (t === 7) { out.push(dv.getFloat64(d)); d += 8; }
      else if (t === 8) out.push(0);
      else if (t === 9) out.push(1);
      else if (t >= 12 && t % 2 === 0) { const n = (t - 12) / 2; out.push(rec.slice(d, d + n)); d += n; }
      else if (t >= 13) { const n = (t - 13) / 2; out.push(this.dec.decode(rec.subarray(d, d + n))); d += n; }
      else out.push(null);
    }
    return out;
  }

  tables(): Map<string, { root: number; cols: string[] }> {
    const m = new Map<string, { root: number; cols: string[] }>();
    for (const rec of this.scan(1)) {
      const [type, name, , root, sql] = this.record(rec) as [string, string, string, number, string];
      if (type !== "table" || !sql) continue;
      m.set(name, { root, cols: parseCols(sql) });
    }
    return m;
  }

  /** Všechny řádky tabulky jako objekty podle názvů sloupců. */
  rows(table: string): SqlRow[] {
    const t = this.tables().get(table);
    if (!t) throw new Error("V databázi chybí tabulka " + table);
    const out: SqlRow[] = [];
    for (const rec of this.scan(t.root)) {
      const vals = this.record(rec);
      const r: SqlRow = {};
      t.cols.forEach((c, i) => (r[c] = i < vals.length ? vals[i] : null));
      out.push(r);
    }
    return out;
  }
}

class SqliteFileVarint {
  constructor(private b: Uint8Array) {}
  read(pos: number): [number, number] {
    let v = 0;
    for (let i = 0; i < 9; i++) {
      const x = this.b[pos + i];
      if (i === 8) return [v * 256 + x, 9];
      v = v * 128 + (x & 0x7f);
      if (!(x & 0x80)) return [v, i + 1];
    }
    return [v, 9];
  }
}

function parseCols(sql: string): string[] {
  const body = sql.slice(sql.indexOf("(") + 1, sql.lastIndexOf(")"));
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  const cols: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(s)) continue;
    const m = /^["`\[]?([^"`\]\s]+)["`\]]?/.exec(s);
    if (m) cols.push(m[1]);
  }
  return cols;
}
