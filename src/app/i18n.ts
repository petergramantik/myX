// Jazykové mutace. Čeština je zdrojová (texty v kódu); ostatní jazyky překládá slovník podle českého textu.
// Překlad běží nad DOM: každý nový nebo změněný textový uzel (a placeholder, title, aria-label) se přeloží přesnou shodou
// (normalizované mezery), jinak vzorem se zástupnými místy {0}, {1}… (z šablon v kódu); části ve vzoru se překládají znovu.
// Volba jazyka je v zařízení (localStorage), změna znovu načte aplikaci.
import { EN, EN_PAT } from "../i18n/en";

export type Lang = "cs" | "en";
export const LANGS: [Lang, string][] = [["cs", "Čeština"], ["en", "English"]];
const LANG_K = "myx-lang";
export const LANG: Lang = (() => {
  try { const v = localStorage.getItem(LANG_K); if (v === "cs" || v === "en") return v; } catch { /* bez úložiště */ }
  const n = (typeof navigator !== "undefined" && navigator.language) || "cs";
  return /^(cs|sk)/i.test(n) ? "cs" : "en";
})();
/** Locale pro čísla a data. */
export const LOC = LANG === "en" ? "en-GB" : "cs-CZ";
/** Desetinná čárka / tečka. */
export const DEC = LANG === "en" ? "." : ",";
export function setLang(l: Lang) { try { localStorage.setItem(LANG_K, l); } catch { /* bez úložiště */ } location.reload(); }

interface Pat { pre: string; re: RegExp; out: string }
let dict: Map<string, string> | null = null, pats: Pat[] = [];
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Slovník pro jazyk (exportováno kvůli testům). */
export function loadDict(exact: Record<string, string>, pat: Record<string, string>) {
  dict = new Map(Object.entries(exact).map(([k, v]) => [norm(k), v]));
  pats = Object.entries(pat).map(([k, out]) => {
    const kk = norm(k), parts = kk.split(/\{\d+\}/), ids = [...kk.matchAll(/\{(\d+)\}/g)].map((m) => +m[1]);
    let re = "^" + esc(parts[0]);
    ids.forEach((_, i) => { re += "(.+?)" + esc(parts[i + 1]); });
    // pořadí zachycených skupin → čísla zástupných míst
    const map = ids;
    return { pre: parts[0], re: new RegExp(re + "$", "s"), out: out.replace(/\{(\d+)\}/g, (_m, n) => `{@${map.indexOf(+n)}}`) };
  }).sort((a, b) => b.pre.length - a.pre.length || b.re.source.length - a.re.source.length);
}

/** Přeloží text (přesná shoda, jinak vzor); zachová mezery okolo. Bez překladu vrátí původní. */
export function tr(s: string): string {
  if (!dict) return s;
  const n = norm(s);
  if (!n || !/[A-Za-zÀ-ž]/.test(n)) return s;
  const x = dict.get(n) ?? trPat(n);
  if (x == null) return s;
  const lead = s.match(/^\s*/)![0], tail = s.match(/\s*$/)![0];
  return (lead ? " " : "") + x + (tail && n ? " " : "");
}
function trPat(n: string, depth = 0): string | null {
  for (const p of pats) {
    if (p.pre && !n.startsWith(p.pre)) continue;
    const m = p.re.exec(n);
    if (!m) continue;
    return p.out.replace(/\{@(\d+)\}/g, (_x, i) => { const g = m[+i + 1] ?? ""; return dict!.get(g) ?? (depth < 2 ? trPat(g, depth + 1) : null) ?? g; });
  }
  return null;
}

const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE"]);
const ATTRS = ["placeholder", "title", "aria-label"];
const done = new WeakMap<Node, string>();
function trText(t: Text) {
  const v = t.nodeValue || "";
  if (done.get(t) === v) return;
  const p = t.parentElement;
  if (p && (SKIP.has(p.tagName) || p.closest("[data-noi18n]"))) return;
  const x = tr(v);
  done.set(t, x);
  if (x !== v) t.nodeValue = x;
}
function trAttrs(e: Element) {
  for (const a of ATTRS) { const v = e.getAttribute(a); if (v) { const x = tr(v); if (x !== v) e.setAttribute(a, x); } }
}
function trTree(n: Node) {
  if (n.nodeType === 3) { trText(n as Text); return; }
  if (n.nodeType !== 1) return;
  const e = n as Element;
  if (SKIP.has(e.tagName) && e.tagName !== "INPUT" && e.tagName !== "TEXTAREA") return;
  trAttrs(e);
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let c: Node | null;
  while ((c = w.nextNode())) { if (c.nodeType === 3) trText(c as Text); else trAttrs(c as Element); }
}

/** Spustí překlad stránky (jen mimo češtinu). */
export function startI18n() {
  if (LANG === "cs") return;
  loadDict(EN, EN_PAT);
  document.documentElement.lang = LANG;
  const obs = new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "characterData") trText(m.target as Text);
      else if (m.type === "attributes") trAttrs(m.target as Element);
      else m.addedNodes.forEach(trTree);
    }
  });
  obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  trTree(document.body);
  document.title = tr(document.title);
}
