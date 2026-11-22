// Stažení ponorů ze Shearwater přes Web Bluetooth (Chrome na Androidu). Protokol v core/swproto.ts.
import type { RawDive } from "../core/shearwater";
import { download, ID_FIRMWARE, ID_LOGUPLOAD, ID_MODEL, ID_SERIAL, MANIFEST_ADDR, MANIFEST_SIZE, DIVE_SIZE, parseManifest, rdbi, SlipReader, slipFrames, SW_MODELS, SW_SERVICE, SW_SERVICE_V2, unwrapResponse, wrapBlob, wrapRequest, type Proto } from "../core/swproto";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Char = any;

export const bleSupported = () => typeof navigator !== "undefined" && !!(navigator as any).bluetooth;

export interface BleProgress { phase: string; dive?: number; of?: number; bytes?: number }
export interface BleResult { serial: number; model: string; firmware: string; raws: RawDive[]; listed: number }

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Spojí se s počítačem a stáhne ponory, které ještě nemám (skip = časy začátků už uložených ponorů daného počítače). */
export async function bleDownload(have: (serial: number) => Set<number>, onProgress: (p: BleProgress) => void, log: (s: string) => void): Promise<BleResult> {
  const bt = (navigator as any).bluetooth;
  const device = await bt.requestDevice({
    filters: [{ services: [SW_SERVICE] }, { services: [SW_SERVICE_V2] }, ...["Petrel", "Perdix", "Peregrine", "Teric", "Tern", "NERD", "Predator"].map((namePrefix) => ({ namePrefix }))],
    optionalServices: [SW_SERVICE, SW_SERVICE_V2],
  });
  log(`Zařízení: ${device.name || "?"}`);
  onProgress({ phase: "Připojuji…" });
  const gatt = await device.gatt.connect();
  try {
    let svc: any, proto: Proto = 1;
    try { svc = await gatt.getPrimaryService(SW_SERVICE); } catch { svc = await gatt.getPrimaryService(SW_SERVICE_V2); proto = 2; }
    const chars: Char[] = await svc.getCharacteristics();
    for (const c of chars) log(`Charakteristika ${c.uuid}: ${Object.entries(c.properties).filter(([, v]) => v === true).map(([k]) => k).join(",")}`);
    const wr = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
    const nt = chars.find((c) => c.properties.notify || c.properties.indicate);
    if (!wr || !nt) throw new Error("Počítač nemá očekávané rozhraní Bluetooth");
    const reader = new SlipReader(proto);
    let wake: (() => void) | null = null;
    nt.addEventListener("characteristicvaluechanged", (e: any) => {
      const v = new Uint8Array(e.target.value.buffer.slice(e.target.value.byteOffset, e.target.value.byteOffset + e.target.value.byteLength));
      reader.push(v); wake?.();
    });
    await nt.startNotifications();
    await sleep(300);
    const write = async (f: Uint8Array) => (wr.properties.writeWithoutResponse ? wr.writeValueWithoutResponse(f) : wr.writeValueWithResponse(f));
    const readPacket = async (ms = 3000): Promise<Uint8Array> => {
      const t0 = Date.now();
      while (!reader.packets.length) {
        const left = ms - (Date.now() - t0);
        if (left <= 0) throw new Error("Počítač neodpovídá (časový limit)");
        await new Promise<void>((r) => { wake = r; setTimeout(r, Math.min(left, 200)); });
        wake = null;
      }
      return reader.packets.shift()!;
    };
    let verbose = 0;
    const tx = async (req: Uint8Array) => {
      reader.packets.length = 0;
      const pkt = wrapRequest(req, proto);
      if (verbose++ < 12) log(`→ ${hex(req.subarray(0, 12))}`);
      for (const f of slipFrames(pkt, proto)) await write(f);
      const res = unwrapResponse(await readPacket(), proto);
      if (verbose < 13) log(`← ${hex(res.subarray(0, 16))}${res.length > 16 ? ` … (${res.length} B)` : ""}`);
      return res;
    };

    onProgress({ phase: "Čtu údaje počítače…" });
    const serial = parseInt(new TextDecoder().decode(await rdbi(tx, ID_SERIAL)).trim(), 16) >>> 0;
    const firmware = new TextDecoder().decode(await rdbi(tx, ID_FIRMWARE)).replace(/\0/g, "").trim();
    let modelNo = 0; try { modelNo = (await rdbi(tx, ID_MODEL))[0]; } catch (e) { log("Model: " + (e as Error).message); }
    const model = SW_MODELS[modelNo] || device.name?.replace(/\s*\d+$/, "") || "Shearwater";
    const lu = await rdbi(tx, ID_LOGUPLOAD);
    const base = ((lu[1] << 24) | (lu[2] << 16) | (lu[3] << 8) | lu[4]) >>> 0;
    log(`S/N ${serial.toString(16).toUpperCase()}, firmware ${firmware}, model ${modelNo} (${model}), log 0x${base.toString(16)}`);
    if (base !== 0x80000000) throw new Error(`Formát logu 0x${base.toString(16)} zatím neumím – pošli prosím ladicí výpis`);

    onProgress({ phase: "Čtu seznam ponorů…" });
    const list: { addr: number; fp: number }[] = [];
    for (let page = 0; page < 40; page++) {
      const m = parseManifest(await download(tx, proto, MANIFEST_ADDR, MANIFEST_SIZE, false));
      list.push(...m.dives);
      if (!m.full) break;
    }
    const known = have(serial);
    const todo = list.filter((d) => !known.has(d.fp));
    log(`V počítači ${list.length} ponorů, nových ${todo.length}`);
    const raws: RawDive[] = [];
    const tag = `${model}[${serial.toString(16).toUpperCase().padStart(8, "0")}]`;
    for (let k = 0; k < todo.length; k++) {
      onProgress({ phase: "Stahuji ponory…", dive: k + 1, of: todo.length });
      const nat = await download(tx, proto, base + todo[k].addr, DIVE_SIZE, true, (b) => onProgress({ phase: "Stahuji ponory…", dive: k + 1, of: todo.length, bytes: b }));
      const blob = await wrapBlob(nat);
      let num = 0;
      for (let i = 0; i + 32 <= nat.length; i += 32) if (nat[i] === 0x10) { num = (nat[i + 2] << 8) | nat[i + 3]; break; }
      const d = new Date(todo[k].fp * 1000);
      raws.push({ id: `ble-${serial.toString(16)}-${todo[k].fp}`, num, start: todo[k].fp, blob,
        fn: `${tag}#${num} ${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()} (Bluetooth)` });
    }
    return { serial, model, firmware, raws, listed: list.length };
  } finally {
    try { gatt.disconnect(); } catch { /* už odpojeno */ }
  }
}
