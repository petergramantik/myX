// Testy jádra bez soukromých dat: syntetický záznam ponoru a sloučení logbooků.
import { decodeDive } from "../src/core/shearwater";
import { summarize, injections, alerts, realStops, gasLabel, pressureUse, setpointChanges, o2Doses, spWarnings, SP_RULES, DEFAULT_THRESHOLDS } from "../src/core/analysis";
import { applyCloud } from "../src/app/store";
import { diveStats, diffRows, conclusion } from "../src/core/compare";
import { gasDensity } from "../src/core/effort";
import { mergeLogbooks, emptyLogbook } from "../src/app/model";
import { detectCellEvents, cellStatus, cellDiveWarnings, DEFAULT_CELL_TH, type CellDive } from "../src/core/cells";
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
ok(cellStatus(1, ser, DEFAULT_CELL_TH, 20, 30, 12, ser.slice(0, 4)).level === "warn", "staré čidlo s funkčními hodnotami jen oranžově");
const lb2 = emptyLogbook(); lb2.drafts.z = { id: "z", created: 1, buddyIds: [], note: "x", updated: 1 };
const lb3 = emptyLogbook(); lb3.deleted.z = 2;
ok(!mergeLogbooks(lb2, lb3).drafts.z, "spárovaný rozpracovaný ponor se smaže i na jiném zařízení");

{ // zastávka v grafu jen tam, kde potápěč na zastávce opravdu je
  const fake: any = { s: { stop: [0, 6, 6, 6, 3], depth: [30, 30, 8, 6, 3] } };
  const r = realStops(fake);
  ok(JSON.stringify(r) === JSON.stringify([null, null, 6, 6, 3]), "skutečné zastávky");
}

ok(Array.isArray(d.alarms), "alarmy se dekódují");
{ // čidla podle vlastní historie: nové citlivější čidlo bez varování, prudký pokles = červená, stárnutí = oranžová
  const D = 86400, mk = (day: number, mv: number[]) => ({ start: day * D, cells: { mvBar: mv, lin: [null, null, null], early: [null, null, null] } });
  const ser = [mk(0, [48, 46, 47]), mk(40, [47, 46, 47]), mk(80, [46, 46, 62]), mk(100, [41, 45, 60]), mk(110, [29, 44, 59])];
  const w4 = cellDiveWarnings(ser, 4, DEFAULT_CELL_TH), w3 = cellDiveWarnings(ser, 3, DEFAULT_CELL_TH), w2 = cellDiveWarnings(ser, 2, DEFAULT_CELL_TH);
  ok(w4.some((x) => x.level === "bad" && x.title.includes("1")), "prudký pokles čidla = červená");
  ok(w3.some((x) => x.level === "warn" && x.title.includes("1")), "pozvolný pokles = stárnutí");
  ok(!w2.some((x) => x.title.includes("3")), "nové citlivější čidlo bez varování");
}
{ // spotřeba: pokles 150 → 120, ohřátí +5 se odečte, nárůst o 40 (externí) se nepočítá
  const t = [...Array(40).keys()].map((i) => i * 60), dep = t.map(() => 20);
  const p = t.map((_, i) => (i < 10 ? 150 : i < 20 ? 130 : i < 25 ? 135 : i < 30 ? 125 : 165 - (i - 30)));
  const u = pressureUse(t, p, dep, 99999);
  ok(u.ok && u.ext.length === 1 && u.bar >= 25 && u.bar <= 36, `spotřeba z průběhu tlaku (${u.bar} bar)`);
  ok(!pressureUse(t, t.map(() => 9), dep, 99999).ok, "jen mezitlak = nelze spočítat");
}
ok(gasLabel("21/0").label === "AIR" && gasLabel("21/35").label === "TMX 21/35" && gasLabel("32/0").label === "NX 32" && gasLabel("100/0").label === "O₂", "štítky plynů");

{ // tlačítka 0x51, ruční přepnutí setpointu, CO₂ častěji než vzorky, dávky O₂
  const r2: Uint8Array[] = recs.filter((r) => r[0] !== 0x01 && r[0] !== 0xe1 && r[0] !== 0x30 && r[0] < 0x20);
  for (let i = 0; i < 60; i++) {
    const dep = i < 10 ? i * 20 : i < 50 ? 200 : (60 - i) * 20;
    const sp = i < 20 ? 50 : 130;
    const pp = i === 14 ? 60 : i === 15 ? 80 : i === 16 ? 95 : i < 20 ? 60 : 130; // nárůst nad setpointem 0,5 = ručně O₂
    r2.push(rec(0x01, [[1, be16(dep)], [7, [pp]], [8, [21]], [13, [60]], [15, [62]], [16, [61]], [18, [149]], [19, [sp]], [25, [255]]]));
    r2.push(rec(0x30, [[1, [29]], [4, be32(START + i * 5)], [8, be32(2000)]]));
    if (i === 30) r2.push(rec(0x30, [[1, [29]], [4, be32(START + i * 5 + 2)], [8, be32(9000)]])); // špička mezi vzorky
    if (i === 25) { // stisky zapsané v dávce až později: menu v 88 s, potvrzení v 90 s (přepnutí ve vzorku 20 = 100 s)
      const d0 = new Date((START + 88) * 1000), d1 = new Date((START + 90) * 1000);
      r2.push(rec(0x51, [[0, [0x51, 2, 0, 0xb3, 0, 0x06, d0.getUTCMinutes(), d0.getUTCSeconds()]], [8, [0x51, 1, 0, 0x06, 0, 0xb3, d1.getUTCMinutes(), d1.getUTCSeconds()]]]));
    }
  }
  r2.push(...recs.filter((r) => r[0] >= 0x20 && r[0] <= 0x27));
  const raw2 = new Uint8Array(r2.length * 32); r2.forEach((r, i) => raw2.set(r, i * 32));
  const gz2 = gzipSync(raw2);
  const b2 = new Uint8Array(4 + gz2.length); b2.set([raw2.length & 255, (raw2.length >> 8) & 255, (raw2.length >> 16) & 255, 0], 0); b2.set(gz2, 4);
  const d2 = await decodeDive({ id: "t2", blob: b2 });
  ok(d2.buttons.length === 2 && d2.buttons[0].t === 88 && d2.buttons[1].from === 0x06, "tlačítka 0x51 s časem podle hodin");
  const sp = setpointChanges(d2);
  ok(sp.length === 1 && sp[0].manual && sp[0].to === 1.3, "ruční přepnutí setpointu z menu Petrelu");
  ok(d2.s.co2raw[30] === 9000, "CO₂: ke vzorku maximum z intervalu");
  ok(o2Doses(d2).some((x) => x.kind === "man" && x.preSw), "ruční dávka O₂ nad setpointem před přepnutím");
  const w2 = spWarnings(d2, { sp }, { ...SP_RULES, lateMin: 0.5 });
  ok(w2.some((a) => a.title === "Pozdní přepnutí na vysoký setpoint" && /po dosažení dna/.test(a.text)), "pozdní setpoint měřený od dosažení dna");
  ok(!spWarnings(d2, { sp }).some((a) => a.title === "Pozdní přepnutí na vysoký setpoint" || a.title === "Klesání s vysokým setpointem"), "včasné přepnutí bez varování");
}
{ // převzetí lokality a buddy ze Shearwater Cloud jen tam, kde nic není
  const lb = emptyLogbook(); lb.notes.b = { buddyIds: [], note: "moje", siteId: undefined, updated: 1 };
  const out = applyCloud(lb, new Map([["a", { site: "Hemmoor", buddies: ["Roman", "Dan"], notes: "x" }], ["b", { site: "Lom", buddies: [], notes: "cizí" }]]), new Set(["a", "b"]));
  const sa = out.notes.a, sb = out.notes.b;
  ok(!!sa && out.sites[sa.siteId!].name === "Hemmoor" && sa.buddyIds.length === 2 && sb.note === "moje" && !!sb.siteId, "údaje ze Shearwater Cloud");
}

{ // porovnání ponorů: stejné ponory = podobná deko, rozdíly se seřadí; párování počítačů se slučuje
  const sa = diveStats(d), sb = diveStats(d);
  ok(conclusion("já", "R", sa, sb)[0].startsWith("Dekompresní povinnost byla podobná") && diffRows(sa, sb).every((r) => r.weight === 0), "porovnání stejných ponorů");
  const sc = { ...sb, ttsMax: sb.ttsMax + 6, ambInt: sb.ambInt + 30, inert: sb.inert + 30 };
  ok(/U potápěče R byla dekomprese delší.*hloub/.test(conclusion("já", "R", sa, sc)[0]), "závěr: delší deko kvůli hloubce");
  const l1 = emptyLogbook(), l2 = emptyLogbook(); l2.computers = { B94F4935: { id: "B94F4935", model: "Petrel 3", buddyId: "r", updated: 5 } };
  ok(mergeLogbooks(l1, l2).computers?.B94F4935?.buddyId === "r", "majitel cizího počítače se synchronizuje");
}

{ // hustota plynu: vzduch na hladině ~1,3 g/l, ve 20 m ~3,9 g/l
  const dn = gasDensity(d).filter((x): x is number => x != null);
  ok(Math.max(...dn) > 3.5 && Math.max(...dn) < 4.2, `hustota plynu ve 20 m (${Math.max(...dn)} g/l)`);
}

if (fails) { console.error(`${fails} testů selhalo`); process.exit(1); }
console.log("Vše v pořádku");
