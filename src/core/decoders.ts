// Dekodéry logů podle výrobce. Každý převede soubor na surové ponory a ty na normalizovaný ponor (Dive)
// se stejnou strukturou – zbytek aplikace (analýzy, grafy, srovnání) na výrobci nezávisí.
// Co ponor umí (čidla O₂, dekomprese…), určuje mód v hlavičce (viz rig.ts), ne výrobce.
import { decodeDive as swDecode, readShearwaterDb, type Dive, type RawDive } from "./shearwater";

export interface Decoder {
  id: string; vendor: string;
  /** Pozná svůj soubor (export z aplikace výrobce). */
  detect: (buf: Uint8Array) => boolean;
  /** Surové ponory ze souboru. */
  read: (buf: Uint8Array) => RawDive[];
  /** Normalizovaný ponor. */
  decode: (raw: RawDive) => Promise<Dive>;
}

const SQLITE = "SQLite format 3";
const isSqlite = (b: Uint8Array) => b.length > 16 && String.fromCharCode(...b.subarray(0, 15)) === SQLITE;

export const DECODERS: Decoder[] = [
  { id: "shearwater", vendor: "Shearwater", detect: isSqlite, read: readShearwaterDb, decode: swDecode },
  // další výrobci: { id: "…", vendor: "…", detect, read, decode }
];

/** Dekodér pro soubor (null = neznámý formát). */
export const decoderFor = (buf: Uint8Array): Decoder | null => DECODERS.find((x) => x.detect(buf)) ?? null;
/** Surové ponory ze souboru libovolného podporovaného výrobce. */
export function readAny(buf: Uint8Array): RawDive[] {
  const dec = decoderFor(buf);
  if (!dec) throw new Error("Neznámý formát souboru – zatím umím jen export ze Shearwater Cloud");
  return dec.read(buf).map((r) => ({ ...r, vendor: r.vendor ?? dec.id }));
}
/** Normalizovaný ponor podle výrobce surového záznamu (starší záznamy bez výrobce = Shearwater). */
export function decodeAny(raw: RawDive): Promise<Dive> {
  return (DECODERS.find((x) => x.id === (raw.vendor ?? "shearwater")) ?? DECODERS[0]).decode(raw);
}
