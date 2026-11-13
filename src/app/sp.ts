// Strany potápěčské (stranypotapecske.cz) přes Worker: detail lokality a seznam lokalit.
import type { SpInfo } from "./model";
import { norm } from "./model";
import { workerUrl } from "./config";

export const spUrl = (id: number) => `https://stranypotapecske.cz/lokality/lokaldet.asp?lok=${id}`;

function decode(buf: ArrayBuffer): string {
  const head = new TextDecoder("latin1").decode(buf.slice(0, 2048));
  const cs = /charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() || "windows-1250";
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder("windows-1250").decode(buf); }
}

async function fetchSp(path: string): Promise<string> {
  const base = workerUrl();
  if (!base) throw new Error("Není nastavená adresa Workeru (Nastavení)");
  const r = await fetch(`${base}/sp/${path}`);
  if (!r.ok) throw new Error(`Strany potápěčské: chyba ${r.status}`);
  return decode(await r.arrayBuffer());
}

const toText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|td|th)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n");

/** Rozebere detail lokality. Struktura stránky není oficiálně popsaná – čte se vyhledáváním v textu. */
export function parseSpDetail(id: number, html: string): SpInfo {
  const text = toText(html);
  const info: SpInfo = { id, fetched: Date.now() };
  const gps = /N\s*(\d{1,2})[°\s]+(\d{1,2}(?:[.,]\d+)?)['′]?\s*,?\s*E\s*0*(\d{1,3})[°\s]+(\d{1,2}(?:[.,]\d+)?)/.exec(text);
  if (gps) {
    info.lat = +gps[1] + parseFloat(gps[2].replace(",", ".")) / 60;
    info.lon = +gps[3] + parseFloat(gps[4].replace(",", ".")) / 60;
  }
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  const h = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim();
  const name = (h && h.length < 90 ? h : title?.split(/\s[-–|]\s/).filter((x) => !/strany|potáp/i.test(x)).pop())?.trim();
  if (name) info.name = name;
  const depth = /max(?:imáln[íi])?\.?\s*hloubka[^0-9\n]{0,25}(\d{1,3})/i.exec(text);
  if (depth) info.maxDepth = +depth[1];
  const typ = /\bTyp(?: lokality)?\s*:?\s*\n?\s*([^\n]{3,40})/i.exec(text);
  if (typ) info.type = typ[1].trim();
  const reg = /\b(?:Kraj|Region)\s*:?\s*\n?\s*([^\n]{3,40})/i.exec(text);
  if (reg) info.region = reg[1].trim();
  const vis = /viditelnost[^0-9\n]{0,40}(\d{1,2}(?:[.,]\d)?)\s*m/i.exec(text);
  if (vis) info.visibility = parseFloat(vis[1].replace(",", "."));
  const rate = /hodnocen[íi][^\n]{0,20}\n?\s*([A-Za-zÁ-ž ]{3,20})/i.exec(text);
  if (rate) info.rating = rate[1].trim();
  // teploty po měsících: řádek s 12 čísly za slovem „teplota“
  const tm = /teplot[^\n]*\n((?:[^\n]*\n){0,6})/gi;
  for (let m; (m = tm.exec(text)); ) {
    const nums = (m[1].match(/-?\d{1,2}(?:[.,]\d)?/g) || []).map((x) => parseFloat(x.replace(",", ".")));
    if (nums.length >= 12) { info.temps = nums.slice(0, 12); break; }
  }
  return info;
}

export async function loadSpDetail(id: number): Promise<SpInfo> {
  return parseSpDetail(id, await fetchSp(`lok/${id}`));
}

export interface SpListItem { id: number; name: string }
let listCache: SpListItem[] | null = null;

/** Seznam lokalit z přehledové stránky (jen ID a názvy z odkazů). */
export async function loadSpList(): Promise<SpListItem[]> {
  if (listCache) return listCache;
  const html = await fetchSp("list");
  const seen = new Map<number, string>();
  const re = /lokaldet\.asp\?lok=(\d+)[^>]*>([\s\S]{1,120}?)<\/a>/gi;
  for (let m; (m = re.exec(html)); ) {
    const name = m[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    if (name && !seen.has(+m[1])) seen.set(+m[1], name);
  }
  listCache = [...seen].map(([id, name]) => ({ id, name }));
  return listCache;
}

export function searchSp(list: SpListItem[], q: string): SpListItem[] {
  const n = norm(q);
  if (!n) return [];
  const words = n.split(" ");
  return list
    .map((x) => ({ x, nn: norm(x.name) }))
    .filter(({ nn }) => words.every((w) => nn.includes(w)))
    .slice(0, 15)
    .map(({ x }) => x);
}

/** Z odkazu nebo textu vytáhne číslo lokality (lok=268 nebo jen 268). */
export function parseSpRef(s: string): number | null {
  const m = /lok=(\d+)/.exec(s) || /^\s*(\d{1,6})\s*$/.exec(s);
  return m ? +m[1] : null;
}
