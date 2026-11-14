// Verze aplikace a „Co je nového“. Drobnosti zvyšují setinu (1.0 → 1.0.1), větší změny desetinu (1.0 → 1.1).
export const APP_VERSION = "1.5.1";

export interface Release { version: string; date: string; title: string; items: string[] }

export const RELEASES: Release[] = [
  {
    version: "1.5.1", date: "14. 11. 2026", title: "Detail ponoru",
    items: [
      "Lokalita jako nadpis pod záložkami, pod ní buddy",
      "Logbook: V kostce, profil ponoru, pak zadání lokality a buddy",
      "Graf profilu: zastávky jen tam, kde jsi na nich opravdu byl; zakázaná zóna nad stropem vyplněná",
    ],
  },
  {
    version: "1.5", date: "14. 11. 2026", title: "Čidlo CO₂",
    items: [
      "Dlaždice čidla CO₂ vedle O₂ čidel: maximum a průměr z posledního ponoru, nebo „Deaktivováno“",
      "V panelu čidel detail CO₂ a ruční zadání data a plynu poslední kalibrace",
    ],
  },
  {
    version: "1.4.1", date: "14. 11. 2026", title: "Přehlednější panely a klikatelné Celkem",
    items: [
      "Čidla a baterie v rozbalovacích panelech mají vlastní dlaždice s nadpisem v barvě stavu",
      "Dlaždice v Celkem otevírají seznam ponorů, lokalit, buddy a rekordní ponory",
      "Nejhlubší ponor zvlášť pro TMX (diluent jiný než vzduch) a AIR",
      "Parťáci přejmenováni na Buddy",
    ],
  },
  {
    version: "1.4", date: "14. 11. 2026", title: "Okno Varování a kompaktní scrubber",
    items: [
      "Všechna varování na jednom místě: ikona ⚠ v záhlaví nebo přejetí prstem doprava na přehledu",
      "Scrubber kompaktně: zbývající čas a stáří vedle sebe, barvy podle zbytku a stáří, datum výměny",
      "Čidlo za životností, které dává funkční hodnoty, je oranžové, ne červené",
    ],
  },
  { version: "1.3.2", date: "14. 11. 2026", title: "Bez fotek čidel", items: ["Odstraněny fotky čidel"] },
  {
    version: "1.3.1", date: "14. 11. 2026", title: "Přehlednější dlaždice, skutečný čas deko",
    items: [
      "Dlaždice čidel a baterií ukazují jen hlavní hodnotu a stav, podrobnosti jsou v rozbalovacím panelu",
      "Deko = čas skutečně strávený na zastávkách (nejvýš 3 m pod hloubkou zastávky); deko režim je v detailu ponoru",
      "V kartě Celkem jsou zpět Nejhlubší a Nejdelší ponor",
    ],
  },
  {
    version: "1.3", date: "14. 11. 2026", title: "Panely čidel a baterií, fotky čidel",
    items: [
      "Pod dlaždicemi čidel rozbalovací panel: stav, poslední kalibrace, upozornění ke každému čidlu, dotazy na výměnu",
      "Výměnu i vyjmutí čidla zadáš přímo v panelu, se sériovým číslem a fotkou štítku",
      "Kontrola data výměny proti logu s nabídkou opravy",
      "Prázdná pozice po vyjmutí čidla",
      "Rozbalovací panel baterií s procenty v hlavičce",
      "Nové pořadí dlaždic posledního ponoru (diluent a O₂ za sebou)",
    ],
  },
  {
    version: "1.2.2", date: "14. 11. 2026", title: "Poslední ponor přehledněji",
    items: [
      "Hloubka s průměrnou hloubkou, doba s časem na dekompresi",
      "Tlak O₂ a diluentu na začátku a na konci ponoru",
      "Všechny tři baterie v jedné dlaždici",
      "CNS jen v detailu ponoru",
    ],
  },
  {
    version: "1.2.1", date: "14. 11. 2026", title: "Drobné úpravy přehledu",
    items: [
      "Tlačítko Nový ponor je na přehledu úplně dole",
      "Doba posledního ponoru se klepnutím přepne mezi minutami a hodinami s minutami",
      "Celková doba pod vodou v hodinách a minutách",
    ],
  },
  {
    version: "1.2", date: "14. 11. 2026", title: "Baterie a nové záhlaví",
    items: [
      "Dlaždice baterií na přehledu: Petrel z logu (napětí, typ, trend) a dvě baterie v hlavě",
      "Evidence baterií v hlavě: typ, datum výměny, hodiny a ponory od výměny, historie",
      "Varování pro baterie v hlavě po nastaveném počtu hodin nebo měsíců",
      "Tlačítko ＋ v záhlaví pro nový ponor",
      "Záhlaví ve tvaru „myX – název obrazovky“",
    ],
  },
  {
    version: "1.1.1", date: "14. 11. 2026", title: "Přehlednější scrubber a čidla",
    items: [
      "Scrubber: velkým písmem zbývající čas, pod ním použitý čas, popisky u pruhu",
      "Čas scrubberu všude v hodinách a minutách",
      "Upozornění „Sorbent příliš starý“ místo „Scrubber dlouho otevřený“",
      "Dlaždice čidel s popisky: mV na vzduchu, O₂ 1 bar, výměna, stáří",
      "„Ano, zadat čidlo“ otevře rovnou formulář s předvyplněným datem",
    ],
  },
  {
    version: "1.1", date: "14. 11. 2026", title: "Čidla, scrubber a nový ponor",
    items: [
      "Přehled začíná dlaždicí scrubberu (zbývající čas, náplň, varování) a třemi dlaždicemi O₂ čidel",
      "Stav čidel z logu: citlivost v mV/bar a mV na vzduchu, pokles citlivosti, podezření na current limiting, stáří",
      "Historie čidel (výrobce, výroba, instalace, životnost, pozice) a dotaz při zjištěné výměně",
      "Poslední kalibrace odvozená z logu",
      "Tlačítko Nový ponor: poloha, lokalita a počasí se předvyplní, po importu se ponor spáruje podle času",
      "Hodnocení ponoru 👍 👎 ❗ a nový přehlednější seznam ponorů s hloubkou a časem",
      "Upozornění na baterii zvlášť pro každý počítač",
      "Počasí už není na přehledu, ukládá se k ponoru",
    ],
  },
  {
    version: "1.0", date: "13. 11. 2026", title: "První verze",
    items: [
      "Import exportu ze Shearwater Cloud přímo v telefonu (Petrel 2, X-CCR)",
      "Logbook: lokalita, parťáci a poznámka u každého ponoru, databáze lokalit a parťáků",
      "Párování lokalit se Stranami potápěčskými a počasí pro lokalitu",
      "Poloha při spuštění a nabídka nejbližší lokality",
      "Grafy ponoru: profil, pO₂ a články (mV i odvozená kalibrace), CO₂, dekomprese, tlaky, baterie, tkáně",
      "Odhad vstřiků O₂ ze skoků pO₂",
      "Upozornění: scrubber za polovinou nebo dlouho otevřený, slábnoucí baterie, vysoké CO₂",
      "Synchronizace přes Worker a záloha do souboru",
    ],
  },
];
