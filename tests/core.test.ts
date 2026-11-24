// Testy jádra bez soukromých dat: syntetický záznam ponoru a sloučení logbooků.
import { decodeDive } from "../src/core/shearwater";
import { summarize, injections, alerts, realStops, gasLabel, pressureUse, setpointChanges, o2Doses, spWarnings, SP_RULES, DEFAULT_THRESHOLDS } from "../src/core/analysis";
import { applyCloud } from "../src/app/store";
import { diveStats, diffRows, conclusion, conclusionSections, groupConclusion, multiRows } from "../src/core/compare";
import { gasDensity } from "../src/core/effort";
import { mergeLogbooks, emptyLogbook, aliasKey } from "../src/app/model";
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
  ok(w2.find((a) => a.title.startsWith("Pozdní"))?.level === "info" && spWarnings(d2, { sp }, { ...SP_RULES, lateMin: 0.5, lateWarn: true }).find((a) => a.title.startsWith("Pozdní"))?.level === "warn", "pozdní přepnutí: info, s přepínačem varování");
}
{ // převzetí lokality a buddy ze Shearwater Cloud jen tam, kde nic není
  const lb = emptyLogbook(); lb.notes.b = { buddyIds: [], note: "moje", siteId: undefined, updated: 1 };
  const out = applyCloud(lb, new Map([["a", { site: "Hemmoor", buddies: ["Roman", "Dan"], notes: "x" }], ["b", { site: "Lom", buddies: [], notes: "cizí" }]]), new Set(["a", "b"]));
  const sa = out.notes.a, sb = out.notes.b;
  ok(!!sa && out.sites[sa.siteId!].name === "Hemmoor" && sa.buddyIds.length === 2 && sb.note === "moje" && !!sb.siteId, "údaje ze Shearwater Cloud");
}

{ // porovnání ponorů: stejné ponory = podobná deko, rozdíly se seřadí; párování počítačů se slučuje
  const sa = diveStats(d), sb = diveStats(d);
  ok(conclusion("já", "R", sa, sb)[0].startsWith("Dekompresní povinnost podobná") && diffRows(sa, sb).every((r) => r.weight === 0), "porovnání stejných ponorů");
  const sc = { ...sb, ttsMax: sb.ttsMax + 6, ambInt: sb.ambInt + 30, inert: sb.inert + 30, avgDepth: sb.avgDepth + 2 };
  const cs = conclusionSections("Já", "R", sa, sc);
  ok(cs[0].key === "deco" && cs[0].lines[0].startsWith("R: delší dekomprese") && cs[0].lines.some((x) => /vyšší průměrná hloubka/.test(x)), "závěr: delší deko kvůli průměrné hloubce");
  const cz = conclusionSections("Já", "R", sa, { ...sb, decoMin: sb.decoMin + 3, inert: sb.inert + 0.2 });
  ok(cz[0].lines.some((x) => x.startsWith("R: delší čas na zastávkách")) && cz[0].lines.some((x) => /prakticky stejná/.test(x)), "závěr: malý rozdíl zátěže se nerozkládá");
  const sd = { ...sb, ttsMax: sb.ttsMax + 8, ambInt: sb.ambInt + 40, inert: sb.inert + 40, avgDepth: sb.avgDepth + 3 };
  const g = groupConclusion(["já", "R", "D"], [sa, sb, sd]);
  ok(g.some((x) => x.startsWith("D:") && /delší dekomprese/.test(x)), "závěr skupiny: odchylka proti průměru");
  ok(multiRows([sa, sb, sd]).find((r) => r.key === "tts")!.hi === 2, "tabulka skupiny: nejvyšší hodnota");
  const l1 = emptyLogbook(), l2 = emptyLogbook(); l2.computers = { B94F4935: { id: "B94F4935", model: "Petrel 3", buddyId: "r", updated: 5 } };
  ok(mergeLogbooks(l1, l2).computers?.B94F4935?.buddyId === "r", "majitel cizího počítače se synchronizuje");
  l2.aliases = { "buddy:bara": { id: "buddy:bara", kind: "buddy", name: "Bára", targetId: "b1", updated: 3 } };
  ok(mergeLogbooks(l1, l2).aliases?.["buddy:bara"]?.targetId === "b1" && aliasKey("buddy", "Bára") === "buddy:bara", "přiřazení jmen z cizích logů se synchronizuje");
}

{ // hustota plynu: vzduch na hladině ~1,3 g/l, ve 20 m ~3,9 g/l
  const dn = gasDensity(d).filter((x): x is number => x != null);
  ok(Math.max(...dn) > 3.5 && Math.max(...dn) < 4.2, `hustota plynu ve 20 m (${Math.max(...dn)} g/l)`);
}

// ---- rozjetá O₂ čidla: klasifikace (vlhkost / jedno čidlo) a práh 3 min
{
  const { cellSpread, SPREAD_MIN } = await import("../src/core/analysis");
  const { cellIssueText } = await import("../src/core/compare");
  const mkSp = (f: (i: number) => [number, number, number]) => {
    const N = 360, t = [...Array(N).keys()].map((i) => i * 10);
    const c = t.map((_, i) => f(i));
    return { h: { rateS: 10, diveTimeS: N * 10 }, s: { t, depth: t.map(() => 30), ppo2: t.map(() => 1.3),
      mv1: c.map((x) => x[0] * 50), mv2: c.map((x) => x[1] * 50), mv3: c.map((x) => x[2] * 50) } } as any;
  };
  const ok1 = (i: number, a: number, b: number) => i >= a && i < b;
  const one = cellSpread(mkSp((i) => [ok1(i, 100, 124) ? 0.8 : 1.3, 1.3, 1.3]))!;
  ok(one.kind === "c1" && one.min >= SPREAD_MIN, `jedno čidlo 4 min → c1 (${one.kind}, ${one.min})`);
  const short = cellSpread(mkSp((i) => [ok1(i, 100, 112) ? 0.8 : 1.3, 1.3, 1.3]))!;
  ok(short.kind === "" && short.bands.length === 1, `podprahové 2 min → bez hlášky, jen pásmo (${short.kind})`);
  ok(cellIssueText(short.kind) === "", "podprahové rozjetí se do srovnání nedostane");
  const wet = cellSpread(mkSp((i) => ok1(i, 100, 130) ? [0.9, 1.3, 1.7] : [1.3, 1.3, 1.3]))!;
  ok(wet.kind === "wet" && wet.cells.join() === "1,3", `dvě čidla, srovnaná na konci → vlhkost (${wet.kind}, ${wet.cells})`);
  const multi = cellSpread(mkSp((i) => i >= 250 ? [0.9, 1.3, 1.7] : [1.3, 1.3, 1.3]))!;
  ok(multi.kind === "multi", `dvě čidla bez srovnání → vadná čidla (${multi.kind})`);
}

// ---- úklid dat cizích logů z mého logbooku
{
  const { cleanForeign, emptyLogbook, mergeLogbooks } = await import("../src/app/model");
  const lb = emptyLogbook();
  lb.sites = { s1: { id: "s1", name: "Lom Šifr", updated: 1 }, s2: { id: "s2", name: "Svobodné Heřmanice", updated: 1 }, s3: { id: "s3", name: "Moje bez ponorů", updated: 1 } };
  lb.buddies = { b1: { id: "b1", name: "Radek", updated: 1 }, b2: { id: "b2", name: "Peter", updated: 1 } };
  lb.notes = { d1: { siteId: "s1", buddyIds: ["b1"], note: "", updated: 1 }, "g:x1": { siteId: "s2", buddyIds: ["b2", "b1"], note: "", updated: 1 }, "g:x2": { siteId: "s1", buddyIds: [], note: "", updated: 1 } };
  const r = cleanForeign(lb, new Set(["d1"]), 100);
  ok(r.notes === 2 && !r.lb.notes["g:x1"] && !!r.lb.notes.d1, "úklid odstraní záznamy cizích ponorů");
  ok(!r.lb.sites.s2 && !r.lb.buddies.b2 && !!r.lb.sites.s1 && !!r.lb.buddies.b1 && !!r.lb.sites.s3, `odstraní jen jména použitá výhradně cizími záznamy (${r.names})`);
  const m = mergeLogbooks(r.lb, lb);
  ok(!m.notes["g:x1"] && !m.sites.s2, "úklid se při synchronizaci nevrátí ze serveru");
  ok(cleanForeign(r.lb, new Set(["d1"])).notes === 0, "úklid podruhé nic nedělá");
}

// ---- úplný reset logbooku
{
  const { resetLogbook, emptyLogbook, mergeLogbooks } = await import("../src/app/model");
  const lb = emptyLogbook();
  lb.sites = { s1: { id: "s1", name: "A", updated: 1 } }; lb.buddies = { b1: { id: "b1", name: "B", updated: 1 } };
  lb.notes = { d1: { siteId: "s1", buddyIds: ["b1"], note: "x", updated: 1 } };
  lb.aliases = { "site:a": { id: "site:a", kind: "site", name: "A", targetId: "s1", updated: 1 } as any };
  lb.computers = { C1: { id: "C1", model: "P3", buddyId: "b1", updated: 1 } as any };
  lb.cells = { c1: { updated: 1 } as any };
  const r = resetLogbook(lb, 10);
  ok(!Object.keys(r.sites).length && !Object.keys(r.notes).length && !Object.keys(r.aliases!).length && !Object.keys(r.computers!).length && !!r.cells.c1, "reset smaže jména a záznamy, čidla nechá");
  const m = mergeLogbooks(r, lb);
  ok(!m.sites.s1 && !m.notes.d1 && !m.aliases!["site:a"] && !m.computers!.C1, "stará data se po resetu synchronizací nevrátí");
}

// ---- párování při posunu hodin o hodinu (letní/zimní čas)
{
  const { nearestPair } = await import("../src/app/store");
  const prof = [0, 4, 4.8, 5, 5, 4.9, 5.4, 9.8, 14.9, 15, 15.2, 14.8, 15, 15, 15, 14, 13, 12, 12, 12, 12, 12];
  const flat = prof.map(() => 30);
  const m: any = { id: "m", start: 100000, prof }, g1: any = { id: "g1", start: 100000 - 56 * 60, prof }, g2: any = { id: "g2", start: 100000 + 10 * 60, prof: flat };
  ok(nearestPair([g1, g2], m)[0]?.id === "g1", "spáruje se i s posunem hodin −56 min, když sedí profil");
  ok(nearestPair([{ id: "x", start: 100000 + 100 * 60, prof }] as any, m).length === 0, "mimo ±90 min se nepáruje");
  ok(nearestPair([{ id: "y", start: 100000 + 40 * 60 }] as any, { id: "m", start: 100000 } as any).length === 0, "bez profilu jen do ±20 min");
}

// ---- nízké pO₂ při zanoření: dohánění setpointu vs. podezření na hypoxii
{
  const { startPo2 } = await import("../src/core/analysis");
  const mk = (po2: (t: number) => number, depth: (t: number) => number, o2p: (t: number) => number = () => 150) => {
    const t = [...Array(120).keys()].map((i) => i * 5);
    return { h: { rateS: 5, diveTimeS: 600 }, s: { t, ppo2: t.map(po2), depth: t.map(depth), sp: t.map(() => 0.5), o2p: t.map(o2p) } } as any;
  };
  const ok1 = startPo2(mk((t) => (t < 15 ? 0.35 : 0.5), (t) => Math.min(2 + t / 10, 15)));
  ok(ok1.level === "info", `krátce pod 0,4 → jen informace (${ok1.level})`);
  const w = startPo2(mk((t) => (t < 40 ? 0.27 : 0.5), (t) => Math.min(2 + t / 10, 15)));
  ok(w.level === "warn", `0,27 bar 40 s → varování (${w.level})`);
  const flat = startPo2(mk((t) => (t < 150 ? 0.3 : 0.5), (t) => Math.min(1.5 + t / 15, 15)));
  ok(flat.level === "bad" && flat.reasons.some((r) => r.includes("neroste")), `pO₂ při zanořování neroste → hypoxie (${flat.reasons})`);
  const hyp = startPo2(mk((t) => (t < 30 ? 0.18 : 0.5), () => 2));
  ok(hyp.level === "bad", "pO₂ pod 0,21 → hypoxie");
  const closed = startPo2(mk((t) => (t < 40 ? 0.33 : 0.5), () => 2, (t) => (t < 40 ? 0 : 150)));
  ok(closed.level === "bad" && closed.reasons.includes("tlak O₂ 0 bar"), `tlak O₂ 0 → hypoxie (${closed.reasons})`);
}

// ---- sloučení upozornění ke stejnému čidlu
{
  const { mergeCellAlerts } = await import("../src/core/cells");
  const r = mergeCellAlerts([
    { level: "warn", title: "Podezření na nefunkční čidlo 1", text: "Čidlo 1 se odchyluje od ostatních – rozdíl až 0,56 bar (19. min), nad 0,3 bar celkem 18,6 min. Zkontroluj nebo vyměň čidlo." },
    { level: "bad", title: "Problém s čidlem 1", text: "Citlivost prudce klesla o 30 %. Vyměň čidlo." },
    { level: "warn", title: "Vysoké CO₂", text: "x" },
  ]);
  ok(r.length === 2 && r[0].level === "bad" && r[0].title === "Problém s čidlem 1", "upozornění ke stejnému čidlu se sloučí, červené má přednost");
  ok(r[0].text.includes("Citlivost") && r[0].text.includes("V ponoru se odchyluje") && r[0].text.endsWith("Vyměň čidlo.") && r[0].text.split("Vyměň čidlo").length === 2, `oba popisy, jedno doporučení (${r[0].text})`);
}

// ---- varování zobrazená na počítači (události 0/1/2)
{
  const { computerWarnings, deviatingCell } = await import("../src/core/compwarn");
  const d: any = { h: { diveTimeS: 600 }, s: { t: [0, 10, 20], mv1: [70, 70, 70], mv2: [70, 70, 70], mv3: [50, 50, 50] }, alarms: [],
    buttons: [{ t: 31, btn: 1, from: 0xb3, to: 0xb3 }, { t: 33, btn: 1, from: 0xb3, to: 0xb3 }],
    events: [
      { t: 1, kind: "0", payload: "00 00 00 02 00 20 00 00" }, { t: 1, kind: "0", payload: "00 00 00 02 00 60 00 00" },
      { t: 31, kind: "1", payload: "00 00 00 02 00 20 00 00" }, { t: 33, kind: "1", payload: "00 00 00 02 00 60 00 00" },
      { t: 100, kind: "0", payload: "00 00 00 00 00 00 10 00" }, { t: 200, kind: "0", payload: "00 00 00 00 00 00 00 80" },
    ] };
  const w = computerWarnings(d);
  ok(w.length === 4 && w[0].label === "Nízký tlak O₂" && w[0].how === "ack" && w[0].end === 31, "nízký tlak O₂ zobrazen v 1. s, potvrzen ve 31. s");
  ok(w[1].label === "Nízký tlak diluentu" && w[1].end === 33, "nízký tlak diluentu jako samostatné varování");
  ok(w[2].kind === "cellout" && w[2].c === "P" && w[2].how === "open", "vyřazené čidlo (P), nepotvrzeno");
  ok(w[3].kind === "unknown" && w[3].label.includes("B7 0x80"), "neznámý bit s kódem");
  ok(deviatingCell(d, 20)?.cell === 3, "číslo vyřazeného čidla z průběhu mV");
}

// ---- tagy v seznamu ponorů podle kategorií
{
  const { diveTagsOf, cellsIn } = await import("../src/core/tags");
  const t = diveTagsOf([
    { level: "warn", title: "Souvislost CO₂", text: "" }, { level: "bad", title: "Vysoké CO₂", text: "" },
    { level: "warn", title: "Hlášení CO₂ z počítače (P)", text: "" }, { level: "bad", title: "Podezření na vlhkost na čidlech (zatékání?)", text: "Odchylují se čidla 1 a 3 najednou" },
    { level: "warn", title: "Vyřazené čidlo 2 (P)", text: "" }, { level: "warn", title: "Klesání s vysokým setpointem", text: "" },
    { level: "warn", title: "Nízký tlak O₂ (23 bar)", text: "" }, { level: "warn", title: "Slabá baterie", text: "" },
    { level: "bad", title: "Podezření na hypoxii při zanoření – zkontroluj ventil O₂", text: "" }, { level: "info", title: "Velmi hustý plyn", text: "" },
  ]);
  ok(t.map((x) => x.label).join(",") === "pO₂,CO₂,ČIDLO 1 2 3,TLAK,BAT,SP", `pořadí a sloučení kategorií (${t.map((x) => x.label)})`);
  ok(t.find((x) => x.cat === "CO₂")!.level === "bad" && t.find((x) => x.cat === "SP")!.level === "warn", "barva podle nejzávažnějšího");
  ok(cellsIn("Problém s čidlem 1").join() === "1", "číslo čidla z nadpisu");
}

// ---- otevírání / zavírání onboard lahve během ponoru (test lahve s externím O₂)
{
  const { pressureAnalysis } = await import("../src/core/analysis");
  const t = [...Array(240).keys()].map((i) => i * 5);
  // 0–5 min onboard (150 → 145), zavřeno 5–10 min (mezitlak 9), znovu otevřeno 10–15 min (145 → 140), zavřeno do konce
  const p = t.map((x) => x < 300 ? 150 - x / 60 : x < 320 ? 150 - (x - 300) * 7 : x < 600 ? 9 : x < 900 ? 145 - (x - 600) / 60 : x < 920 ? 140 - (x - 900) * 6.5 : 9);
  const r = pressureAnalysis(t, p, 1200);
  ok(r.use.ok && r.use.bar >= 8 && r.use.bar <= 14, `spotřeba jen z otevřené onboard lahve (${r.use.bar} bar)`);
  ok(r.valve.map((v) => v.kind).join(",") === "close,open,close", `zavřeno, otevřeno, zavřeno (${r.valve.map((v) => v.kind)})`);
}

// ---- víc počítačů jednoho buddyho: seskupení a ponory se 2 počítači
{
  const { groupGuests } = await import("../src/app/store");
  const { emptyLogbook } = await import("../src/app/model");
  const prof = [0, 4, 4.8, 5, 5, 4.9, 5.4, 9.8, 14.9, 15, 15.2, 14.8, 15, 15, 15, 14, 13, 12, 12, 12, 12, 12];
  const mk = (id: string, start: number) => ({ id, start, prof, num: 1, h: {} as any, sum: {} as any, inj: 0, cells: {} as any, v: 0 }) as any;
  const lb = emptyLogbook(); lb.buddies = { b1: { id: "b1", name: "Pepa", updated: 1 } };
  lb.computers = { A: { id: "A", model: "Petrel 3", buddyId: "b1", updated: 1 }, B: { id: "B", model: "Perdix", buddyId: "b1", updated: 1 } };
  const L = (id: string, serial: string, metas: any[]) => ({ log: { id, name: id, count: metas.length, added: 0, serial, model: serial === "A" ? "Petrel 3" : "Perdix" }, metas, lb: emptyLogbook() });
  const g = groupGuests([L("la", "A", [mk("a1", 1000), mk("a2", 100000), mk("a3", 200000)]), L("lb", "B", [mk("b1", 1030), mk("b2", 300000)])], lb);
  ok(g.length === 1 && g[0].log.logs?.length === 2, "dva počítače jednoho majitele = jedna skupina");
  ok(g[0].metas.length === 4 && g[0].alts.length === 1 && g[0].metas.find((m) => m.id === "a1")?.alt === "b1", "stejný ponor ze dvou počítačů se zobrazí jednou (hlavní + alt)");
  ok(g[0].metas.find((m) => m.id === "b2")?.comp === "Perdix B", "ponor ze záložního počítače s označením počítače");
  lb.computers.B.primary = true;
  const g2 = groupGuests([L("la", "A", [mk("a1", 1000), mk("a2", 100000), mk("a3", 200000)]), L("lb", "B", [mk("b1", 1030), mk("b2", 300000)])], lb);
  ok(g2[0].log.id === "lb" && g2[0].metas.find((m) => m.id === "b1")?.alt === "a1", "hlavní počítač podle volby");
  const g3 = groupGuests([L("la", "A", [mk("a1", 1000)]), L("lc", "C", [mk("c1", 1000)])], lb);
  ok(g3.length === 2, "počítač bez stejného majitele zůstává zvlášť");
}

// ---- zarovnání srovnání podle prvních 10 minut (buddy skončil dřív)
{
  const { profileLag } = await import("../src/core/compare");
  const mk = (start: number, dur: number) => { const t = [...Array(dur / 10 + 1).keys()].map((i) => i * 10); return { h: { start, diveTimeS: dur }, s: { t, depth: t.map((x) => (x < 300 ? x / 10 : x < dur - 300 ? 30 + 5 * Math.sin(x / 200) : (dur - x) / 10)) } } as any; };
  const a = mk(0, 3600), b = mk(356, 2400);
  b.s.depth = b.s.t.map((x: number) => (x < 300 ? x / 10 : x < 2100 ? 30 + 5 * Math.sin(x / 200) : (2400 - x) / 10));
  const r = profileLag(a, b);
  ok(r.real === 0 && r.rmse < 1, `buddy skončil o 20 min dřív – posun podle začátku 0 s (${r.real}, ${r.rmse.toFixed(2)})`);
}
// ---- spojené ponory
{
  const { segGroups, mergeDives } = await import("../src/core/segments");
  const m = (id: string, start: number, dur: number, cnum?: number, serial = 1) => ({ id, start, cnum, h: { serial, diveTimeS: dur } });
  const ms = [m("a", 0, 400, 30), m("b", 450, 400, 30), m("c", 900, 400, 30), m("d", 5000, 1200, 31), m("e", 6500, 600, 32), m("f", 20000, 600, 33)];
  const g = segGroups(ms, 30);
  ok(g.parts.get("a")!.length === 3 && g.head.get("c") === "a", "stejné číslo z Cloudu = jeden ponor");
  ok(g.parts.get("d")!.length === 2, "povrchový interval do 30 min = jeden ponor");
  ok(g.parts.get("f")!.length === 1, "delší interval = samostatný ponor");
  ok(segGroups(ms, 30, { e: false }).parts.get("e")!.length === 1, "ruční oddělení má přednost");
  ok(segGroups(ms, 0, { f: true }).parts.get("d")!.map((x) => x.id).join() === "d,e,f".slice(0, 1) + "" || segGroups(ms, 0, { f: true }).head.get("f") === "e", "ruční spojení s předchozím");
  const dv = (start: number, dur: number) => ({ id: "x", h: { start, diveTimeS: dur, maxDepth: dur / 100, end: start + dur }, s: { t: [0, dur], depth: [0, dur / 100] }, events: [{ t: 5, kind: "0", label: "", payload: "" }], alarms: [], buttons: [], tissues: [] }) as any;
  const md = mergeDives([dv(0, 400), dv(450, 400)]) as any;
  ok(md.s.t.join() === "0,400,450,850" && md.h.diveTimeS === 850 && md.surf[0].from === 400 && md.events[1].t === 455, "spojení dekódovaných částí s posunem času");
}

{ // výměna baterie Petrelu
  const { batSwapped, batSinceSwap, batSwapInfo } = await import("../src/core/analysis");
  const b = (start: number, v0: number, v1: number, p0: number, p1: number, type = 2) => ({ start, batTypeCode: type, batType: type === 2 ? "Lithiová 1,5 V" : "NiMH", batVStart: v0, batVEnd: v1, batPctStart: p0, batPctEnd: p1, batWarn: 1.37, batCrit: 1.3, scrubTotalMin: 180, scrubLeftEndMin: 180 }) as any;
  const hs = [b(1, 1.64, 1.6, 90, 85), b(2, 1.55, 1.5, 75, 70), b(3, 1.48, 1.45, 64, 60), b(4, 1.44, 1.42, 58, 55), b(5, 1.45, 1.44, 50, 48), b(6, 1.50, 1.50, 100, 100)];
  ok(batSwapped(hs[4], hs[5]) && !batSwapped(hs[3], hs[4]), "výměna baterie podle skoku napětí a procent");
  ok(batSinceSwap(hs).length === 1, "ponory od výměny");
  ok(!alerts(hs, 10, DEFAULT_THRESHOLDS).some((a) => a.kind === "battery"), "po výměně žádné „Baterie slábne“");
  ok(alerts(hs.slice(0, 5), 10, DEFAULT_THRESHOLDS).some((a) => a.title === "Baterie slábne"), "lithiová pod 50 % slábne");
  ok(!alerts(hs.slice(0, 5), 10, DEFAULT_THRESHOLDS, null, 6).some((a) => a.kind === "battery"), "ruční výměna skryje upozornění");
  ok(alerts(hs.slice(0, 5), 10, DEFAULT_THRESHOLDS, null, 4).some((a) => a.kind === "battery"), "ruční výměna před posledním ponorem neplatí");
  ok(/1,44 V \/ 48 % → 1,50 V \/ 100 %/.test(batSwapInfo(hs[4], hs[5])!.text), "text o výměně");
}

{ // zapisovač SQLite: zpětné čtení vlastní čtečkou (dlouhé záznamy přes přetečení, víc stránek)
  const { writeSqlite } = await import("../src/core/sqlitew");
  const { SqliteFile } = await import("../src/core/sqlite");
  const rows = Array.from({ length: 120 }, (_, i) => [`id${i}`, `Petrel 3[AB]#${i}`, new Uint8Array(i % 5 ? 300 : 9000).map((_, j) => (i * 7 + j) & 255), i - 60, i / 4]);
  const buf = writeSqlite([{ name: "log_data", sql: "CREATE TABLE log_data (log_id TEXT, file_name TEXT, data_bytes_1 BLOB, n INTEGER, f REAL)", rows }]);
  const back = new SqliteFile(buf).rows("log_data");
  ok(back.length === 120 && back.every((r, i) => r.log_id === rows[i][0] && r.n === rows[i][3] && r.f === rows[i][4] && (r.data_bytes_1 as Uint8Array).length === (rows[i][2] as Uint8Array).length && (r.data_bytes_1 as Uint8Array).every((v, j) => v === (rows[i][2] as Uint8Array)[j])), "SQLite zapisovač: zpětné čtení");
}

{ // vysoké pO₂ – vlastní detekce (mimo deko zastávky)
  const { po2HighZones, po2HiHist, po2HiLevel } = await import("../src/core/analysis");
  const t = [...Array(361).keys()].map((i) => i * 10); // 60 min
  // 0–20 min dno 30 m, 20–40 min výstup na 6 m (zastávka), pO₂ 1,45 na dně 10.–13. min, 1,5 na zastávce, 1,65 krátce ve 15. min
  const depth = t.map((x) => (x < 1200 ? 30 : x < 1500 ? 30 - ((x - 1200) / 300) * 24 : x < 3400 ? 6 : 0));
  const ppo2 = t.map((x) => (x >= 600 && x < 780 ? 1.45 : x >= 900 && x < 920 ? 1.65 : x >= 1600 && x < 3000 ? 1.5 : 1.2));
  // strop i zastávka už na dně (deko ponor) – dno se přesto za zastávku nepočítá
  const d = { h: { diveTimeS: 3500 }, s: { t, depth, ppo2, ceil: t.map((x) => (x < 3400 ? 6 : 0)), stop: t.map((x) => (x < 3400 ? 6 : 0)) } } as any;
  const z = po2HighZones(d, {});
  ok(z.some((x) => x.level === "warn" && x.from === 600) && !z.some((x) => x.level === "warn" && x.from >= 1600), "nad 1,4 na dně → žlutě, na zastávce ne");
  ok(z.some((x) => x.level === "bad" && x.from === 900), "nad 1,6 → červeně");
  const hist = po2HiHist(d);
  ok(hist[2] >= 170 && po2HiLevel({ ppo2Max: 1.5, po2Hi: hist }, {}) === "warn" && po2HiLevel({ ppo2Max: 1.65, po2Hi: hist }, {}) === "bad", `souhrn pro tag (${hist})`);
}

{ // vysoké pO₂ dané diluentem v hloubce – nevaruje se, nad 1,6 ano
  const { po2HighZones, po2DilZones } = await import("../src/core/analysis");
  const t = [...Array(181).keys()].map((i) => i * 10);
  const depth = t.map((x) => (x < 1200 ? 62 : 3)); // vzduch v 62 m → pO₂ diluentu ≈ 1,49
  const ppo2 = t.map((x) => (x < 300 ? 1.45 : x < 600 ? 1.55 : x < 900 ? 1.75 : 1.2)); // 1,55 při diluentu 1,49 = diluent; 1,75 = O₂ navíc
  const d = { h: { diveTimeS: 1700, surfP: 1013, salinity: 1000 }, s: { t, depth, ppo2, o2: t.map(() => 21), ceil: t.map(() => 0), stop: t.map(() => 0) } } as any;
  const z = po2HighZones(d, {}), dz = po2DilZones(d, {});
  ok(dz.length === 1 && dz[0].from === 0 && dz[0].to === 600, `úsek z diluentu 0–600 s (${JSON.stringify(dz)})`);
  ok(!z.some((x) => x.level === "warn" && x.from < 600) && z.some((x) => x.level === "bad" && x.from === 600), "diluent nevaruje, nad 1,6 červeně");
}

{ // formát délky a doplnění diluentu při klesání
  const { dur, tpt } = await import("../src/core/analysis");
  const { dilVents } = await import("../src/core/effort");
  ok(dur(44) === "44 s" && dur(135) === "2 min 15 s" && dur(120) === "2 min" && tpt(135) === "2′15″", "formát: délka 2 min 15 s, okamžik 2′15″");
  const t = [...Array(61).keys()].map((i) => i * 5);
  const mk = (depth: number[]) => ({ h: { diveTimeS: 400 }, s: { t, depth, dil: t.map((x) => (x < 100 ? 150 : 147)) } }) as any;
  ok(dilVents(mk(t.map(() => 20))).length === 1, "doplnění diluentu ve stálé hloubce");
  ok(dilVents(mk(t.map((x) => (x < 80 ? 20 : x < 110 ? 20 + (x - 80) / 10 : 23 - (x - 110) / 10)))).length === 0, "ADV při klesání (i s návratem) se nepočítá");
}

{ // Gauge mód (Peregrine, pSCR): bez čidel – žádná varování o pO₂, setpointu, čidlech; odhad smyčky pSCR
  const { diveWarnings, summarize, DEFAULT_THRESHOLDS } = await import("../src/core/analysis");
  const { isCC, hasDeco, defaultRig, pscrLoopPo2, supplyPo2, isSupported, rigsForMode } = await import("../src/core/rig");
  const { decoderFor } = await import("../src/core/decoders");
  const t = [...Array(241).keys()].map((i) => i * 5);
  const depth = t.map((x) => (x < 60 ? x / 6 : x < 1000 ? 20 : Math.max(0, 20 - (x - 1000) / 10)));
  const P = depth.map((z) => 1.013 + z * 0.0981);
  const z0 = t.map(() => 0), n0 = t.map(() => null);
  const d = { id: "g", h: { mode: "Gauge", diveTimeS: 1200, surfP: 1013, salinity: 1000, gfLo: 30, gfHi: 70, spLo: 0.7, spHi: 1.3, batWarn: 0, batCrit: 0, scrubTotalMin: 0, maxDepth: 20, rateS: 5 },
    s: { t, depth, ppo2: P.map((p) => Math.round(0.21 * p * 100) / 100), sp: t.map(() => 0.7), mv1: t.map(() => 55), mv2: t.map(() => 44), mv3: t.map(() => 33), o2: t.map(() => 21), he: z0,
      temp: t.map(() => 10), cns: z0, gf99: z0, ceil: z0, stop: z0, stopt: t.map(() => 99), tts: z0, at5: z0, st: t.map(() => 18), bv: z0, bp: z0, dil: n0, o2p: n0, co2: n0, co2raw: n0 },
    tissues: [], events: [], alarms: [], buttons: [] } as any;
  const w = diveWarnings(d, summarize(d), DEFAULT_THRESHOLDS);
  ok(!isCC(d.h) && !hasDeco(d.h) && defaultRig(d.h) === "pSCR" && !rigsForMode("Gauge").includes("eCCR"), "Gauge: bez čidel, bez deko, výchozí pSCR, bez eCCR");
  ok(isSupported(d.h, "pSCR") && !isSupported(d.h, "OC") && isSupported({ mode: "CCR" } as any, "eCCR") && !isSupported({ mode: "OC" } as any, "OC"), "podporované typy ponoru: CC+eCCR, Gauge+pSCR");
  ok(!w.some((x) => /hypoxi|pO₂ při zanoření|etpoint|Čidlo|čidl/.test(x.title)), `Gauge: žádná varování z čidel ani setpointu (${w.map((x) => x.title).join(", ")})`);
  const sup = supplyPo2(d, 40), lo = pscrLoopPo2(d, 40, 8, 20), hi = pscrLoopPo2(d, 40, 8, 30);
  const k = 200; // 20 m
  ok(lo[k]! < hi[k]! && hi[k]! < sup[k], `pSCR: smyčka pod zásobním plynem, úsporné dýchání nejníž (${lo[k]}, ${hi[k]}, ${sup[k]})`);
  ok(pscrLoopPo2(d, 40, 8, 20)[0]! < pscrLoopPo2(d, 40, 8, 20)[k]! / 2, "pSCR: u hladiny výrazně nižší pO₂ (riziko hypoxie)");
  ok(decoderFor(new TextEncoder().encode("SQLite format 3\0xxxxxxxxxx"))?.id === "shearwater" && decoderFor(new Uint8Array(32)) === null, "dekodér podle souboru");
}

{ // tlaky z vysílačů AI: role podle jména v hlavičce (0x16), bez jmen nevyužít
  const { aiRoles } = await import("../src/core/shearwater");
  const t1 = Array.from({ length: 20 }, (_, i) => 200 - i), t2 = Array.from({ length: 20 }, (_, i) => 180 - i * 2);
  const hdr = (a: string, b: string) => { const r = new Uint8Array(32); r[20] = a.charCodeAt(0); r[21] = a.charCodeAt(1); r[23] = b.charCodeAt(0); r[24] = b.charCodeAt(1); return r; };
  const jj = aiRoles(hdr("D1", "O2"), t1, t2), sw = aiRoles(hdr("O2", "D1"), t1, t2), none = aiRoles(hdr("T1", "T2"), t1, t2);
  ok(jj?.dil === t1 && jj?.o2 === t2 && sw?.dil === t2 && none === null, "AI: D1/O2 podle jména, T1/T2 bez role");
}

{ // pokles diluentu při sestupu (do 90 % max. hloubky)
  const { dilDescent } = await import("../src/core/analysis");
  const depth = [0, 10, 30, 50, 60, 60, 40, 5], dil = [200, 195, 185, 176, 175, 175, 176, 178];
  const d = { s: { depth, dil } } as unknown as Parameters<typeof dilDescent>[0];
  ok(dilDescent(d) === 25, "Sestup: pokles diluentu 200 → 175 bar = 25");
  ok(dilDescent({ s: { depth, dil: dil.map(() => null) } } as unknown as Parameters<typeof dilDescent>[0]) === null, "Sestup: bez tlaků null");
}

{ // Bluetooth protokol Shearwater: SLIP, LRE+XOR, manifest, obal ponoru, simulované stažení
  const P = await import("../src/core/swproto");
  // SLIP: escapování a rámce V1 s hlavičkou
  const data = Uint8Array.from([0xff, 0x01, 0x04, 0x00, 0xc0, 0xdb, 0x22, ...Array(30).fill(7)]);
  const fr = P.slipFrames(data, 1);
  ok(fr.every((f) => f.length <= 20) && fr[1][1] === 1 && P.slipFrames(Uint8Array.from([0x22, 0x80, 0x10]), 1).length === 1, "SLIP V1: rámce po 20 B s hlavičkou");
  const rd = new P.SlipReader(1); fr.forEach((f) => rd.push(f));
  ok(rd.packets.length === 1 && rd.packets[0].join() === data.join(), "SLIP V1: zpětné složení paketu");
  ok(P.unwrapResponse(Uint8Array.from([1, 0xff, 3, 0, 9, 8]), 1).join() === "9,8", "Odpověď 01 FF: délka");
  // LRE kompresor pro test (9bitové hodnoty, běhy nul, 0 = konec) + XOR
  const lreEnc = (d: Uint8Array) => { const vals: number[] = []; for (let i = 0; i < d.length;) { if (d[i] === 0) { let n = 0; while (i < d.length && d[i] === 0 && n < 255) { n++; i++; } vals.push(n); } else vals.push(0x100 | d[i++]); } vals.push(0);
    while ((vals.length * 9) % 8) vals.push(0); const bits = vals.map((v) => v.toString(2).padStart(9, "0")).join(""); const out = new Uint8Array(bits.length / 8); for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2); return out; };
  const xorEnc = (d: Uint8Array) => { const o = d.slice(); for (let i = o.length - 1; i >= 32; i--) o[i] ^= d[i - 32]; return o; };
  // skutečný ponor z mého logu, pokud je k dispozici (repo dat neobsahuje)
  const f = Bun.file("/home/claude/data/sw.db");
  if (await f.exists()) {
    const { readShearwaterDb, decodeDive, gunzip } = await import("../src/core/shearwater");
    const raw = readShearwaterDb(new Uint8Array(await f.arrayBuffer())).at(-1)!;
    const native = await gunzip(raw.blob.subarray(4), raw.blob[0] | (raw.blob[1] << 8) | (raw.blob[2] << 16));
    const comp = lreEnc(xorEnc(native));
    // simulovaný počítač: manifest se 2 ponory, druhý stáhnout
    const man = new Uint8Array(0x600); const start = (native[12 + native.indexOf(0x10)] << 24) >>> 0;
    const rec = (i: number, fp: number, addr: number) => { man.set([0xa5, 0xc4], i * 32); man.set([fp >>> 24, (fp >> 16) & 255, (fp >> 8) & 255, fp & 255], i * 32 + 4); man.set([addr >>> 24, (addr >> 16) & 255, (addr >> 8) & 255, addr & 255], i * 32 + 20); };
    const o10 = native.findIndex((_, i) => i % 32 === 0 && native[i] === 0x10); const fp = ((native[o10 + 12] << 24) | (native[o10 + 13] << 16) | (native[o10 + 14] << 8) | native[o10 + 15]) >>> 0;
    rec(0, 111, 0x100); rec(1, fp, 0x2000);
    let src = new Uint8Array(0), pos = 0, blk = 0;
    const tx: import("../src/core/swproto").Transfer = async (q) => {
      if (q[0] === 0x35) { const addr = ((q[3] << 24) | (q[4] << 16) | (q[5] << 8) | q[6]) >>> 0; src = addr === P.MANIFEST_ADDR ? man : addr === 0x80002000 ? comp : new Uint8Array(0); pos = 0; blk = 0; return Uint8Array.from([0x75, 0x10, 0xfe]); }
      if (q[0] === 0x36) { blk++; const chunk = src.subarray(pos, pos + 0xf9 - ((0xf9) % 9)); pos += chunk.length; return Uint8Array.from([0x76, q[1], ...chunk]); }
      return Uint8Array.from([0x77, 0]);
    };
    const m = P.parseManifest(await P.download(tx, 1, P.MANIFEST_ADDR, P.MANIFEST_SIZE, false));
    ok(m.dives.length === 2 && m.dives[1].fp === fp && m.dives[1].addr === 0x2000 && !m.full, "Manifest: 2 ponory, otisk = začátek ponoru");
    const got = await P.download(tx, 1, 0x80000000 + 0x2000, P.DIVE_SIZE, true);
    ok(got.length >= native.length && got.subarray(0, native.length).join() === native.join(), "Stažení: LRE + XOR vrátí nativní data");
    const d1 = await decodeDive(raw), d2 = await decodeDive({ id: "ble", blob: await P.wrapBlob(got) });
    ok(d2.h.start === d1.h.start && d2.h.start === fp && d2.s.depth.length === d1.s.depth.length && d2.h.serial === d1.h.serial, "Obal ponoru: dekodér přečte stažený ponor stejně jako z Cloudu");
    // přerušení uprostřed ponoru: navázání nekomprimovaným čtením zbytku (simulovaný počítač)
    let fail = 6, mode = 0, raw0 = 0, rsize = 0;
    const tx2: import("../src/core/swproto").Transfer = async (q) => {
      if (q[0] === 0x35) { const addr = ((q[3] << 24) | (q[4] << 16) | (q[5] << 8) | q[6]) >>> 0; mode = q[1]; pos = 0; rsize = (q[7] << 16) | (q[8] << 8) | q[9]; raw0 = addr - 0x80002000; return Uint8Array.from([0x75, 0x10, 0xfe]); }
      if (q[0] === 0x36) {
        if (fail-- === 0) throw new Error("GATT Server is disconnected");
        const n = 0xf9 - (0xf9 % 9);
        const chunk = mode ? comp.subarray(pos, pos + n) : native.subarray(raw0 + pos, raw0 + Math.min(pos + n, rsize));
        pos += chunk.length; return Uint8Array.from([0x76, q[1], ...chunk]);
      }
      return Uint8Array.from([0x77, 0]);
    };
    const ds: import("../src/core/swproto").DiveState = { have: null };
    let err = ""; try { await P.downloadDive(tx2, 1, 0x80002000, ds); } catch (e) { err = (e as Error).message; }
    const part = ds.have?.length || 0;
    fail = 1e9;
    const got2 = await P.downloadDive(tx2, 1, 0x80002000, ds);
    const end = P.nativeEnd(native);
    ok(err.includes("disconnected") && part > 0 && part % 32 === 0 && ds.resumed === true && got2.length === end && got2.join() === native.subarray(0, end).join(), "Bluetooth: po přerušení naváže a složí stejný ponor");
    // ztracená odpověď na blok: stejný blok se vyžádá znovu (K6)
    let lost = 1, blkSeen = 0;
    const txLoss: import("../src/core/swproto").Transfer = async (q) => {
      if (q[0] === 0x36 && ++blkSeen === 5 && lost-- > 0) throw new Error("Počítač neodpovídá (časový limit)");
      return tx(q);
    };
    const got4 = await P.download(txLoss, 1, 0x80002000, P.DIVE_SIZE, true);
    ok(lost === 0 && got4.subarray(0, native.length).join() === native.join(), "Bluetooth: ztracená odpověď – blok se vyžádá znovu a ponor je celý");
    // počítač nekomprimované čtení odmítne → stáhne celý znovu
    const ds2: import("../src/core/swproto").DiveState = { have: native.slice(0, 320) };
    const txNo: import("../src/core/swproto").Transfer = async (q) => (q[1] === 0 && q[0] === 0x35 ? Uint8Array.from([0x7f, 0x35, 0x22]) : tx2(q));
    const got3 = await P.downloadDive(txNo, 1, 0x80002000, ds2);
    ok(ds2.noTail === true && got3.subarray(0, native.length).join() === native.join(), "Bluetooth: bez podpory navázání stáhne ponor znovu celý");
  }
}

{ // úplnost staženého ponoru (hlavička, patička, závěrečný záznam)
  const { diveComplete } = await import("../src/app/ble");
  const rec = (t: number) => { const r = new Uint8Array(32); r[0] = t; return r; };
  const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.length * 32); a.forEach((x, i) => o.set(x, i * 32)); return o; };
  ok(diveComplete(cat(rec(0x10), rec(1), rec(0x20), rec(0xff))) && !diveComplete(cat(rec(0x10), rec(1), rec(1))), "Bluetooth: neúplný ponor se pozná");
}

{ // skrytí upozornění u ponoru: titul, kategorie, vyprázdněná kategorie
  const { isHiddenW, withEmptiedCats } = await import("../src/core/tags");
  const all = ["Problém s čidlem 1", "Alarm CO₂ – 2×"];
  const k = withEmptiedCats(["t:Problém s čidlem 1"], all);
  ok(isHiddenW("Problém s čidlem 1", k) && isHiddenW("Čidlo 1 rozjeté", k) && !isHiddenW("Alarm CO₂", k) && isHiddenW("Alarm CO₂ – 2×", ["c:CO₂"]), "Skrytí upozornění: titul, kategorie a vyprázdněný tag");
}

{ // čas stisku tlačítka po hodině ponoru (hodiny v záznamu jen mm:ss)
  const { buttonTime } = await import("../src/core/shearwater");
  const start = 20 * 60 + 23; // ponor začal v xx:20:23
  ok(buttonTime(39, 50, start, 1235) === 1167 && buttonTime(39, 5, start, 4790) === 4722 && buttonTime(19, 41, start, 35) === -42, "Tlačítka: hodina podle pozice v logu (78′42″ ne 18′42″)");
}

{ // baterie v hlavě podle modelu rebreatheru
  const { ccrModel } = await import("../src/app/model");
  const x = ccrModel(undefined), f = ccrModel("flex2"), t = ccrModel("tp");
  ok(x.id === "xccr" && x.bats.length === 2 && x.bats[0].role === "solenoid" && x.bats[0].type!.includes("18650") && f.bats[1].type!.includes("18500") && t.bats.length === 0, "Baterie v hlavě: X-CCR výchozí, #1 solenoid, FLEX2 18500, TP bez baterií");
}

{ // spotřeba plynu ve srovnání (z tlaku on-board lahví)
  const f = Bun.file("/home/claude/data/sw.db");
  if (await f.exists()) {
    const { readShearwaterDb, decodeDive } = await import("../src/core/shearwater");
    const raws = readShearwaterDb(new Uint8Array(await f.arrayBuffer()));
    const d = await decodeDive(raws.at(-1)!);
    const s1 = diveStats(d);
    const rows = multiRows([s1, { ...s1, dilBar: null }]);
    const r = rows.find((x) => x.key === "diluse")!;
    // poslední ponor: O₂ zavřená (jen mezitlak) → bez spotřeby O₂, diluent z tlaku
    ok(s1.o2Bar == null && s1.dilBar != null && s1.dilBar > 0 && r.muted === true && r.weight === 0 && r.vals[1] === "–", "Srovnání: spotřeba z tlaku (zavřená O₂ = –), chybějící údaj se nezapočítá");
  }
}

{ // A29, A33, A34, A35, A37
  const A = await import("../src/core/analysis");
  const mk = (depth: number[], extra: Partial<Record<string, unknown[]>> = {}) => {
    const n = depth.length;
    return { h: { diveTimeS: (n - 1) * 60, surfP: 1013, salinity: 1000 }, s: { t: depth.map((_, i) => i * 60), depth, dil: depth.map(() => null), o2p: depth.map(() => null), gf99: depth.map(() => null), tts: depth.map(() => 0), stop: depth.map(() => 0), ...extra } } as unknown as Parameters<typeof A.dilDescent>[0];
  };
  // sestup: výpadek tlaku diluentu → null; plynulý pokles → rozdíl
  const dep = [0, 10, 20, 30, 30, 20, 10, 0];
  ok(A.dilDescent(mk(dep, { dil: [190, 185, 180, 175, 175, 175, 175, 175] })) === 15 && A.dilDescent(mk(dep, { dil: [190, 185, 5, 3, 2, 2, 180, 180] })) === null, "Sestup: výpadek tlaku diluentu → –, jinak pokles");
  ok(A.pressGaps([190, 185, 3, 2, 180]).join() === "190,185,,,180", "Graf tlaků: výpadek = mezera");
  // SurfGF při vynoření = GF99 v prvním vzorku u hladiny, mělko < 7 m
  const sg = A.surfacing(mk([0, 20, 30, 20, 6, 3, 3, 0.5, 0], { gf99: [null, null, null, 40, 60, 66, 63, 58, 57] }));
  ok(sg.gf === 58 && sg.shallowMin === 3, "SurfGF: GF99 v prvním vzorku u hladiny, mělko 3 min");
  // bailout: nejhorší okamžik – nejhlubší a nejdelší TTS
  const B = await import("../src/core/bailout");
  { const Mo = await import("../src/app/model"); const tk = (p: object) => ({ id: "x", kind: "S80", vol: 11.1, mix: "AIR", updated: 0, ...p });
    ok(Mo.tankLowBar(tk({}) as never) === 170 && Mo.tankLowBar(tk({ onboard: "dil" }) as never) === 100 && Mo.tankLowBar(tk({ use: "fill" }) as never) == null && Mo.tankLowBar(tk({ fillBar: 300 }) as never, { fillPct: 80 }) === 240, "Lahve: hranice Doplnit (85 % z 200, RB 100, plnění –, vlastní tlak)"); }
  const GS = await import("../src/app/gas");
  ok(GS.gasDisp("vzduch") === "AIR" && GS.gasDisp("EAN50") === "EAN50" && GS.gasColorOf("O₂") === "#81d4fa" && GS.gasColorOf("vzduch") === GS.gasColorOf("AIR") && GS.gasColorOf("Argon") != null && B.gasLabelOf("21/0") === "AIR", "Plyny: AIR místo vzduch, barvy (O₂ světle modrá)");
  const prof = { t: [0, 60, 120, 180, 240], z: [0, 60, 60, 10, 0], tts: [0, 20, 30, 5, 0], stop: [0, 9, 12, 3, 0] };
  const o = { sac: 20, airMax: 40, ttsMul: 1 };
  // jen vzduch: v 60 m ho dýchat nejde → nedostatek „bez plynu“
  const p1 = B.bailoutPlan(prof, [{ mix: "21/0", liters: 2200 }], o);
  ok(p1.worst?.gas === B.NO_GAS && p1.worst.short > 0, `Bailout: vzduch v 60 m nejde dýchat (${p1.worst?.gas} ${p1.worst?.short} l)`);
  // TMX + EAN50: hluboko TMX, mělko EAN50; s dostatkem obou bez nedostatku
  const p2 = B.bailoutPlan(prof, [{ mix: "21/35", liters: 4000 }, { mix: "50/0", liters: 2000 }], o);
  ok(p2.gases.includes("21/35") && p2.gases.includes("50/0") && (p2.worst?.short ?? 0) <= 0 && p2.need["50/0"][2]! > 0, "Bailout: rozdělení TMX hluboko / EAN50 mělko, bez nedostatku");
  const p3 = B.bailoutPlan(prof, [{ mix: "21/35", liters: 300 }, { mix: "50/0", liters: 2000 }], { ...o, ttsMul: 1.5 });
  ok(p3.worst?.gas === "21/35" && p3.worst.short > 0, `Bailout: málo TMX → nedostatek TMX (${p3.worst?.short} l)`);
  // termíny revizí a servisů
  const M = await import("../src/app/model");
  ok(M.nextDue("2022-03-01", undefined, 5) === "2027-03-01" && M.nextDue("2022-03-01", "2026-01-01", 5) === "2026-01-01" && M.dueState("2000-01-01") === "over" && M.dueState(undefined) === "none", "Výstroj: příští termín a stav");
  // lahev z Výstroje: tlak po ponoru, zavřená on-board lahev se nepřepíše
  const G = await import("../src/app/gearSync");
  const lb = M.emptyLogbook();
  lb.tanks = { a: { id: "a", kind: "S80", vol: 11.1, mix: "vzduch", bar: 200, updated: 0 }, b: { id: "b", kind: "3 l", vol: 3, mix: "TMX 21/35", bar: 180, onboard: "dil", updated: 0 } };
  lb.notes.d1 = { buddyIds: [], note: "", updated: 1, prep: { tanks: [{ id: "x", role: "bo", name: "S80", gas: "vzduch", gearId: "a", bar: 200, end: 150 }] } };
  const meta = { id: "d1", start: 1700000000, h: { diveTimeS: 3600 }, sum: { dilStart: 8, dilEnd: 8, o2Start: 190, o2End: 120, gases: [{ mix: "21/35", s: 3000 }] } } as unknown as Parameters<typeof G.gearOnboardApply>[1];
  G.gearTankApply(lb, "d1", meta); G.gearOnboardApply(lb, meta, true);
  ok(lb.tanks.a.bar === 150 && lb.tanks.b.bar === 180 && !!lb.tanks.b.check, "Výstroj: off-board lahev převzala tlak po, zavřený diluent → zkontrolovat");
  // A38: rozpoznání on-board lahve – diluent podle směsi a tlaku, O₂ se zavřenou lahví nejde
  const lb2 = M.emptyLogbook();
  lb2.tanks = {
    a1: { id: "a1", name: "RB DIL 1", kind: "3 l", vol: 3, mix: "vzduch", bar: 150, onboard: "dil", updated: 0 },
    a2: { id: "a2", name: "RB DIL 2", kind: "3 l", vol: 3, mix: "vzduch", bar: 180, onboard: "dil", updated: 0 },
    t1: { id: "t1", name: "RB DIL 3", kind: "3 l", vol: 3, mix: "TMX 21/35", bar: 170, onboard: "dil", updated: 0 },
    o1: { id: "o1", name: "RB O2 1", kind: "3 l", vol: 3, mix: "O₂", bar: 120, onboard: "o2", updated: 0 },
    o2: { id: "o2", name: "RB O2 2", kind: "3 l", vol: 3, mix: "O₂", bar: 190, onboard: "o2", updated: 0 },
  };
  const mAir = { id: "d2", start: 1700100000, h: { diveTimeS: 3000 }, sum: { dilStart: 176, dilEnd: 150, o2Start: 8, o2End: 8, gases: [{ mix: "21/0", s: 3000 }] } } as unknown as Parameters<typeof G.gearOnboardApply>[1];
  const mTmx = { ...mAir, id: "d3", sum: { ...mAir.sum, gases: [{ mix: "21/35", s: 3000 }] } } as typeof mAir;
  ok(G.rbMatch(lb2, mAir, "dil").id === "a2" && G.rbMatch(lb2, mTmx, "dil").id === "t1" && G.rbMatch(lb2, mAir, "o2").id === null, "On-board lahve: diluent podle směsi a tlaku, O₂ se zavřenou lahví nerozpoznána");
  G.gearOnboardApply(lb2, mAir, true);
  ok(lb2.tanks.a2.bar === 150 && lb2.notes.d2?.rb?.dil?.id === "a2" && !lb2.notes.d2?.rb?.o2 && lb2.tanks.o1.bar === 120, "On-board lahve: přiřazený diluent převzal tlak, O₂ nepřiřazená");
  const lb3 = M.emptyLogbook(); G.gearOnboardApply(lb3, mTmx, true);
  const made = Object.values(lb3.tanks || {});
  ok(made.length === 2 && made.some((t) => t.name === "RB O2 1" && !!t.check) && made.some((t) => t.name === "RB DIL 1" && t.mix === "TMX 21/35" && t.bar === 150), "On-board lahve: první založení RB O2 1 a RB DIL 1 z posledního ponoru");
  // trend čidla
  const C = await import("../src/core/cells");
  const D = 86400000, pts = [0, 10, 20, 30, 40, 50].map((d, i) => ({ t: d * D, mv: 50 - i * 2, lin: [1, 0.99, 0.98, 0.93, 0.92, 0.9][i] }));
  const tr = C.cellTrend(pts, 8);
  ok(tr.slopePctM != null && tr.slopePctM < -5 && C.trendReasons(tr).length === 2, `Čidlo: trend ${tr.slopePctM} %/měs., linearita ${tr.linFirst}→${tr.linNow}`);
  // štítky nových upozornění
  const T = await import("../src/core/tags");
  ok(T.tagCat("Bailout by nestačil") === "BO" && T.tagCat("SurfGF nad hranicí") === "GF", "Štítky BO a GF");
}

if (fails) { console.error(`${fails} testů selhalo`); process.exit(1); }
console.log("Vše v pořádku");
