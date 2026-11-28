// Srovnání ponorů jako samostatná statická stránka HTML (bez skriptů, bez ID počítačů a surových dat) ke sdílení.
import { appUrl } from "../app/appurl";
import { LANG, tr } from "../app/i18n";
import { toast } from "../app/store";
import { choose } from "../app/dialog";

const APP_URL = appUrl();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Styly aplikace (jen pravidla, která stránka použije, + proměnné). */
function cssFor(root: Element): string {
  const out: string[] = [];
  for (const sh of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sh.cssRules; } catch { continue; }
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule) {
        const sel = r.selectorText;
        if (/^(:root|html|body|\*)/.test(sel)) { out.push(r.cssText); continue; }
        try { if (root.querySelector(sel.replace(/::?(before|after|hover|active|focus|first-child|last-child|first-of-type)\b/g, "")) ) out.push(r.cssText); } catch { /* neplatný selektor */ }
      } else if (r instanceof CSSMediaRule) out.push(r.cssText);
    }
  }
  return out.join("\n");
}

const wrapOf = (c: HTMLElement) => { const w = document.createElement("div"); w.appendChild(c.cloneNode(true)); return w; };

/** Vytvoří HTML ze zobrazeného srovnání (prvek .screen). */
export function compareHtml(screen: HTMLElement, title: string, when: string, me?: string): string {
  const c = screen.cloneNode(true) as HTMLElement;
  // „Já“ je u příjemce odesílatel → jeho jméno
  if (me) { const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeValue = n.nodeValue!.replace(/(^|[^\p{L}])Já(?!\p{L})/gu, `$1${me}`); }
  // ovládací prvky pryč: přepínače, tlačítka, odkazy do aplikace
  c.querySelectorAll("button, .cmp-align, .cmp-share, input, .cmp-mine-link").forEach((e) => e.remove());
  c.querySelectorAll("a").forEach((a) => a.replaceWith(document.createTextNode(a.textContent || "")));
  c.querySelectorAll("label.chip").forEach((l) => { const s = document.createElement("span"); s.className = l.className; s.setAttribute("style", l.getAttribute("style") || ""); s.innerHTML = l.innerHTML; l.replaceWith(s); });
  // grafy: pevná šířka → přizpůsobit šířce stránky
  c.querySelectorAll("svg").forEach((s) => {
    const w = s.getAttribute("width"), h = s.getAttribute("height");
    if (w && h && !s.getAttribute("viewBox")) s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.removeAttribute("width"); s.removeAttribute("height");
    s.setAttribute("style", "width:100%;height:auto;display:block");
  });
  // křivky: nejvýš jeden bod na ~1,5 px šířky (menší soubor)
  c.querySelectorAll("path[d]").forEach((p) => {
    const d = p.getAttribute("d")!;
    if (!/^M[\d.,-]+(L[\d.,-]+)+$/.test(d)) return;
    const pts = d.slice(1).split("L").map((x) => x.split(",").map(Number));
    const keep: number[][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) if (pts[i][0] - keep[keep.length - 1][0] >= 1.5 || i === pts.length - 1) keep.push(pts[i]);
    p.setAttribute("d", "M" + keep.map(([x, y]) => `${Math.round(x)},${Math.round(y * 2) / 2}`).join("L"));
  });
  c.querySelectorAll(".cmpb-h").forEach((e) => ((e as HTMLElement).style.position = "static"));
  c.classList.remove("from-left", "from-right");
  const link = `<a href="${APP_URL}">reLog</a>`;
  const en = LANG === "en";
  return `<!DOCTYPE html>
<html lang="${en ? "en" : "cs"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} – ${en ? "dive comparison" : "srovnání ponorů"} (reLog)</title>
<style>${cssFor(wrapOf(c))}
body{max-width:760px;margin:0 auto;padding:0 0 24px}.share-top{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line);font-size:14px}
.share-top b{font-size:16px}.share-foot{text-align:center;color:var(--muted);font-size:13px;padding:18px 14px 6px}.share-foot a,.share-top a{color:var(--accent);font-weight:700}</style></head>
<body><div class="share-top"><span><b>${en ? "Dive comparison" : "Srovnání ponorů"}</b><br><span style="color:var(--muted)">${esc(when)}</span></span><span>${en ? "created in" : "vytvořeno v"} ${link}</span></div>
${c.outerHTML}
<p class="share-foot">${en ? `Created in ${link} – a logbook for X-CCR.<br>Open it on your phone and add it to the home screen:` : `Vytvořeno v ${link} – logbook pro X-CCR.<br>Otevři v telefonu a přidej na plochu:`} <a href="${APP_URL}">${APP_URL.replace("https://", "")}</a></p>
</body></html>`;
}

/** Sdílí stránku přes systémové sdílení; když to nejde, nabídne uložení. */
export async function shareHtml(html: string, name: string, title: string) {
  const f = new File([html], name, { type: "text/html" });
  try {
    if (!navigator.canShare?.({ files: [f] })) throw new Error("prohlížeč neumí sdílet soubory");
    await navigator.share({ files: [f], title, text: tr(`${title} – srovnání ponorů z reLogu`) });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    if (await choose(`Sdílení se nepovedlo (${(e as Error).message}). Uložit stránku do telefonu?`, [{ key: "save", label: "Uložit .html", primary: true }])) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast(`Uloženo: ${name}`);
    }
  }
}
