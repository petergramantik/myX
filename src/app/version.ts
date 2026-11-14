// Verze aplikace a „Co je nového“. Drobnosti zvyšují setinu (1.0 → 1.0.1), větší změny desetinu (1.0 → 1.1).
export const APP_VERSION = "1.2.2";

export interface Release { version: string; date: string; title: string; items: string[] }

export const RELEASES: Release[] = [
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
