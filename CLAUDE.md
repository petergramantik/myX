# myX – pravidla projektu

- S uživatelem komunikuj česky.
- Nové požadavky zapisuj jen do číslovaného TODO listu (v chatu, ne do repozitáře). Implementuj až po pokynu „imp“ (nebo „im“).
- Dvě větve: `main` = produkce (…/myX/), `dev` = dev verze (…/myX/dev/). Uživatel přepíná v Nastavení → Dev.
- „imp“/„im“ implementuje do větve `dev` (nikdy přímo do `main`): `bun tests/core.test.ts` a `./build.sh` musí projít, commit a push do `dev`. Do produkce jen přes „release“ (od 26. 11. 2026 znovu – vývoj běží v dev). Workflow „Dev verze“ spustí nasazení, které sestaví produkci (main) i dev (dev).
- Před release upozornit na rizikové změny (formát/ukládání dat, synchronizace a Worker, import a dekódování logu, Bluetooth, analýzy pro upozornění).
- Adresa aplikace není v kódu natvrdo (`src/app/appurl.ts`, volitelně `window.MYX_APP_URL` v `public/config.js`); `public/qr.svg` kóduje produkční adresu – po přesunu na doménu vygenerovat znovu. Produkce má v záhlaví štítek BETA (testovací fáze), dev štítek DEV.
- „release“ převede dev do produkce: sloučit `dev` do `main`, verzi bez „-dev“, push `main`. Nové funkce se do produkce nesmí dostat jinak než přes „release“. Výjimka: oprava chyby v produkci jen na výslovný pokyn („hotfix“) – commit do `main` a hned sloučit i do `dev`.
- Verze: v `src/app/version.ts` zvýšit `APP_VERSION` a přidat nahoru položku do `RELEASES`. V dev „X.Y-dev.N“ (každé imp zvýší N), při release „X.Y“ (položky RELEASES z dev sloučit do jedné). Drobnosti zvyšují setinu, desetina jen u významných změn.
- Dev verze: vlastní kopie dat v IndexedDB („dev-myx“, „dev-myx-guest“, zkopírováno z produkce), žádná synchronizace. Změna formátu dat v dev nesmí měnit produkční úložiště.
- Dekódování logu Shearwater (`src/core/shearwater.ts`) a analýzy (`src/core/analysis.ts`) měň opatrně a doplň test. Do repozitáře nikdy nedávej soubory s daty ponorů (repo je veřejné).
- Jazyky: čeština je zdrojová (texty v kódu), angličtina přes slovník `src/i18n/en.ts` (překlad nad DOM, `src/app/i18n.ts`). Každý nový nebo změněný český text doplnit do `en.ts` (kontrola: `node tools/i18n-missing.cjs`), nápovědu `Help.tsx` i `HelpEn.tsx`. Angličtina je zdrojem pro další jazyky.
- Worker (`proxy/worker.js`) – synchronizace (KV `MYX_KV`, secret `MYX_KEY`) a proxy Stran potápěčských. Změnu Workeru musí uživatel vložit do Cloudflare ručně; adresa je v `public/config.js`.

## Formát logu (Petrel 2, DiveCAN, X-CCR)
- 32bajtové záznamy: 0x10–0x18 hlavička, 0x01 vzorek, 0xE1 rozšířený vzorek (dil 5–6, O₂ 7–8, jednotka 2 psi), 0x30 události (typ 29 = CO₂: uint32, ppCO₂ mbar = hodnota × okolní tlak bar / 10 000), 0x51 krátké záznamy, 0x70–0x75 tkáně (32 × float LE), 0x20–0x27 patička, 0xFF závěr.
- Spínání solenoidu Petrel neukládá; vstřiky se odhadují ze skoků průměrného pO₂.
- Kalibrace článků v hlavičce je zástupná (0,021 bar/mV), skutečnou drží deska SOLO – aplikace ji odvozuje z průměrného pO₂.
