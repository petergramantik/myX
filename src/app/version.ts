// Verze aplikace a „Co je nového“. Drobnosti zvyšují setinu (1.0 → 1.0.1), větší změny desetinu (1.0 → 1.1).
export const APP_VERSION = "1.26.1";

export interface Release { version: string; date: string; title: string; items: string[] }

export const RELEASES: Release[] = [
  { version: "1.26.1", date: "2026-11-17", title: "Tagy podle kategorií", items: [
    "Tagy v seznamu ponorů = oranžová a červená varování ze záhlaví detailu, sdružená do kategorií pO₂, CO₂, ČIDLO 1 2 3, TLAK, BAT, SP; barva podle nejzávažnějšího.",
    "Klepnutí na tag vyfiltruje ponory se stejnou kategorií.",
    "Pozdní přepnutí, nenastavený vysoký setpoint a velmi hustý plyn jsou jen informace v detailu.",
  ] },
  { version: "1.26", date: "2026-11-17", title: "Varování na počítači a jejich potvrzení", items: [
    "Dekódování varování zobrazených na Petrelu: nízký tlak O₂ / diluentu, nízké / vysoké pO₂, CO₂, nízké NDL, vyřazené čidlo (P), chyba CO₂ čidla (P); ostatní jako neznámé s kódem.",
    "Události: karta „Varování na počítači“ – kdy se zobrazilo a kdy a jak bylo potvrzeno.",
    "Nízký tlak na externí lahvi jen jako informace, na onboard lahvi jako varování.",
    "Vyřazené čidlo s číslem čidla, chyba CO₂ čidla, slabá a kritická baterie v detailu ponoru.",
    "Neznámé alarmy se zobrazují s kódem.",
  ] },
  { version: "1.25.5", date: "2026-11-16", title: "Hranice pN₂", items: [
    "Max. pN₂ se zvýrazní nad 3,16 bar (END 30 m); hranice jde nastavit v Nastavení → Upozornění.",
  ] },
  { version: "1.25.4", date: "2026-11-16", title: "Seznam ponorů – plyn, tagy a hodnocení dole", items: [
    "Plné zobrazení: nahoře lokalita s hloubkou a dobou, pak buddyové s ⇄, dole plyn, tagy a hodnocení.",
  ] },
  { version: "1.25.3", date: "2026-11-16", title: "Seznam ponorů – hloubka a doba vedle sebe", items: [
    "Plné zobrazení: hloubka a doba vedle sebe ve výšce lokality a data.",
  ] },
  { version: "1.25.2", date: "2026-11-16", title: "Seznam ponorů – doladění", items: [
    "Kompaktní zobrazení: metry a minuty vždy zarovnané pod sebou.",
    "Plné zobrazení: velká hloubka a doba, tagy problémů hned za štítkem plynu.",
  ] },
  { version: "1.25.1", date: "2026-11-16", title: "Sloučená upozornění k čidlu, nový řádek ponoru", items: [
    "Upozornění ke stejnému čidlu (odchylka v ponoru + problém z historie) jsou v jednom řádku; červené má přednost.",
    "Plné zobrazení seznamu: nahoře plyn a hodnocení, celý název lokality, hloubka nad dobou, buddyové s ⇄ na vlastním řádku nad tagy.",
    "Kompaktní zobrazení: menší hodnocení a písmo, ⇄ bez zalomení.",
  ] },
  { version: "1.25", date: "2026-11-16", title: "Nízké pO₂ při zanoření a hypoxie, upozornění jen na problémy", items: [
    "Nízké pO₂ na začátku ponoru se hodnotí podle průběhu: dohánění setpointu (informace), nízké pO₂ při zanoření (varování), podezření na hypoxii – zkontroluj ventil O₂ (pO₂ pod 0,21, déle než 2 min pod 0,4, tlak O₂ 0, pO₂ při zanořování neroste).",
    "Tag Hypoxie?; alarm u hladiny a po vynoření jen jako informace; prahy v Nastavení → Upozornění.",
    "V záhlaví detailu ponoru jen varování; informace jsou v záložce Události.",
    "Pozdní přepnutí setpointu uvádí i krátké přepnutí a vrácení (do 2 min se nepočítá).",
  ] },
  { version: "1.24.9", date: "2026-11-16", title: "Párování při posunu hodin, oprava detailu lokality", items: [
    "Oprava: detail lokality padal do prázdné obrazovky.",
    "Při pádu obrazovky se ukáže hláška s tlačítky Zpět / Znovu načíst.",
    "Společné ponory se párují i při posunu hodin o hodinu (letní/zimní čas), když sedí profil.",
    "Posun o hodinu je u hodin buddyho označen.",
    "Po aktualizaci se jednou doplní buddy a lokality k nově spárovaným ponorům.",
  ] },
  { version: "1.24.8", date: "2026-11-16", title: "B&L: moje nahoře, cizí pod nimi", items: [
    "Moji buddyové a lokality jsou nahoře, karta „Z cizích logů“ pod nimi.",
    "V kartě cizích jmen je důraz na jméno, tlačítka jsou menší.",
  ] },
  { version: "1.24.7", date: "2026-11-16", title: "Reset logbooku", items: [
    "Nastavení → Data → Reset logbooku: smaže lokality, buddye, poznámky, hodnocení, rozpracované ponory, přiřazení jmen a cizí logy; ponory, čidla, baterie a nastavení zůstanou.",
    "Před resetem se stáhne záloha, záloha na Workeru se přepíše.",
    "Obnova ze zálohy funguje i po resetu.",
  ] },
  { version: "1.24.6", date: "2026-11-16", title: "Cizí logy se už nemíchají do mých dat", items: [
    "Oprava: synchronizace během otevírání cizího logu mohla uložit jeho lokality a buddye jako moje.",
    "Jednorázový úklid jmen a záznamů, které se takto dostaly do mého logbooku.",
    "B&L vždy ukazuje moje lokality a buddye; karta „Z cizích logů“ je nahoře a rozbalená.",
    "Slučování a přiřazování funguje i při otevřeném cizím logu.",
    "Po odebrání cizí DB zmizí všechny návrhy a společné ponory; zůstane jen skryté spárování.",
  ] },
  { version: "1.24.5", date: "2026-11-16", title: "Oprava propisování lokalit z logů buddyů", items: [
    "Sloučení lokalit / buddyů si zapamatuje původní název a propíše ho do společných ponorů.",
    "Lokalita a buddy z buddyho logu se propíšou i při přesné shodě s mým názvem.",
    "Jednorázové doplnění všech společných ponorů po aktualizaci.",
  ] },
  { version: "1.24.4", date: "2026-11-16", title: "Kompaktní seznam ponorů", items: [
    "Přepínač ☰ / ≡ (plné / kompaktní zobrazení) vpravo v řádku filtrů; volba se pamatuje.",
    "Kompaktní zobrazení skryje plyn a tagy, problém naznačí červený nebo žlutý rámeček řádku.",
  ] },
  { version: "1.24.3", date: "2026-11-16", title: "Sdružená upozornění v detailu ponoru", items: [
    "Opakovaná upozornění stejného typu jsou v jednom řádku s počtem (např. „Souvislost CO₂ – 10×“), jednotlivé popisy po rozbalení.",
  ] },
  { version: "1.24.2", date: "2026-11-16", title: "Diluent v seznamu, převzatá lokalita v detailu", items: [
    "V seznamu ponorů je v pravém horním rohu štítek hlavního diluentu (AIR, TMX…).",
    "Detail ponoru bez lokality zobrazí v nadpisu převzatý název z buddyho logu (kurzívou).",
  ] },
  { version: "1.24.1", date: "2026-11-16", title: "Příčina rozjetých čidel, rozbalovací upozornění", items: [
    "Rozjetá O₂ čidla se rozlišují: podezření na vlhkost (víc čidel najednou, po výstupu srovnaná) nebo na nefunkční čidlo N.",
    "Upozornění až od 3 minut rozdílu; kratší výkyvy jen podbarvené v grafu, nehlásí se ani ve srovnáních.",
    "Tagy v seznamu ponorů: Vlhkost?, Čidlo N.",
    "Upozornění v detailu ponoru: vidět je hláška, popis se rozbalí klepnutím.",
  ] },
  {
    version: "1.24", date: "16. 11. 2026", title: "Tagy ponorů a slučování",
    items: [
      "Seznam ponorů: tagy CO₂, CO₂?, pO₂ 1,6+, pO₂ nízké, Čidla pod řádkem ponoru",
      "Přiřazení lokality/buddyho z cizího logu se propíše do tvých ponorů (vždy tvůj název)",
      "Při slučování volba názvu, který zůstane",
      "Karta „Z cizích logů“ v B&L je rozbalovací",
    ],
  },
  {
    version: "1.23", date: "16. 11. 2026", title: "Rozjetá čidla a párování podle profilu",
    items: [
      "Upozornění na rozjetá O₂ čidla (rozdíl > 0,3 bar) s pomalou odezvou, podbarvené úseky v grafu pO₂",
      "Společné ponory se párují podle profilu prvních 10 minut; dříve ukončený ponor se v závěru tak označí",
      "Neurčený alarm (bit 0x20) v Událostech",
      "Filtr Ponory: „Bez buddyho“ a buddy se navzájem vypínají",
    ],
  },
  {
    version: "1.22", date: "16. 11. 2026", title: "Filtr buddyů a věrohodnost čidla CO₂",
    items: [
      "Ponory: filtr podle buddyů (všichni označení) a štítek „Bez buddyho“",
      "Kontrola věrohodnosti čidla CO₂ (oříznutá nula); nevěrohodné CO₂ se ve srovnání nehodnotí",
    ],
  },
  {
    version: "1.21.1", date: "16. 11. 2026", title: "Seznam společných ponorů",
    items: ["Řádek společného ponoru: datum a lokalita (i z logu buddyho, kurzívou), bez jmen buddyů"],
  },
  {
    version: "1.21", date: "16. 11. 2026", title: "Srovnání: lokalita, setpoint, deko",
    items: [
      "Záhlaví srovnání: název lokality, kompaktní přepínač zarovnání a odchylka hodin",
      "Mimo setpoint jen významně: pod SP o > 0,15 bar, nad SP o > 0,2 bar mimo deko (≥ 30 s); zvýšené pO₂ během deko zvlášť",
      "„bez deko“ místo pomlčky, hodnoceno jako rozdíl; nový řádek pO₂ při výstupu",
    ],
  },
  {
    version: "1.20", date: "16. 11. 2026", title: "Přehled logů a rozpoznání vlastního logu",
    items: [
      "Databáze: každý log buddyho jako dlaždice (majitel, počítač, rozsah, společné ponory) s tlačítkem Otevřít (jen čtení)",
      "Import i sdílení do myX pozná tvůj počítač – tvoje ponory se doplní, ostatní počítače jsou vždy samostatné cizí logy",
    ],
  },
  {
    version: "1.19", date: "16. 11. 2026", title: "Lokalita a buddy z logu buddyho",
    items: [
      "Ponory bez lokality ukážou lokalitu z logu buddyho (kurzívou), v detailu ji jde jedním klepnutím použít",
      "Návrh buddyů z logu buddyho k mému ponoru (bez majitele logu a bez mě)",
      "Jméno z cizího logu jde označit „To jsem já“ – pamatuje se",
    ],
  },
  {
    version: "1.18", date: "16. 11. 2026", title: "DB, filtry srovnání, jména z cizích logů",
    items: [
      "Záložka DB s podkartami Srovnání | Databáze",
      "Filtr společných ponorů podle buddyů (všichni označení), roku, měsíce a dne",
      "Buddy a lokality z cizích logů: přidat k mým nebo přiřadit k mému záznamu (zapamatuje se)",
      "Ponory s buddym otevřou rovnou srovnání všech, odkaz na detail mého ponoru",
    ],
  },
  {
    version: "1.17", date: "16. 11. 2026", title: "Přesnější srovnání",
    items: [
      "Závěr srovnání po sekcích (Dekomprese, pO₂ a setpoint, CO₂, Dýchání, Profil, Plyny) seřazených podle významu",
      "Podíl hloubky vysvětlen tím, co se opravdu liší; malý rozdíl zátěže se nerozkládá",
      "Zarovnání podle profilu hloubky (hodiny počítačů se rozcházejí), odchylka hodin u buddyho",
      "Popisky setpointu a plynu v pruhu nad grafem, bez překrývání",
    ],
  },
  {
    version: "1.16", date: "16. 11. 2026", title: "Záložka Srovnat a srovnání více potápěčů",
    items: [
      "Buddy a lokality sloučené do záložky B&L (podkarty Buddy | Lokality)",
      "Nová záložka Srovnat: společné ponory s buddyi, cizí logy, sdílení mého logu (původní export)",
      "Srovnání 3 a více potápěčů: grafy, tabulka se zvýrazněním nejvyšší/nejnižší hodnoty a závěr proti průměru skupiny",
      "Cizí log: bez čekajících ponorů, výchozí filtr jen společné ponory",
    ],
  },
  {
    version: "1.15", date: "16. 11. 2026", title: "Zátěž a dechová práce",
    items: [
      "Graf zátěže (rychlost spotřeby O₂ ve smyčce) s CO₂ a značkami upouštění smyčky",
      "Hustota plynu v grafu a ve V kostce (hranice 5,2 a 6,2 g/l), upozornění na hustý plyn",
      "Souvislosti CO₂: při námaze, při husté směsi, nebo bez nich (sorbent/smyčka)",
      "Porovnání s buddym: hustota plynu a upouštění smyčky",
    ],
  },
  {
    version: "1.14.1", date: "16. 11. 2026", title: "Setpoint podle průběhu hloubky",
    items: [
      "Pozdní přepnutí na vysoký setpoint se měří od dosažení dna (hloubka se 3 min nezvýší o víc než 3 m), ne od zanoření",
      "Nové upozornění na klesání o víc než 6 m s vysokým setpointem",
      "Hranice (5 min, 3 m, 6 m) jdou upravit v Nastavení",
    ],
  },
  {
    version: "1.14", date: "16. 11. 2026", title: "Sdílení logu do myX",
    items: [
      "Export Shearwater Cloud sdílený přes Quick Share, WhatsApp apod. → „myX“ se otevře jako cizí log",
      "Log ze stejného počítače nahradí starší, po načtení se rovnou nabídne porovnání se tvým ponorem",
    ],
  },
  {
    version: "1.13", date: "16. 11. 2026", title: "Porovnání ponorů s buddym",
    items: [
      "Cizí log jde přiřadit buddymu; počítač se pozná podle sériového čísla a příště se přiřadí sám",
      "Společné ponory: u ponoru odkaz na ponor buddyho a buddy se doplní automaticky",
      "Porovnání ponorů: grafy přes sebe, tabulka rozdílů a závěr (rozklad rozdílu v dekompresi na hloubku a pO₂)",
      "Výchozí hranice pozdního přepnutí na vysoký setpoint 5 min",
    ],
  },
  {
    version: "1.12", date: "16. 11. 2026", title: "Cizí logy, setpoint a dávkování O₂",
    items: [
      "Cizí log (export jiného potápěče) jen k prohlížení, uložený zvlášť a bez synchronizace",
      "Lokalita, buddy a poznámka ze Shearwater Cloud se převezmou při importu",
      "Ovládání počítače (stisky tlačítek) v Událostech, ruční přepnutí setpointu poznané z menu Petrelu",
      "Časová osa setpointů, upozornění na pozdní vysoký setpoint, 0,19 před výstupem",
      "Dávkování O₂: solenoid vs. ručně, barevné značky v grafu pO₂",
      "Petrel 3: CO₂ zapisované častěji než vzorky se už neztrácí (maximum v intervalu)",
    ],
  },
  {
    version: "1.11.1", date: "14. 11. 2026", title: "Sdílení aplikace",
    items: ["Sdílet aplikaci (systémové sdílení nebo zkopírování odkazu) a QR kód v Nastavení", "Skloňování „buddy“ v textech"],
  },
  {
    version: "1.11", date: "14. 11. 2026", title: "Rychlá volba a osobní odhad O₂",
    items: [
      "Pod polem Lokalita a Buddy tři nejčastější jako tlačítka",
      "Poslední ponor: lokalita na samostatném řádku, štítek EXT u externího plynu",
      "Odhad spotřeby O₂ podle tvé změřené spotřeby (l/min) z ponorů se známou spotřebou",
    ],
  },
  {
    version: "1.10", date: "14. 11. 2026", title: "Čidla podle vlastní historie, pN₂, EXT",
    items: [
      "Upozornění na čidla podle poklesu citlivosti proti vlastní historii (stárnutí / problém), všude „čidlo“ místo „článek“",
      "V kostce ve dvou sloupcích, nová dlaždice Max. pN₂ (zvýraznění nad 3,5 bar), Max. pO₂ zvýrazněné nad 1,6 bar",
      "Štítek EXT u diluentu a O₂ při externím plynu, předvyplněná lahev S80/S40",
    ],
  },
  {
    version: "1.9", date: "14. 11. 2026", title: "Spotřeba plynu",
    items: [
      "Spotřeba diluentu a O₂ z průběhu tlaku (bez úseků s externím plynem), v barech, litrech a l/min",
      "Externí lahve S80/S40 u ponoru, ruční oprava spotřeby, objemy lahví v Nastavení",
      "Zastávky v profilu spojené tenkou čarou",
      "Hláška nad scrubberem se klepnutím schová do příštího spuštění",
    ],
  },
  {
    version: "1.8", date: "14. 11. 2026", title: "Plyny a kompaktní V kostce",
    items: [
      "V kostce: dvojité dlaždice (hloubka, doba, GF / CNS, teplota, baterie start / end) a použité plyny s časem",
      "Štítky plynů AIR / TMX / NX / O₂ u nadpisu V kostce",
      "Profil ponoru: pruh použitého plynu, značka přepnutí plynu, plyn v tooltipu",
      "Dlaždice O₂ čidel znovu s „na vzduchu“",
    ],
  },
  {
    version: "1.7", date: "14. 11. 2026", title: "Detail čidla CO₂ a hláška na přehledu",
    items: [
      "Hláška nad scrubberem podle stavu čidel, baterií a scrubberu (vypnutelná v Nastavení)",
      "Detail čidla CO₂: graf maxima přes ponory, ponory s vysokým CO₂ a alarmy, kalibrace",
      "Dlaždice čidel bez zalamování, „mV“ hned za hodnotou",
    ],
  },
  {
    version: "1.6.1", date: "14. 11. 2026", title: "Listování ponory",
    items: [
      "Přejetím prstem v detailu ponoru přejdeš na další nebo předchozí ponor",
      "Pod lokalitou datum ponoru a buddy",
      "Svislá čára v profilu ukazuje začátek dekomprese",
    ],
  },
  {
    version: "1.6", date: "14. 11. 2026", title: "Alarmy z počítače a seskupená varování",
    items: [
      "Alarmy CO₂ a pO₂ z logu Petrelu: v Událostech, podbarvené v grafech a v upozorněních ponoru",
      "Okno Varování seskupuje upozornění podle objektu (čidlo, scrubber, baterie…)",
      "O₂ čidla na přehledu světle modrá, čidlo CO₂ písková",
    ],
  },
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
