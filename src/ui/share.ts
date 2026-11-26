// Sdílení souboru .db (vybrané ponory nebo celý log): uložit jako .db, nebo poslat přes aplikace jako .txt
// (Chrome na Androidu nedovolí sdílet z webu soubor .db, text ano; myX pozná soubor podle obsahu).
import { LOC, tr } from "../app/i18n";
import { exportDives, segInfo, toast } from "../app/store";
import { choose } from "../app/dialog";
import type { Meta } from "../app/model";

/** Všechna id záznamů ponoru (spojený ponor = všechny jeho části). */
export function partIds(m: Meta): string[] {
  if (m.parts?.length) return m.parts.map((p) => p.id);
  const p = segInfo().parts.get(m.id);
  return p?.length ? p.map((x) => x.id) : [m.id];
}

const save = (data: Uint8Array, name: string) => {
  const f = new File([data], name, { type: "application/octet-stream" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Uloženo: ${name}`);
};

/** Krátký návod pro příjemce (WhatsApp ho u dokumentů někdy nepošle – proto i do schránky). */
export function shareText(what: string): string {
  const base = location.href.split("#")[0].replace(/\/dev\/.*$/, "/").replace(/[^/]*$/, "");
  return tr(`${what} z myX (${new Date().toLocaleDateString(LOC)}). Otevření v myX: podrž soubor → Sdílet → (Další aplikace) → myX. myX: ${base}`);
}

/** Nabídne uložení jako .db nebo poslání přes systémové sdílení jako .txt. */
export async function shareDb(data: Uint8Array, name: string, what: string) {
  const db = name.endsWith(".db") ? name : name + ".db";
  const k = await choose(`${what} – jak sdílet?`, [
    { key: "send", label: "Poslat přes… (WhatsApp, Messenger, mail)", note: "Odejde jako .txt s krátkým návodem (je i ve schránce, kdyby ho aplikace k souboru nepřidala).", primary: true },
    { key: "save", label: "Uložit jako .db", note: "Do Stažených souborů; otevře ho myX i Shearwater Cloud." },
  ]);
  if (k === "save") { save(data, db); return; }
  if (k !== "send") return;
  const f = new File([data], db + ".txt", { type: "text/plain" });
  try { await navigator.clipboard?.writeText(shareText(what)); } catch { /* schránka nedostupná */ }
  try {
    if (!navigator.canShare?.({ files: [f] })) throw new Error("prohlížeč neumí sdílet soubory");
    await navigator.share({ files: [f], title: what, text: shareText(what) });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    if (await choose(`Sdílení se nepovedlo (${(e as Error).message}). Uložit soubor jako .db?`, [{ key: "save", label: "Uložit jako .db", primary: true }])) save(data, db);
  }
}

export async function shareDives(ms: Meta[]) {
  if (!ms.length) return;
  try {
    const r = await exportDives([...new Set(ms.flatMap(partIds))]);
    await shareDb(r.data, r.name, ms.length > 1 ? `${ms.length} ponory` : "Ponor");
  } catch (e) { toast("Sdílení se nepovedlo: " + (e as Error).message); }
}
