// Tagy problémů v seznamu ponorů: kategorie z oranžových a červených varování (stejný zdroj jako záhlaví detailu).
export type TagCat = "pO₂" | "CO₂" | "ČIDLO" | "TLAK" | "BAT" | "SP";
export const TAG_ORDER: TagCat[] = ["pO₂", "CO₂", "ČIDLO", "TLAK", "BAT", "SP"];
export interface DiveTag { cat: TagCat; level: "warn" | "bad"; cells: number[]; label: string }

export function tagCat(title: string): TagCat | null {
  if (/CO₂/.test(title)) return "CO₂";
  if (/pO₂|hypoxi/i.test(title)) return "pO₂";
  if (/^Nízký tlak/.test(title)) return "TLAK";
  if (/baterie/i.test(title)) return "BAT";
  if (/čidl|vlhkost/i.test(title)) return "ČIDLO";
  if (/setpoint/i.test(title)) return "SP";
  return null;
}

/** Čísla O₂ čidel zmíněná v nadpisu nebo popisu („čidlo 1“, „čidla 1 a 3“, „čidlem 2“). */
export function cellsIn(title: string, text = ""): number[] {
  const out = new Set<number>();
  for (const src of [title, text]) for (const m of src.matchAll(/[čČ]idl\w*\s+((?:[1-3](?:\s*(?:,|a)\s*)?)+)/g)) for (const d of m[1].match(/[1-3]/g) || []) out.add(+d);
  return [...out].sort();
}

export function diveTagsOf(ws: { level: string; title: string; text?: string }[]): DiveTag[] {
  const map = new Map<TagCat, DiveTag>();
  for (const w of ws) {
    if (w.level !== "warn" && w.level !== "bad") continue;
    const cat = tagCat(w.title);
    if (!cat) continue;
    const t = map.get(cat) || { cat, level: "warn" as const, cells: [], label: cat };
    if (w.level === "bad") t.level = "bad";
    if (cat === "ČIDLO") t.cells = [...new Set([...t.cells, ...cellsIn(w.title, w.text)])].sort();
    map.set(cat, t);
  }
  return TAG_ORDER.filter((c) => map.has(c)).map((c) => { const t = map.get(c)!; return { ...t, label: c === "ČIDLO" && t.cells.length ? `ČIDLO ${t.cells.join(" ")}` : c }; });
}
