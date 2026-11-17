// Sdílení vybraných ponorů jako malý soubor .db (formát Shearwater Cloud + údaje myX).
import { exportDives, segInfo, toast } from "../app/store";
import type { Meta } from "../app/model";

/** Všechna id záznamů ponoru (spojený ponor = všechny jeho části). */
export function partIds(m: Meta): string[] {
  if (m.parts?.length) return m.parts.map((p) => p.id);
  const p = segInfo().parts.get(m.id);
  return p?.length ? p.map((x) => x.id) : [m.id];
}

export async function shareDives(ms: Meta[]) {
  if (!ms.length) return;
  try {
    const r = await exportDives([...new Set(ms.flatMap(partIds))]);
    const f = new File([r.data], r.name, { type: "application/octet-stream" });
    const what = ms.length > 1 ? `${ms.length} ponory` : "Ponor";
    try {
      if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: what, text: `${what} z myX – otevři v myX (Sdílet → myX).` }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Soubor uložen – pošli ho parťákovi");
  } catch (e) { toast("Sdílení se nepovedlo: " + (e as Error).message); }
}
