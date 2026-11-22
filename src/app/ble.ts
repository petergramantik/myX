// Stažení ponorů ze Shearwater přes Web Bluetooth (Chrome na Androidu). Protokol v core/swproto.ts.
import type { RawDive } from "../core/shearwater";
import { download, ID_FIRMWARE, ID_LOGUPLOAD, ID_MODEL, ID_SERIAL, MANIFEST_ADDR, MANIFEST_SIZE, DIVE_SIZE, parseManifest, rdbi, SlipReader, slipFrames, SW_MODELS, SW_SERVICE, SW_SERVICE_V2, unwrapResponse, wrapBlob, wrapRequest, type Proto } from "../core/swproto";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Char = any;

export const bleSupported = () => typeof navigator !== "undefined" && !!(navigator as any).bluetooth;

export interface BleProgress { phase: string; dive?: number; of?: number; bytes?: number }
export interface BleResult { serial: number; model: string; firmware: string; saved: number; listed: number }

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Povolené příkazy – jen čtení: RDBI 0x22, stažení paměti 0x35/0x36/0x37. Cokoli jiného se neodešle. */
const READ_ONLY = new Set([0x22, 0x35, 0x36, 0x37]);

interface Session { tx: (req: Uint8Array) => Promise<Uint8Array>; proto: Proto; close: () => void }

/** Připojí se k vybranému počítači a připraví přenos paketů. */
async function openSession(device: any, log: (s: string) => void, first: boolean): Promise<Session> {
  const gatt = await device.gatt.connect();
  let svc: any, proto: Proto = 1;
  try { svc = await gatt.getPrimaryService(SW_SERVICE); } catch { svc = await gatt.getPrimaryService(SW_SERVICE_V2); proto = 2; }
  const chars: Char[] = await svc.getCharacteristics();
  if (first) for (const c of chars) log(`Charakteristika ${c.uuid}: ${Object.entries(c.properties).filter(([, v]) => v === true).map(([k]) => k).join(",")}`);
  const wr = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
  const nt = chars.find((c) => c.properties.notify || c.properties.indicate);
  if (!wr || !nt) throw new Error("Počítač nemá očekávané rozhraní Bluetooth");
  const reader = new SlipReader(proto);
  let wake: (() => void) | null = null;
  const onVal = (e: any) => { const dv: DataView = e.target.value; reader.push(new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength))); wake?.(); };
  nt.addEventListener("characteristicvaluechanged", onVal);
  await nt.startNotifications();
  await sleep(300);
  const write = async (f: Uint8Array) => (wr.properties.writeWithoutResponse ? wr.writeValueWithoutResponse(f) : wr.writeValueWithResponse(f));
  const readPacket = async (ms = 3000): Promise<Uint8Array> => {
    const t0 = Date.now();
    while (!reader.packets.length) {
      if (!gatt.connected) throw new Error("Spojení přerušeno");
      const left = ms - (Date.now() - t0);
      if (left <= 0) throw new Error("Počítač neodpovídá (časový limit)");
      await new Promise<void>((r) => { wake = r; setTimeout(r, Math.min(left, 200)); });
      wake = null;
    }
    return reader.packets.shift()!;
  };
  let verbose = first ? 0 : 99;
  const tx = async (req: Uint8Array) => {
    if (!READ_ONLY.has(req[0])) throw new Error(`Pojistka: příkaz 0x${req[0].toString(16)} není čtení – neodeslán`);
    reader.packets.length = 0;
    if (verbose++ < 12) log(`→ ${hex(req.subarray(0, 12))}`);
    for (const f of slipFrames(wrapRequest(req, proto), proto)) await write(f);
    const res = unwrapResponse(await readPacket(), proto);
    if (verbose < 13) log(`← ${hex(res.subarray(0, 16))}${res.length > 16 ? ` … (${res.length} B)` : ""}`);
    return res;
  };
  return { tx, proto, close: () => { nt.removeEventListener("characteristicvaluechanged", onVal); try { gatt.disconnect(); } catch { /* */ } } };
}

/**
 * Spojí se s počítačem a stáhne ponory, které ještě nemám (have = časy začátků uložených ponorů daného počítače).
 * Každý stažený ponor hned předá k uložení (onDive); při přerušení se až 3× znovu připojí a pokračuje dalším ponorem.
 */
export async function bleDownload(have: (serial: number) => Set<number>, onDive: (r: RawDive) => Promise<void>, onProgress: (p: BleProgress) => void, log: (s: string) => void): Promise<BleResult> {
  const bt = (navigator as any).bluetooth;
  const device = await bt.requestDevice({
    filters: [{ services: [SW_SERVICE] }, { services: [SW_SERVICE_V2] }, ...["Petrel", "Perdix", "Peregrine", "Teric", "Tern", "NERD", "Predator"].map((namePrefix) => ({ namePrefix }))],
    optionalServices: [SW_SERVICE, SW_SERVICE_V2],
  });
  log(`Zařízení: ${device.name || "?"}`);
  const t0 = Date.now();
  let bytesNow = 0, diveNow = 0;
  device.addEventListener("gattserverdisconnected", () => log(`Odpojeno po ${Math.round((Date.now() - t0) / 1000)} s (ponor ${diveNow || "–"}, ${Math.round(bytesNow / 1024)} kB z něj)`));
  onProgress({ phase: "Připojuji…" });
  let ses = await openSession(device, log, true);
  let retries = 0;
  /** Provede krok; při přerušení spojení se znovu připojí (max. 3×) a krok zopakuje. */
  const step = async <T>(f: (s: Session) => Promise<T>): Promise<T> => {
    for (;;) {
      try { return await f(ses); }
      catch (e) {
        if (retries >= 3) throw e;
        retries++;
        log(`Chyba: ${(e as Error).message} – znovu se připojuji (${retries}/3)`);
        onProgress({ phase: `Znovu se připojuji (${retries}/3)…` });
        ses.close(); await sleep(1500);
        ses = await openSession(device, log, false);
      }
    }
  };
  try {
    onProgress({ phase: "Čtu údaje počítače…" });
    const serial = await step(async (s) => parseInt(new TextDecoder().decode(await rdbi(s.tx, ID_SERIAL)).trim(), 16) >>> 0);
    const firmware = await step(async (s) => new TextDecoder().decode(await rdbi(s.tx, ID_FIRMWARE)).replace(/\0/g, "").trim());
    let modelNo = 0; try { modelNo = (await rdbi(ses.tx, ID_MODEL))[0]; } catch (e) { log("Model: " + (e as Error).message); }
    const model = SW_MODELS[modelNo] || device.name?.replace(/\s*\d+$/, "") || "Shearwater";
    const lu = await step((s) => rdbi(s.tx, ID_LOGUPLOAD));
    const base = ((lu[1] << 24) | (lu[2] << 16) | (lu[3] << 8) | lu[4]) >>> 0;
    log(`S/N ${serial.toString(16).toUpperCase()}, firmware ${firmware}, model ${modelNo} (${model}), log 0x${base.toString(16)}`);
    if (base !== 0x80000000) throw new Error(`Formát logu 0x${base.toString(16)} zatím neumím – pošli prosím ladicí výpis`);

    onProgress({ phase: "Čtu seznam ponorů…" });
    const list = await step(async (s) => {
      const out: { addr: number; fp: number }[] = [];
      for (let page = 0; page < 40; page++) { const m = parseManifest(await download(s.tx, s.proto, MANIFEST_ADDR, MANIFEST_SIZE, false)); out.push(...m.dives); if (!m.full) break; }
      return out;
    });
    const known = have(serial);
    const todo = list.filter((d) => !known.has(d.fp));
    log(`V počítači ${list.length} ponorů, nových ${todo.length}`);
    const tag = `${model}[${serial.toString(16).toUpperCase().padStart(8, "0")}]`;
    let saved = 0;
    for (let k = 0; k < todo.length; k++) {
      diveNow = k + 1; bytesNow = 0;
      const t1 = Date.now();
      onProgress({ phase: "Stahuji ponory…", dive: k + 1, of: todo.length });
      const nat = await step((s) => { bytesNow = 0; return download(s.tx, s.proto, base + todo[k].addr, DIVE_SIZE, true, (b) => { bytesNow = b; onProgress({ phase: "Stahuji ponory…", dive: k + 1, of: todo.length, bytes: b }); }); });
      log(`Ponor ${k + 1}/${todo.length}: ${Math.round(bytesNow / 1024)} kB za ${Math.round((Date.now() - t1) / 1000)} s`);
      const blob = await wrapBlob(nat);
      let num = 0;
      for (let i = 0; i + 32 <= nat.length; i += 32) if (nat[i] === 0x10) { num = (nat[i + 2] << 8) | nat[i + 3]; break; }
      const d = new Date(todo[k].fp * 1000);
      // uložit hned – při přerušení se stažené ponory neztratí
      await onDive({ id: `ble-${serial.toString(16)}-${todo[k].fp}`, num, start: todo[k].fp, blob,
        fn: `${tag}#${num} ${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()} (Bluetooth)` });
      saved++;
    }
    return { serial, model, firmware, saved, listed: list.length };
  } finally {
    ses.close();
  }
}
