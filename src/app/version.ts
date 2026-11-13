// Verze aplikace a „Co je nového“. Drobnosti zvyšují setinu (1.0 → 1.0.1), větší změny desetinu (1.0 → 1.1).
export const APP_VERSION = "1.0";

export interface Release { version: string; date: string; title: string; items: string[] }

export const RELEASES: Release[] = [
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
