# myX – pravidla projektu

- S uživatelem komunikuj česky.
- Nové požadavky zapisuj jen do číslovaného TODO listu (v chatu, ne do repozitáře). Implementuj až po pokynu „imp“ (nebo „im“).
- Jen produkční verze (větev `main`), žádná dev větev.
- Po implementaci: `bun tests/core.test.ts` musí projít, `./build.sh` musí projít, commit a push do `main` – GitHub Actions otestují a nasadí na GitHub Pages.
- Verze: v `src/app/version.ts` zvýšit `APP_VERSION` a přidat nahoru položku do `RELEASES`. Drobnosti zvyšují setinu (1.0 → 1.0.1), desetina (1.0 → 1.1) jen u významných změn.
- Dekódování logu Shearwater (`src/core/shearwater.ts`) a analýzy (`src/core/analysis.ts`) měň opatrně a doplň test. Do repozitáře nikdy nedávej soubory s daty ponorů (repo je veřejné).
- Worker (`proxy/worker.js`) – synchronizace (KV `MYX_KV`, secret `MYX_KEY`) a proxy Stran potápěčských. Změnu Workeru musí uživatel vložit do Cloudflare ručně; adresa je v `public/config.js`.

## Formát logu (Petrel 2, DiveCAN, X-CCR)
- 32bajtové záznamy: 0x10–0x18 hlavička, 0x01 vzorek, 0xE1 rozšířený vzorek (dil 5–6, O₂ 7–8, jednotka 2 psi), 0x30 události (typ 29 = CO₂: uint32, ppCO₂ mbar = hodnota × okolní tlak bar / 10 000), 0x51 krátké záznamy, 0x70–0x75 tkáně (32 × float LE), 0x20–0x27 patička, 0xFF závěr.
- Spínání solenoidu Petrel neukládá; vstřiky se odhadují ze skoků průměrného pO₂.
- Kalibrace článků v hlavičce je zástupná (0,021 bar/mV), skutečnou drží deska SOLO – aplikace ji odvozuje z průměrného pO₂.
