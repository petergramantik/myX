// Tagy problémů v seznamu ponorů: kategorie z oranžových a červených varování (stejný zdroj jako záhlaví detailu).
export type TagCat = "pO₂" | "CO₂" | "ČIDLO" | "TLAK" | "BAT" | "SP" | "BO" | "GF";
export const TAG_ORDER: TagCat[] = ["pO₂", "CO₂", "ČIDLO", "TLAK", "BO", "GF", "BAT", "SP"];
export interface DiveTag { cat: TagCat; level: "warn" | "bad"; cells: number[]; label: string }

export function tagCat(title: string): TagCat | null {
  if (/^Bailout/.test(title)) return "BO";
  if (/^SurfGF/.test(title)) return "GF";
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

/** Upozornění skryté u ponoru (hideW: „t:název“ nebo „c:KATEGORIE“) – nepočítá se do hodnocení, zůstane v událostech. */
export function isHiddenW(title: string, hide?: string[]): boolean {
  if (!hide?.length) return false;
  const base = title.replace(/ – \d+×$/, "");
  const cat = tagCat(base);
  // x: = kategorie, ve které po skrytí nezůstalo žádné viditelné upozornění (tag v seznamu má zmizet)
  return hide.includes("t:" + base) || (!!cat && (hide.includes("c:" + cat) || hide.includes("x:" + cat)));
}

/** Klíče skrytí doplněné o kategorie, ve kterých po skrytí nezůstalo žádné viditelné upozornění („x:“). */
export function withEmptiedCats(keys: string[], titles: string[]): string[] {
  const base = keys.filter((k) => !k.startsWith("x:"));
  const cats = new Set(titles.map(tagCat).filter(Boolean) as TagCat[]);
  const vis = new Set(titles.filter((t) => !isHiddenW(t, base)).map(tagCat).filter(Boolean) as TagCat[]);
  return [...base, ...[...cats].filter((c) => !vis.has(c)).map((c) => "x:" + c)];
}
