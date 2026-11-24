// Datový model logbooku a sloučení dvou verzí (telefon × Worker) po položkách podle času změny.
import type { Rig } from "../core/rig";
import type { Header } from "../core/shearwater";
import type { Summary, Thresholds } from "../core/analysis";
import { DEFAULT_THRESHOLDS } from "../core/analysis";
import { DEFAULT_CELL_TH, type CellDive, type CellThresholds } from "../core/cells";

export interface SpInfo {
  id: number; name?: string; lat?: number; lon?: number; maxDepth?: number; type?: string; region?: string;
  visibility?: number; temps?: (number | null)[]; rating?: string; fetched: number;
}
export interface Site { id: string; name: string; lat?: number; lon?: number; spId?: number; sp?: SpInfo; note?: string; updated: number }
export interface Buddy { id: string; name: string; note?: string; updated: number }
export type Rating = "up" | "down" | "problem";
export interface WeatherSnap { at: number; temp: number; wind: number; gust: number; cloud: number; pressure: number; precip: number; code: number }
/** Externí lahev připojená během ponoru (Petrel její tlak neměří). */
export interface ExtGas { id: string; /** sup = zásobní plyn přístroje bez vysílačů (pSCR, OC…) */ gas: "dil" | "o2" | "sup"; kind: string; vol: number; start?: number; end?: number }
/** Off-board lahev z předponorové přípravy (bailout, off-board O₂…). */
export interface PrepTank { id: string; role: "bo" | "o2" | "dil" | "deco" | "suit" | "other"; name: string; gas: string; /** lahev z Výstroje */ gearId?: string; bar?: number; /** tlak po ponoru */ end?: number; /** beze změny (lahev nepoužitá) – konec = začátek */ same?: boolean; /** objem (l); jinak z označení S80/S40… */ vol?: number }
/** Objem lahve (l) z ručního zadání nebo z označení (S80, S40, 12 l…). */
export function tankVol(t: { vol?: number; name: string }): number | null {
  if (t.vol) return t.vol;
  const n = t.name.trim().toUpperCase().replace(",", ".");
  const al: Record<string, number> = { S80: 11.1, S63: 9, S40: 5.7, S30: 4.3, S20: 2.8, S13: 1.9 };
  if (al[n]) return al[n];
  const m = /^(\d+(?:\.\d+)?)\s*L?$/.exec(n);
  return m ? +m[1] : null;
}
/** Plyn lahve jako směs O₂/He (vzduch, EAN32, 18/45, O₂…); null = nečitelné. */
export function tankMix(g: string): string | null {
  const t = g.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  if (/^(vzduch|air)$/.test(t)) return "21/0";
  if (/^(o2|o₂|kyslík|kyslik|100)$/.test(t)) return "100/0";
  let m = /^(?:ean|nx|nitrox)(\d+)$/.exec(t); if (m) return `${+m[1]}/0`;
  m = /^(?:tmx|tx|trimix)?(\d+)\/(\d+)$/.exec(t); if (m) return `${+m[1]}/${+m[2]}`;
  return null;
}
/** Předponorová příprava: naměřené tlaky (bar) on-board lahví, off-board lahve a potvrzení kalibrace (ms). */
export interface Prep { o2?: number; dil?: number; tanks?: PrepTank[]; o2Cal?: number; co2Cal?: { at: number; gas: string }; /** hydratace před ponorem (jen informace) */ hyd?: "low" | "mid" | "good" }
export const HYD_LABEL = { low: "Slabá", mid: "Střední", good: "Dobrá" } as const;
export interface DiveNote {
  siteId?: string; buddyIds: string[]; note: string; rating?: Rating; weather?: WeatherSnap;
  ext?: ExtGas[]; useManual?: { dil?: number; o2?: number }; prep?: Prep; /** poloha z rozpracovaného ponoru (místo ponoru) */ pos?: { lat: number; lon: number }; /** skrytá upozornění: „t:název“ nebo „c:KATEGORIE“ */ hideW?: string[]; /** on-board lahve rebreatheru z Výstroje použité v ponoru (auto = rozpoznáno automaticky) */ rb?: { o2?: { id: string; auto?: boolean }; dil?: { id: string; auto?: boolean } }; /** CO₂ v ponoru: porucha čidla / potvrzené skutečné */ co2?: "fault" | "real"; /** skrytí „c:CO₂“ přidala volba Porucha čidla (při zrušení se vrátí jen ono) */ co2Hid?: boolean; updated: number;
}
/** Hodnota CO₂ nad touto mezí (mbar) je podezřelá (pravděpodobně porucha čidla), dokud ji uživatel nepotvrdí. */
export const CO2_SUSPECT = 20;
/** Stav CO₂ ponoru pro statistiky: ok, porucha (ruční), podezřelé (nad 20 mbar), nevěrohodné (oříznutá nula). */
export function co2State(m: { sum: { co2Max: number | null; co2Bad?: boolean } }, note?: { co2?: "fault" | "real" }): "ok" | "fault" | "suspect" | "clipped" {
  if (note?.co2 === "fault") return "fault";
  if (m.sum.co2Max != null && m.sum.co2Max > CO2_SUSPECT && note?.co2 !== "real") return "suspect";
  if (m.sum.co2Bad) return "clipped";
  return "ok";
}
/** Ponor založený na lokalitě před stažením logu; po importu se spáruje s ponorem z počítače. */
export interface Draft extends DiveNote { id: string; created: number; lat?: number; lon?: number; diveId?: string }
/** Záznam o O₂ čidle v cartridgi. Data ve formátu RRRR-MM-DD. */
export interface Cell { id: string; pos: 1 | 2 | 3; maker: string; type?: string; sn?: string; made?: string; installed: string; lifeM: number; removed?: string; reason?: string; note?: string; updated: number }
/** Baterie v hlavě X-CCR (pozice 1 nebo 2). Data ve formátu RRRR-MM-DD. */
export interface Battery { id: string; pos: 1 | 2; maker: string; model?: string; volt?: string; installed: string; removed?: string; note?: string; updated: number }
export interface HeadBatTh { headBatHours: number; headBatMonths: number } // 0 = vypnuto
/** Ruční údaj o poslední kalibraci čidla CO₂ (log ji neukládá). */
export interface Co2Cal { date: string; gas: string }
export interface Settings { th: Thresholds & CellThresholds & HeadBatTh; manualFill: number | null; /** spotřeba ve stresu pro výpočet bailoutu (l/min), vzduch do hloubky (m), násobek TTS pro dekompresi na OC */ boSac?: number; boAirMax?: number; boTtsMul?: number; /** lahve mimo rebreather: „Doplnit“ pod tolika % plnicího tlaku; výchozí plnicí tlak (bar) */ fillPct?: number; fillBar?: number; /** pořadí skupin lahví (název → číslo) */ tankGroupOrd?: Record<string, number>; /** SurfGF při vynoření: vypnuto / hranice upozornění (%) */ surfGfOff?: boolean; surfGfLim?: number; co2Cal?: Co2Cal | null; /** poslední potvrzená kalibrace čidel O₂ (z přípravy) */ o2Cal?: { date: string } | null; motto?: boolean; cyl?: { dil: number; o2: number }; /** objemy on-board lahví parťáků (l) podle počítače – pro srovnání spotřeby */ cylOf?: Record<string, { o2?: number; dil?: number }>; spLateSet?: boolean; /** spojit záznamy s povrchovým intervalem do (min), 0 = vypnuto */ segGap?: number; /** ruční spojení / rozdělení: id záznamu → true = připojit k předchozímu, false = oddělit */ segOv?: Record<string, boolean>; /** „Baterii jsem vyměnil“: sériové číslo počítače → místní čas kliknutí (skryje upozornění do dalšího ponoru) */ batSwap?: Record<string, number>; /** moje jméno ve sdíleném srovnání (místo „Já“) */ myName?: string; updated: number }

export interface Logbook {
  drafts: Record<string, Draft>;
  cells: Record<string, Cell>;
  batteries: Record<string, Battery>;
  answered: Record<string, { answer: "change" | "cal"; updated: number }>; // odpovědi na dotaz „vyměnil jsi čidlo?“ (klíč pozice:idPonoru)
  sites: Record<string, Site>;
  buddies: Record<string, Buddy>;
  notes: Record<string, DiveNote>;
  deleted: Record<string, number>; // id smazané/sloučené lokality nebo parťáka → čas
  settings: Settings;
  computers?: Record<string, Computer>; // sériové číslo cizího počítače → majitel (buddy)
  aliases?: Record<string, Alias>;     // jméno buddyho/lokality z cizího logu → můj záznam
  tanks?: Record<string, GearTank>;    // Výstroj: moje lahve
  regs?: Record<string, GearReg>;      // Výstroj: moje sestavy (automatiky)
}

/** Lahev ve Výstroji. Dvojče = 2 ocelové lahve (objem jedné × 2) jako jedna lahev. */
export interface GearTank {
  id: string; kind: string; /** objem jedné lahve (l); u dvojčete jedné z dvojice */ vol: number; name?: string; mix: string;
  /** zbytkový tlak (bar) a kdy byl zadán / převzat z ponoru */ bar?: number; barAt?: number;
  /** po ponoru se tlak nepřepsal (lahev zavřená / tlak chybí) – zkontrolovat */ check?: { at: number; text: string };
  /** poslední převzetí z ponoru (aby se při úpravě téhož ponoru tlak znovu nepřepisoval); prev = tlak před převzetím (pro vrácení při změně přiřazení) */ fromDive?: { id: string; end?: number; prev?: { bar?: number; barAt?: number } };
  revLast?: string; revNext?: string; revYears?: number; o2?: boolean; note?: string; updated: number;
  /** on-board lahev rebreatheru (objem se bere pro výpočty spotřeby) */ onboard?: "o2" | "dil";
  /** účel: plnění (lahev na přepouštění plynu) */ use?: "fill";
  /** plnicí tlak lahve (bar); jinak výchozí z nastavení */ fillBar?: number;
  /** vlastní skupiny (např. RB, Kurzy); lahev může být ve více */ groups?: string[];
}
export const GEAR_TANK_KINDS = ["S80", "S40", "12 l", "3 l", "2,5 l", "Dvojče", "Jiná"];
export const TWIN_VOLS = [8, 10, 12, 15, 18];
/** Celkový objem lahve (l). */
export const gearVol = (t: GearTank) => (t.kind === "Dvojče" ? 2 * t.vol : t.vol);
export const gearKindVol = (k: string): number | null => ({ S80: 11.1, S40: 5.7, "12 l": 12, "3 l": 3, "2,5 l": 2.5, Dvojče: 12 } as Record<string, number>)[k] ?? null;
export interface GearStage { model?: string; svcLast?: string; svcNext?: string; svcYears?: number }
export interface GearHose { id: string; len?: number; type: "HP" | "LP" | "inflátor" | "Swagelok"; o2?: boolean; note?: string }
export interface GearFault { id: string; at: number; text: string; diveId?: string; fix?: { at: number; kind: "oprava" | "výměna"; text?: string } }
/** Sestava = automatika (1. a 2. stupeň s hadicemi). */
export interface GearReg { id: string; name: string; s1: GearStage; s2: GearStage; hoses: GearHose[]; o2?: boolean; faults: GearFault[]; note?: string; updated: number }
/** Jak dlouho po termínu (revize): „3 roky“, „7 měsíců“, „méně než měsíc“ – roky zaokrouhlené, pod rok měsíce. */
export function overdueText(due: string, now = Date.now()): string {
  const m = Math.round((now - new Date(due).getTime()) / (30.44 * 86400000));
  const cz = (n: number, a: string, b: string, c: string) => `${n} ${n === 1 ? a : n >= 2 && n <= 4 ? b : c}`;
  if (m < 1) return "méně než měsíc";
  if (m < 12) return cz(m, "měsíc", "měsíce", "měsíců");
  return cz(Math.round(m / 12), "rok", "roky", "let");
}
export const REV_YEARS = 5, SVC_YEARS = 2, FILL_PCT = 85, FILL_BAR = 200, RB_LOW = 100;
/** Pod jakým tlakem lahev „Doplnit“: on-board 100 bar, ostatní % plnicího tlaku (lahve na plnění se nehlídají → null). */
export function tankLowBar(t: GearTank, set?: { fillPct?: number; fillBar?: number }): number | null {
  if (t.use === "fill") return null;
  if (t.onboard) return RB_LOW;
  return Math.round(((t.fillBar || set?.fillBar || FILL_BAR) * (set?.fillPct || FILL_PCT)) / 100);
}
/** Datum dalšího termínu: zadané, jinak poslední + interval (roky). */
export function nextDue(last?: string, next?: string, years?: number): string | undefined {
  if (next) return next;
  if (!last) return undefined;
  const d = new Date(last); d.setFullYear(d.getFullYear() + (years || 0));
  return d.toISOString().slice(0, 10);
}
/** Stav termínu: po termínu / do 30 dní / v pořádku / nezadáno. */
export function dueState(due?: string, now = Date.now()): "over" | "soon" | "ok" | "none" {
  if (!due) return "none";
  const t = new Date(due).getTime();
  return t < now ? "over" : t - now < 30 * 86400000 ? "soon" : "ok";
}
/** Jméno z cizího logu přiřazené k mému buddymu nebo lokalitě (klíč „buddy:jméno“ / „site:jméno“ v normalizované podobě). */
export interface Alias { id: string; kind: "buddy" | "site"; name: string; targetId: string; updated: number; /** odkud jméno pochází (cizí log), pro zobrazení v B&L */ from?: string }
export const aliasKey = (kind: "buddy" | "site", name: string) => `${kind}:${norm(name)}`;
/** Cizí počítač rozpoznaný podle sériového čísla v logu a jeho majitel. */
export interface Computer { id: string; model: string; buddyId?: string; primary?: boolean; /** můj počítač (cíleně přidaný, např. po výměně počítače) */ mine?: boolean;
  /** typ dýchacího přístroje (výchozí pro ponory z tohoto počítače) */ rig?: Rig; /** zásobní plyn O₂ % (polouzavřený okruh v Gauge módu – počítač plyn nezná) */ supplyO2?: number;
  /** poměr dávkování pSCR (1 : N) */ pscrRatio?: number;
  /** scrubber bez časovače v logu: ruční datum naplnění (s, místní čas) a výdrž náplně (min) */ scrubFill?: number; scrubMin?: number; /** nepojmenované vysílače AI: který je diluent (druhý = O₂) */ aiDil?: "T1" | "T2";
  /** model rebreatheru (určuje baterie v hlavě) */ ccr?: CcrModel;
  /** změny u jednotlivých ponorů */ dives?: Record<string, { rig?: Rig; supplyO2?: number }>; updated: number }

export const META_V = 32;

/** Model rebreatheru – kolik baterií má hlava, jakého typu a co napájí. */
export type CcrModel = "xccr" | "flex2" | "fx" | "jj" | "tp" | "other";
export interface HeadBat { pos: 1 | 2; role?: string; /** krátce na dlaždici */ short?: string; type?: string }
export const CCR_MODELS: { id: CcrModel; label: string; bats: HeadBat[]; note?: string }[] = [
  { id: "xccr", label: "X-CCR (iQsub)", bats: [{ pos: 1, role: "solenoid", type: "Li-Ion 3,7 V 18650" }, { pos: 2, role: "HUD a výstup pO₂", short: "HUD", type: "Li-Ion 3,7 V 18650" }] },
  { id: "flex2", label: "FLEX2 (iQsub)", bats: [{ pos: 1, role: "solenoid", type: "Li-Ion 18500" }, { pos: 2, role: "HUD a výstup pO₂", short: "HUD", type: "Li-Ion 18500" }] },
  { id: "fx", label: "FX CCR (iQsub)", bats: [{ pos: 1, role: "elektronika, solenoid a HUD", short: "vše" }], note: "Bateriový kontejner na kabelu – typ baterií neznáme (?)." },
  { id: "jj", label: "JJ-CCR", bats: [{ pos: 1 }, { pos: 2 }], note: "Typ a funkce baterií neznáme (?)." },
  { id: "tp", label: "Tres Presidentes (pSCR)", bats: [], note: "Bez elektroniky – žádné baterie v hlavě." },
  { id: "other", label: "Jiný", bats: [{ pos: 1 }, { pos: 2 }] },
];
/** Výchozí X-CCR (aplikace vznikla pro X-CCR). */
export const ccrModel = (id?: CcrModel) => CCR_MODELS.find((m) => m.id === (id || "xccr"))!;
export interface Meta { id: string; num: number; start: number; h: Header; sum: Summary; inj: number; cells: CellDive; v: number; prof?: number[]; cnum?: number; /** model počítače z názvu souboru (Petrel 2…) */ model?: string; comp?: string; /** spojený ponor: všechny záznamy (jen v zobrazení) */ parts?: Meta[]; alt?: string; warns?: { level: "warn" | "bad"; title: string; text: string }[] }

export const DEFAULT_ALL_TH = { ...DEFAULT_THRESHOLDS, ...DEFAULT_CELL_TH, headBatHours: 0, headBatMonths: 0 };
export const emptyLogbook = (): Logbook => ({
  drafts: {}, cells: {}, batteries: {}, answered: {}, sites: {}, buddies: {}, notes: {}, deleted: {},
  settings: { th: { ...DEFAULT_ALL_TH }, manualFill: null, updated: 0 },
});

function mergeMap<T extends { updated: number }>(a: Record<string, T>, b: Record<string, T>, deleted: Record<string, number>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k];
    const v = !x ? y : !y ? x : x.updated >= y.updated ? x : y;
    if (deleted[k] && deleted[k] >= v.updated) continue;
    out[k] = v;
  }
  return out;
}

/** Hranici pozdního setpointu bere z výchozí hodnoty, dokud ji uživatel sám nezměnil. */
const fixSettings = (x: Settings): Settings => (x.spLateSet ? x : { ...x, th: { ...x.th, spLateMin: DEFAULT_ALL_TH.spLateMin } });

export function mergeLogbooks(a: Logbook, b: Logbook): Logbook {
  const deleted = { ...a.deleted };
  for (const [k, t] of Object.entries(b.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, t);
  return {
    drafts: mergeMap(a.drafts || {}, b.drafts || {}, deleted),
    cells: mergeMap(a.cells || {}, b.cells || {}, deleted),
    batteries: mergeMap(a.batteries || {}, b.batteries || {}, deleted),
    answered: mergeMap(a.answered || {}, b.answered || {}, {}),
    sites: mergeMap(a.sites, b.sites || {}, deleted),
    buddies: mergeMap(a.buddies, b.buddies || {}, deleted),
    notes: mergeMap(a.notes, b.notes || {}, deleted),
    computers: mergeMap(a.computers || {}, b.computers || {}, deleted),
    aliases: mergeMap(a.aliases || {}, b.aliases || {}, deleted),
    tanks: mergeMap(a.tanks || {}, b.tanks || {}, deleted),
    regs: mergeMap(a.regs || {}, b.regs || {}, deleted),
    deleted,
    settings: fixSettings((b.settings?.updated || 0) > a.settings.updated
      ? { ...a.settings, ...b.settings, th: { ...DEFAULT_ALL_TH, ...b.settings.th } }
      : { ...a.settings, th: { ...DEFAULT_ALL_TH, ...a.settings.th } }),
  };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const siteCoords = (s: Site): { lat: number; lon: number } | null =>
  s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : s.sp?.lat != null && s.sp?.lon != null ? { lat: s.sp.lat, lon: s.sp.lon } : null;

/**
 * Úklid mého logbooku od dat z cizích logů (ponory cizích logů mají id „log:ponor“): odstraní jejich záznamy
 * a lokality / buddye, které používaly jen ony (ne ty s mým ponorem, rozpracovaným ponorem, přiřazením nebo počítačem).
 */
export function cleanForeign(lb0: Logbook, ownIds: Set<string>, now = Date.now()): { lb: Logbook; notes: number; names: string[] } {
  const lb: Logbook = { ...lb0, notes: { ...lb0.notes }, sites: { ...lb0.sites }, buddies: { ...lb0.buddies }, deleted: { ...lb0.deleted } };
  const bad = Object.keys(lb.notes).filter((id) => id.includes(":") && !ownIds.has(id));
  if (!bad.length) return { lb: lb0, notes: 0, names: [] };
  const susp = new Set<string>();
  for (const id of bad) { const n = lb.notes[id]; if (n.siteId) susp.add(n.siteId); n.buddyIds.forEach((b) => susp.add(b)); delete lb.notes[id]; lb.deleted[id] = now; }
  const used = new Set<string>();
  for (const n of Object.values(lb.notes)) { if (n.siteId) used.add(n.siteId); n.buddyIds.forEach((b) => used.add(b)); }
  for (const d of Object.values(lb.drafts || {})) { if (d.siteId) used.add(d.siteId); d.buddyIds.forEach((b) => used.add(b)); }
  for (const a of Object.values(lb.aliases || {})) used.add(a.targetId);
  for (const c of Object.values(lb.computers || {})) if (c.buddyId) used.add(c.buddyId);
  const names: string[] = [];
  for (const id of susp) {
    if (used.has(id)) continue;
    const x = lb.sites[id] || lb.buddies[id];
    if (!x) continue;
    names.push(x.name);
    delete lb.sites[id]; delete lb.buddies[id]; lb.deleted[id] = now;
  }
  return { lb, notes: bad.length, names };
}

/** Úplný reset logbooku: smaže lokality, buddye, záznamy k ponorům, rozpracované ponory, přiřazení jmen a počítače.
 *  Čidla, baterie, odpovědi a nastavení zůstanou. Smazané id se označí, aby se nevrátily synchronizací. */
export function resetLogbook(lb: Logbook, now = Date.now()): Logbook {
  const deleted = { ...lb.deleted };
  for (const m of [lb.sites, lb.buddies, lb.notes, lb.drafts || {}, lb.aliases || {}, lb.computers || {}]) for (const k of Object.keys(m)) deleted[k] = now;
  return { ...lb, sites: {}, buddies: {}, notes: {}, drafts: {}, aliases: {}, computers: {}, deleted };
}
