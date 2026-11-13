import { readShearwaterDb, decodeDive } from "../src/core/shearwater";
import { summarize, injections, cellCalibration, alerts, DEFAULT_THRESHOLDS, diveWarnings } from "../src/core/analysis";
const buf = new Uint8Array(await Bun.file(process.argv[2]).arrayBuffer());
const raws = readShearwaterDb(buf);
console.log("dives", raws.length);
const hs = [];
for (const r of raws.sort((a,b)=>a.num-b.num)) {
  const d = await decodeDive(r); hs.push(d.h);
  const s = summarize(d);
  if ([323,334,345,374].includes(d.h.num)) console.log(d.h.num, d.h.maxDepth, d.h.diveTimeS, s.avgDepth, s.tempMin, s.co2Max, s.dilStart, s.o2Start, d.tissues.length, d.events.length, injections(d).length, cellCalibration(d).map(x=>x&&x.toFixed(4)), diveWarnings(d,s,DEFAULT_THRESHOLDS).map(a=>a.title));
}
console.log(alerts(hs, Date.UTC(2026,10,13,16)/1000, DEFAULT_THRESHOLDS));
