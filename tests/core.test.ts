// Testy jádra bez soukromých dat: syntetický záznam ponoru a sloučení logbooků.
import { decodeDive } from "../src/core/shearwater";
import { summarize, injections, alerts, DEFAULT_THRESHOLDS } from "../src/core/analysis";
import { mergeLogbooks, emptyLogbook } from "../src/app/model";
import { detectCellEvents, cellStatus, DEFAULT_CELL_TH, type CellDive } from "../src/core/cells";
import { gzipSync } from "zlib";

let fails = 0;
const ok = (c: boolean, msg: string) => { if (!c) { fails++; console.error("✗ " + msg); } else console.log("✓ " + msg); };

function rec(type: number, set: [number, number[]][] = []) { const r = new Uint8Array(32); r[0] = type; for (const [i, b] of set) r.set(b, i); return r; }
const be16 = (v: number) => [(v >> 8) & 255, v & 255];
const be32 = (v: number) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const START = 1_700_000_000;
const recs: Uint8Array[] = [
  rec(0x10, [[2, be16(5)], [4, [30, 70]], [6, be16(120)], [12, be32(START)], [17, [50, 130]], [20, [21]]]),
  rec(0x11, [[16, be16(980)]]), rec(0x12), rec(0x13, [[3, be16(1000)]]),
  rec(0x14, [[1, [0]], [6, [150]], [8, [90]], [9, [2]], [12, [138]], [14, [135]]]),
  rec(0x15, [[23, be16(5000)]]), rec(0x16, [[1, be16(25200)], [3, be16(25200)]]), rec(0x17),
];
for (let i = 0; i < 60; i++) {
  const dep = i < 10 ? i * 20 : i < 50 ? 200 : (60 - i) * 20;
  const pp = i % 9 === 4 ? 140 : 128;
  recs.push(rec(0x01, [[1, be16(dep)], [7, [pp]], [8, [21]], [13, [60]], [14, [12]], [15, [62]], [16, [61]], [18, [149]], [19, [130]], [25, [255]]]));
  recs.push(rec(0xe1, [[5, be16(1500)], [7, be16(1400)]]));
  recs.push(rec(0x30, [[1, [29]], [4, be32(START + i * 5)], [8, be32(2000)]]));
}
recs.push(rec(0x20, [[4, be16(200)], [6, [0, 1, 44]], [10, be16(3)], [12, be32(START + 300)]]), rec(0x21, [[16, be16(980)]]), rec(0x24, [[6, [148]]]), rec(0x26, [[3, be16(24900)]]));
const raw = new Uint8Array(recs.length * 32); recs.forEach((r, i) => raw.set(r, i * 32));
const gz = gzipSync(raw);
const blob = new Uint8Array(4 + gz.length + 64); // + nulové vyplnění jako u Shearwater
blob.set([raw.length & 255, (raw.length >> 8) & 255, (raw.length >> 16) & 255, 0], 0); blob.set(gz, 4);

const d = await decodeDive({ id: "t", blob });
ok(d.h.num === 5, "číslo ponoru");
ok(d.h.maxDepth === 20 && d.h.diveTimeS === 300, "max. hloubka a doba");
ok(d.h.gfLo === 30 && d.h.gfHi === 70 && d.h.spHi === 1.3, "GF a setpoint");
ok(d.s.t.length === 60 && d.s.t[1] === 5, "vzorky po 5 s");
ok(Math.abs(d.s.dil[0]! - 206.8) < 0.2, "tlak diluentu z 0xE1 (2 psi)");
ok(Math.abs(d.s.co2[20]! - 2000 * (0.98 + 20 * 0.0981) / 10000) < 0.002, "ppCO₂ = hodnota × tlak / 10 000");
ok(d.h.scrubTotalMin === 420 && d.h.scrubLeftEndMin === 415, "scrubber");
const s = summarize(d);
ok(s.avgDepth > 10 && s.ppo2Max === 1.4, "souhrn");
ok(injections(d).length >= 3, "odhad vstřiků");
const al = alerts([{ ...d.h, batVStart: 1.39, batVEnd: 1.36 }], START + 20 * 86400, DEFAULT_THRESHOLDS);
ok(al.some((a) => a.title === "Slabá baterie"), "upozornění na baterii");

const a = emptyLogbook(), b = emptyLogbook();
a.sites.x = { id: "x", name: "Šífr", updated: 1 }; b.sites.x = { id: "x", name: "Lom Šífr", updated: 2 };
b.buddies.y = { id: "y", name: "Pepa", updated: 5 }; a.deleted.y = 6;
const m = mergeLogbooks(a, b);
ok(m.sites.x.name === "Lom Šífr" && !m.buddies.y, "sloučení logbooků");

// čidla: výměna čidla 3 (skok nahoru, potvrzený dalším ponorem), kalibrace, stav slabého čidla
const cd = (a: number, b: number, c: number, lin1 = 1): CellDive => ({ mvBar: [a, b, c], lin: [lin1, 1, 1], early: [null, null, null] });
const ser = [cd(48, 47, 48), cd(48, 47, 48), cd(48, 47, 48), cd(48.2, 47, 61), cd(48.3, 47.1, 60.5), cd(50, 48.5, 60.5), cd(29, 48.5, 60.4, 0.6)];
const ev = detectCellEvents(ser);
ok(ev.some((e) => e.kind === "change" && e.pos.join() === "3" && e.index === 3), "výměna čidla 3");
ok(ev.some((e) => e.kind === "cal" && e.index === 5), "kalibrace");
ok(!ev.some((e) => e.kind === "change" && e.index === 6), "pokles citlivosti není výměna");
const cs1 = cellStatus(0, ser, DEFAULT_CELL_TH, 3, null, 12, ser.slice(0, 4));
ok(cs1.level === "bad" && cs1.reasons.length >= 2, "slabé čidlo: mV na vzduchu a current limiting");
ok(cellStatus(1, ser, DEFAULT_CELL_TH, 13, null, 12, ser.slice(0, 4)).level === "warn", "čidlo po životnosti");
const lb2 = emptyLogbook(); lb2.drafts.z = { id: "z", created: 1, buddyIds: [], note: "x", updated: 1 };
const lb3 = emptyLogbook(); lb3.deleted.z = 2;
ok(!mergeLogbooks(lb2, lb3).drafts.z, "spárovaný rozpracovaný ponor se smaže i na jiném zařízení");

if (fails) { console.error(`${fails} testů selhalo`); process.exit(1); }
console.log("Vše v pořádku");
