// Stažení ponorů ze Shearwater přes Web Bluetooth (Chrome na Androidu). Protokol v core/swproto.ts.
import type { RawDive } from "../core/shearwater";
import { download, downloadDive, type DiveState, ID_FIRMWARE, ID_LOGUPLOAD, ID_MODEL, ID_SERIAL, MANIFEST_ADDR, MANIFEST_SIZE, parseManifest, rdbi, SlipReader, slipFrames, SW_MODELS, SW_SERVICE, SW_SERVICE_V2, unwrapResponse, wrapBlob, wrapRequest, type Proto } from "../core/swproto";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Char = any;

export const bleSupported = () => typeof navigator !== "undefined" && !!(navigator as any).bluetooth;

export interface BleProgress { phase: string; dive?: number; of?: number; bytes?: number }
export interface BleResult { serial: number; model: string; firmware: string; saved: number; listed: number; cancelled?: boolean }
/** Plán: které ponory už jsou v telefonu (začátky) a kolik nejnovějších stáhnout; null = zrušit. */
export type BlePlan = (serial: number, model: string, total: number) => Promise<{ known: Set<number>; limit: number } | null>;

/** Ponor je celý, když obsahuje hlavičku (0x10), patičku (0x20) a závěrečný záznam (0xFF). */
export function diveComplete(nat: Uint8Array): boolean {
  let o = false, c = false, f = false;
  for (let i = 0; i + 32 <= nat.length; i += 32) { if (nat[i] === 0x10) o = true; else if (nat[i] === 0x20) c = true; else if (nat[i] === 0xff) f = true; }
  return o && c && f;
}
const CANCEL = "Stahování ukončeno";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Povolené příkazy – jen čtení: RDBI 0x22, stažení paměti 0x35/0x36/0x37. Cokoli jiného se neodešle. */
const READ_ONLY = new Set([0x22, 0x35, 0x36, 0x37]);

interface Session { tx: (req: Uint8Array) => Promise<Uint8Array>; proto: Proto; close: () => void }

// Další možné „sériové“ služby BLE (Petrel 2 má starší modul – pravděpodobně Telit/Stollmann Terminal I/O)
const TIO = "0000fefb-0000-1000-8000-00805f9b34fb";
/** Starší Terminal I/O (Stollmann BlueMod, ASCII „STMTERIOSERV1000“) – mají ho OSTC a nejspíš Petrel 2. */
const TIO_OLD = "53544d54-4552-494f-5345-525631303030";
const TIO_DATA_RX = "00000001-0000-1000-8000-008025000000", TIO_DATA_TX = "00000002-0000-1000-8000-008025000000";
const TIO_CRED_RX = "00000003-0000-1000-8000-008025000000", TIO_CRED_TX = "00000004-0000-1000-8000-008025000000";
const UBLOX = "2456e1b9-26e2-8f83-e744-f34f01e9d701", NORDIC = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const BLE_SERVICES = [SW_SERVICE, SW_SERVICE_V2, TIO, TIO_OLD, UBLOX, NORDIC];

const props = (c: Char) => Object.entries(c.properties).filter(([, v]) => v === true).map(([k]) => k).join(",");

/** Připojí se k vybranému počítači a připraví přenos paketů. */
async function openSession(device: any, log: (s: string) => void, first: boolean): Promise<Session> {
  const gatt = await device.gatt.connect();
  // všechny dostupné služby – do ladicího výpisu
  // Petrel zveřejní služby až chvíli po připojení (a po spárování) – zkusit několikrát
  let svcs: any[] = [];
  for (let k = 0; k < 4 && !svcs.length; k++) {
    if (k) await sleep(1500);
    svcs = await gatt.getPrimaryServices().catch((e: Error) => { if (first) log(`Služby (pokus ${k + 1}): ${e.message}`); return []; });
  }
  const chars = new Map<string, Char[]>();
  for (const sv of svcs) { const cs: Char[] = await sv.getCharacteristics().catch(() => []); chars.set(sv.uuid, cs); if (first) log(`Služba ${sv.uuid}: ${cs.map((c) => `${c.uuid.slice(0, 8)}[${props(c)}]`).join(" ")}`); }
  const pick = BLE_SERVICES.find((u) => chars.has(u)) ?? [...chars.keys()].find((u) => { const cs = chars.get(u)!; return cs.some((c) => c.properties.write || c.properties.writeWithoutResponse) && cs.some((c) => c.properties.notify || c.properties.indicate); });
  if (!pick) throw new Error(`Počítač nemá známou službu Bluetooth (nalezeno ${svcs.length} služeb) – pošli prosím ladicí výpis`);
  const cs = chars.get(pick)!;
  const proto: Proto = pick === SW_SERVICE_V2 ? 2 : 1;
  const tio = pick === TIO || pick === TIO_OLD;
  if (first) log(`Používám službu ${pick}${tio ? " (Terminal I/O)" : ""}, protokol V${proto}`);
  const byId = (u: string) => cs.find((c) => c.uuid === u);
  const wr = tio ? byId(TIO_DATA_RX) : cs.find((c) => c.properties.writeWithoutResponse || c.properties.write);
  const nt = tio ? byId(TIO_DATA_TX) : cs.find((c) => c.properties.notify || c.properties.indicate);
  if (!wr || !nt) throw new Error("Počítač nemá očekávané rozhraní Bluetooth");
  const reader = new SlipReader(proto);
  let wake: (() => void) | null = null;
  const bytesOf = (e: any) => { const dv: DataView = e.target.value; return new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength)); };

  // Terminal I/O: kreditové řízení toku – každý paket stojí 1 kredit v daném směru
  let txCredits = 0, rxCredits = 0;
  const credRx = tio ? byId(TIO_CRED_RX) : null, credTx = tio ? byId(TIO_CRED_TX) : null;
  const grant = async () => { if (credRx && rxCredits < 128) { const n = 255 - rxCredits; rxCredits = 255; await credRx.writeValueWithResponse(Uint8Array.from([n])); } };
  if (tio) {
    if (!credRx || !credTx) throw new Error("Terminal I/O bez kreditových charakteristik");
    credTx.addEventListener("characteristicvaluechanged", (e: any) => { txCredits += bytesOf(e)[0] || 0; wake?.(); });
    await credTx.startNotifications();
  }
  const onVal = (e: any) => { reader.push(bytesOf(e)); if (tio) { rxCredits--; grant().catch(() => {}); } wake?.(); };
  nt.addEventListener("characteristicvaluechanged", onVal);
  await nt.startNotifications();
  if (tio) { await grant(); if (first) log("Terminal I/O: kredity přiděleny"); }
  await sleep(300);
  const waitFor = async (cond: () => boolean, ms: number, what: string) => {
    const t0 = Date.now();
    while (!cond()) {
      if (!gatt.connected) throw new Error("Spojení přerušeno");
      const left = ms - (Date.now() - t0);
      if (left <= 0) throw new Error(what);
      await new Promise<void>((r) => { wake = r; setTimeout(r, Math.min(left, 200)); });
      wake = null;
    }
  };
  const write = async (f: Uint8Array) => {
    if (tio) { await waitFor(() => txCredits > 0, 3000, "Počítač nepřidělil kredity (Terminal I/O)"); txCredits--; }
    return wr.properties.writeWithoutResponse ? wr.writeValueWithoutResponse(f) : wr.writeValueWithResponse(f);
  };
  const readPacket = async (ms = 3000): Promise<Uint8Array> => { await waitFor(() => reader.packets.length > 0, ms, "Počítač neodpovídá (časový limit)"); return reader.packets.shift()!; };
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
 * Každý stažený ponor hned předá k uložení (onDive); při přerušení se až 3× znovu připojí a naváže tam, kde ponor přestal.
 */
export async function bleDownload(plan: BlePlan, onDive: (r: RawDive) => Promise<void>, onProgress: (p: BleProgress) => void, log: (s: string) => void, cancelled: () => boolean = () => false): Promise<BleResult> {
  const bt = (navigator as any).bluetooth;
  const device = await bt.requestDevice({
    filters: [{ services: [SW_SERVICE] }, { services: [SW_SERVICE_V2] }, ...["Petrel", "Perdix", "Peregrine", "Teric", "Tern", "NERD", "Predator"].map((namePrefix) => ({ namePrefix }))],
    optionalServices: BLE_SERVICES,
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
        if (cancelled() || (e as Error).message === CANCEL || retries >= 3) throw e;
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
    const pl = await plan(serial, model, list.length);
    if (!pl) return { serial, model, firmware, saved: 0, listed: list.length, cancelled: true };
    // nejnovější první; už uložené (podle začátku = otisku) přeskočit
    const todo = [...list].sort((a, b) => b.fp - a.fp).filter((d) => !pl.known.has(d.fp)).slice(0, pl.limit);
    log(`V počítači ${list.length} ponorů, v telefonu ${list.filter((d) => pl.known.has(d.fp)).length}, ke stažení ${todo.length}`);
    const tag = `${model}[${serial.toString(16).toUpperCase()}]`;
    let saved = 0;
    for (let k = 0; k < todo.length; k++) {
      diveNow = k + 1; bytesNow = 0;
      const t1 = Date.now();
      onProgress({ phase: "Stahuji ponory…", dive: k + 1, of: todo.length });
      if (cancelled()) return { serial, model, firmware, saved, listed: list.length, cancelled: true };
      const ds: DiveState = { have: null }; // po přerušení navázat, ne stahovat znovu od začátku
      const nat = await step(async (s) => {
        bytesNow = 0;
        const d = await downloadDive(s.tx, s.proto, base + todo[k].addr, ds, (b) => { if (cancelled()) throw new Error(CANCEL); bytesNow = b; onProgress({ phase: ds.have ? "Navazuji ponor…" : "Stahuji ponory…", dive: k + 1, of: todo.length, bytes: b }); }, log);
        if (!diveComplete(d)) { ds.have = null; ds.noTail = true; throw new Error("Ponor se nestáhl celý"); }
        return d;
      }).catch((e) => { if (cancelled() || (e as Error).message === CANCEL) return null; throw e; });
      if (!nat) return { serial, model, firmware, saved, listed: list.length, cancelled: true };
      log(`Ponor ${k + 1}/${todo.length}: ${Math.round(bytesNow / 1024)} kB za ${Math.round((Date.now() - t1) / 1000)} s${ds.resumed ? " (navázáno po přerušení)" : ""}`);
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
