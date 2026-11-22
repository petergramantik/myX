// Verze aplikace a „Co je nového“. Drobnosti zvyšují setinu (1.0 → 1.0.1), větší změny desetinu (1.0 → 1.1).
export const APP_VERSION = "1.42";

export interface Release { version: string; date: string; title: string; items: string[] }

export const RELEASES: Release[] = [
  { version: "1.42", date: "2026-11-22", title: "Stahování přes Bluetooth, Před a po ponoru, další přístroje", items: [
    "Stažení ponorů přímo z počítače: Petrel 3 přes Bluetooth v Chrome na Androidu, Petrel 2 přes Android aplikaci „myX Petrel“ (Sdílet → myX). Jen čtecí příkazy, každý ponor se uloží hned, po přerušení spojení se myX znovu připojí a naváže, kde ponor přestal; duplicity s exportem Cloudu se poznají.",
    "Cizí počítač: ve výchozím stavu jen poslední ponor, uloží se do DB majitele nebo do nové DB přiřazené buddymu.",
    "Rozpracovaný ponor: sekce „Před a po ponoru“ – tlaky onboard a offboard lahví (lahev a plyn z nabídky, argon do obleku), potvrzení kalibrace O₂ a CO₂; poloha a počasí z místa a času ponoru, horní ＋ aktualizuje polohu a otevře ponor; páruje se s logem 3 h před až 48 h po založení.",
    "Spotřeba plynu: skutečná spotřeba O₂ a diluentu z lahví v Před a po ponoru (bary a litry), bailout jako externí diluent; ruční spotřeba zrušena (starší zadání převedena).",
    "Další počítače a přístroje: mód z logu (CC, Gauge…), model počítače, typ přístroje (eCCR, pSCR s odhadem pO₂ ve smyčce); ponory bez čidel bez nesmyslných varování; nepodporované typy skryté, ale uložené.",
    "Baterie v hlavě podle modelu rebreatheru (X-CCR, FLEX2, FX, JJ, Tres Presidentes): počet, typ a funkce (#1 solenoid, #2 HUD); alarm „Porucha solenoidu / baterie v hlavě“ označí baterii solenoidu jako podezřelou.",
    "Scrubber u každého rebreatheru (i ruční náplň bez časovače), procenta na Přehledu; nová čidla se štítkem NOVÉ, výběr čidla ze seznamu, historie s datem vyjmutí; nepojmenované vysílače tlaku T1/T2 v Nastavení.",
    "Upozornění jde u ponoru skrýt (jedno nebo celou kategorii); dlaždice Proplach; běžné přepnutí setpointu se nehlásí (jen pozdní); „Varování z počítače (význam neznámý)“ místo chybného „Hlášení CO₂“.",
    "Lokality: ruční souřadnice a poloha z ponoru; posuvník grafu po skoku na událost zapulzuje; sdílení ponoru s návodem pro příjemce.",
    "Opravy: stisky tlačítek po první hodině ponoru se řadily o hodinu dřív; sdílený soubor, který nejde načíst, ukáže důvod.",
  ] },
  { version: "1.41.3", date: "2026-11-20", title: "Přepočet ponorů", items: [
    "Po aktualizaci se znovu přepočítají údaje všech ponorů (i cizích logů), takže tlaky z vysílačů se ukážou i u logů načtených před verzí 1.41.2.",
  ] },
  { version: "1.41.2", date: "2026-11-20", title: "Import a tlaky z vysílačů", items: [
    "Import nepřestane na ponoru, který nejde přečíst – přeskočí ho, načte ostatní a nahlásí čísla přeskočených.",
    "Tlaky lahví z bezdrátových vysílačů Shearwater (AI) – když log nemá tlaky z DiveCAN a vysílače jsou pojmenované (D1 = diluent, O2 = kyslík), použijí se pro spotřebu, doplnění diluentu a graf tlaku.",
  ] },
  { version: "1.41.1", date: "2026-11-20", title: "Oprava Nastavení", items: [
    "Sekce s Workerem a klíčem se jmenuje „Synchronizace“ – v Nastavení je jen jedna sekce „Dev“ (přepínač dev verze).",
  ] },
  { version: "1.41", date: "2026-11-20", title: "Dev verze", items: [
    "Nastavení → Dev: přepnutí do testovací verze s novinkami ve vývoji (štítek DEV v záhlaví).",
    "Dev verze pracuje na vlastní kopii dat (vlastní i cizí logy, nastavení), nesynchronizuje a do běžné verze nic nepřenese; kopii jde obnovit z běžné verze.",
  ] },
  { version: "1.40.3", date: "2026-11-20", title: "Logo a kompaktní log", items: [
    "Logo v záhlaví je součástí aplikace – bez zpoždění, ostré, i offline.",
    "Opravena rozbitá ikona po nepovedené aktualizaci (bez sítě se místo obrázků už nevrací stránka aplikace).",
    "Kompaktní log: ponory bez problému mají zelený rámeček.",
  ] },
  { version: "1.40.2", date: "2026-11-20", title: "Události pod grafy", items: [
    "Text událostí zarovnaný pod sebe, vlevo vyčnívají jen tečky.",
  ] },
  { version: "1.40.1", date: "2026-11-20", title: "Profil a dekomprese", items: [
    "Profil a strop: přepínač stisků tlačítek je vidět pořád, popis grafu sbalený.",
    "Dekomprese: TTS, @+5 a čas na zastávce rostou shora dolů, NDL zdola nahoru.",
    "Tenký profil hloubky ve všech grafech sahá až ke spodnímu okraji.",
  ] },
  { version: "1.40", date: "2026-11-20", title: "Grafy: osy, legenda, zátěž", items: [
    "Jednotky u levé i pravé osy všech grafů.",
    "Legenda odpovídá grafu: čárkované a tečkované čáry, svislé značky (dávky O₂, tlačítka, doplnění diluentu) jako svislá čárka.",
    "Graf pO₂: osa vždy do 1,6 bar, přerušované čáry na maximu pO₂ a na 1,6 s hodnotou na ose.",
    "Zátěž spojitější: počítá se i v rušených úsecích, když má okno dost čistých dat; mezery do 3 min přemostěné tečkovaně (dopočteno).",
    "Při přechodu na sousední ponor zůstane otevřená stejná záložka.",
    "Graf Rychlost: kratší název, vysvětlení v Popisu grafu.",
  ] },
  { version: "1.39.6", date: "2026-11-20", title: "Dekomprese a hlášení CO₂", items: [
    "Graf Dekomprese: NDL tence na pravé ose omezené na 30 min, TTS, @+5 a čas na zastávce mají celé měřítko; přesné NDL v pruhu pod grafem.",
    "„Chyba CO₂ čidla (P)“ přejmenováno na „Hlášení CO₂ z počítače (P)“ – u každého výskytu hodnota CO₂ a odkaz do grafu; „ber s rezervou“ jen při nemožných hodnotách čidla.",
  ] },
  { version: "1.39.5", date: "2026-11-20", title: "Ovládání grafů", items: [
    "Tlačítka − 0 + jsou v řádku s nadpisem grafu, graf má zase celou šířku.",
    "Přepínač pO₂ / mV je pod grafem vpravo; první graf se jmenuje „Profil a strop“.",
  ] },
  { version: "1.39.4", date: "2026-11-20", title: "Odkazy do grafů", items: [
    "Vysoké CO₂ a slabá / kritická baterie mají odkaz do grafu (maximum CO₂, první pokles napětí pod práh).",
    "Popis pod grafy je ve sbalovacím řádku „Popis grafu“ (výchozí sbaleno).",
  ] },
  { version: "1.39.3", date: "2026-11-20", title: "Události pod grafy", items: [
    "Události pod grafem chronologicky, každá situace na vlastním řádku.",
    "Sbalovací řádek „Události (N)“ (výchozí sbaleno, stav se pamatuje pro každý graf); odkaz z upozornění ho rozbalí a událost zvýrazní.",
  ] },
  { version: "1.39.2", date: "2026-11-19", title: "Události pod grafy", items: [
    "Přepnutí setpointu (a pozdní přepnutí jako informace) už pod grafem ani s odkazem do grafu není – jen v Událostech.",
    "Pozdní přepnutí jako varování vede posuvníkem přímo na okamžik přepnutí.",
    "Události bez krátkého popisu ukazují pod grafem svůj text.",
  ] },
  { version: "1.39.1", date: "2026-11-19", title: "Ovládání grafů", items: [
    "Odkaz z upozornění jen posune na graf (i s nadpisem) a nastaví posuvník, nepřibližuje.",
    "Vpravo od grafů tlačítka + / 0 / − (přiblížení kolem posuvníku, celý graf, oddálení).",
    "Posuvník u okraje přiblíženého grafu plynule posouvá výřez.",
  ] },
  { version: "1.39", date: "2026-11-19", title: "CO₂ a dechová práce", items: [
    "Grafy CO₂ a zátěže sloučeny do jednoho: CO₂ hlavní, zátěž a hustota plynu tence na pravé ose; místo šedých pásem mezery s důvodem v pruhu pod grafem.",
    "Zátěž chybí kratší dobu: po přepnutí SP a ruční dávce jen do ustálení pO₂, po doplnění diluentu 90 s. Ruční dávky podle analýzy dávek (už ne falešně při klesání).",
    "Doplnění diluentu se nepočítá, když jsi během minuty klesal (ADV při sestupu); čárky v grafu jsou výraznější.",
    "Pod legendou grafů pO₂, CO₂ a tlaku barevná upozornění, která se jich týkají; klepnutím přiblížení.",
    "Časy: okamžik 2′15″, délka 2 min 15 s – všude stejně.",
    "Spojené ponory: tlačítko „Spojit s následujícím“ zrušeno, spojit zpět jde jen ručně oddělenou část.",
    "Nastavení: „minuty“ místo „min“. Drobná vylepšení Přehledu.",
  ] },
  { version: "1.38.1", date: "2026-11-19", title: "Pozdní přepnutí setpointu", items: [
    "Pozdní přepnutí se hodnotí jen u prvního přepnutí na vysoký SP v ponoru.",
    "Výchozí hranice 2 min po dosažení dna (vlastní hodnota zůstává).",
    "Nová volba v Nastavení → Setpoint: pozdní přepnutí jako žluté varování s tagem SP (výchozí vypnuto).",
  ] },
  { version: "1.38", date: "2026-11-19", title: "pO₂ z diluentu", items: [
    "Vysoké pO₂ nad 1,4 bar, které v hloubce dává sám diluent, už není varování – v grafu pO₂ je světle modré pásmo „pO₂ z diluentu“.",
    "Pásmo jde skrýt klepnutím v legendě, volba platí pro všechny ponory.",
    "Nad 1,6 bar zůstává vždy červené varování.",
  ] },
  { version: "1.37.4", date: "2026-11-19", title: "Graf Tkáně a kyslík", items: [
    "Úseky, kdy se tkáně nasycují a počítač GF99 neukládá, jsou šedě vyznačené; v pruhu pod grafem „GF99 --“.",
    "Čára GF High je šedá a v pruhu pod grafem se už neopakuje.",
    "Vysvětlení doplněno o Surface GF po vynoření.",
    "Drobná vylepšení Přehledu.",
  ] },
  { version: "1.37.3", date: "2026-11-19", title: "Drobnosti", items: [
    "Drobná vylepšení Přehledu.",
  ] },
  { version: "1.37.2", date: "2026-11-19", title: "Drobnosti", items: [
    "Doplněná nápověda k Přehledu.",
  ] },
  { version: "1.37.1", date: "2026-11-19", title: "Drobnosti", items: [
    "Drobná vylepšení Přehledu.",
  ] },
  { version: "1.37", date: "2026-11-19", title: "Záhlaví s názvem karty, cizí log v B&L", items: [
    "Záhlaví bez „myX –“: název karty; na Přehledu, Ponorech a v B&L „Karta · Jméno ›“ s přepínačem logů, jinde jen název.",
    "B&L v cizím logu: jeho lokality a parťáci jen pro čtení (jeho názvy, počty jeho ponorů, „→“ propojení s tvými), „To je…“ propojí jméno s tvým.",
    "DB a Nastavení vždy s tvými daty – otevřený cizí log se při vstupu zavře.",
    "Cizí Přehled bez údajů z tvé evidence výbavy (baterie v hlavě, ruční datum sorbentu, úpravy čidel).",
  ] },
  { version: "1.36.2", date: "2026-11-19", title: "Nová ikona aplikace", items: [
    "Nová ikona myX Logbook (plocha telefonu, záložka prohlížeče, logo v záhlaví), včetně varianty pro Android (maskable).",
  ] },
  { version: "1.36.1", date: "2026-11-19", title: "Přejetí po celé obrazovce", items: [
    "Swipe (např. z Varování zpět na Přehled) funguje i na prázdném místě pod obsahem.",
  ] },
  { version: "1.36", date: "2026-11-19", title: "Zátěž podle osobního základu, scrubber, solenoid", items: [
    "Zátěž: nepočítá se 3–4 min po přepnutí SP, ruční dávce O₂ a doplnění diluentu (šedě s důvodem); 1 = tvoje obvyklá úroveň z tvých ponorů; v grafu max. 4×.",
    "Nové „Zvýšená zátěž“: nad 2× obvyklé aspoň 3 min, potvrzená spotřebou O₂ z lahve (je-li k dispozici), s údajem o následném nárůstu CO₂.",
    "„Scrubber vyčerpán během ponoru“ (červeně) – „Nezapomněl jsi obnovit stack time?“.",
    "„Jen ruční doplňování O₂ – solenoid nepracoval?“ (info) i bez alarmu, když pO₂ zůstávalo pod setpointem bez dávek solenoidu.",
    "„Upouštění smyčky“ přejmenováno na „Doplnění diluentu“ (ADV, proplach, maska); „Časté…“ jen výrazně nad tvým obvyklým počtem.",
    "Chybné CO₂ čidlo: pravděpodobná příčina vlhkost / kondenzace, souvislost s předchozím a dalším ponorem.",
  ] },
  { version: "1.35", date: "2026-11-19", title: "Opravy z auditu všech ponorů, srozumitelnější grafy", items: [
    "Alarmy: konec nejpozději při dalším alarmu stejného druhu nebo když se hodnota na 1 min vrátí za práh – žádné desítky minut kvůli nepotvrzenému varování.",
    "CO₂ čidlo: hodnoty vytrvale nad 100 mbar = „Čidlo CO₂ nejspíš chybné“ (žlutě) – v grafu zůstávají (šedé pásmo), z hlášení, souvislostí a srovnání se vynechají.",
    "Tlak O₂: krátký pokles s návratem do 90 s = ruční dávka (potvrzuje dávku O₂), ne zavření lahve; opakované zavírání/otevírání = souhrn „Ruční dávkování O₂ otevíráním lahve (P)“.",
    "Varování po konci ponoru se vynechávají; potvrzení tlačítkem se páruje jen s jedním varováním.",
    "Grafy: krátké výpadky (do 2 vzorků) se přemostí; zátěž vyhlazená, úseky bez údaje šedě.",
    "Dekomprese rozdělena: graf minut (NDL, čas na zastávce, TTS, @+5) a „Tkáně a kyslík“ (GF99 s tvým GF High, CNS), s vysvětlením.",
  ] },
  { version: "1.34.14", date: "2026-11-19", title: "Klesání s vysokým SP, příčiny a odkazy do grafu", items: [
    "Klesání s vysokým setpointem: hlásí se od 3 m, pokud pO₂ následně přesáhlo 1,6 bar (od 6 m vždy); každé klesání s odkazem do grafu.",
    "Vysoké pO₂: v ose řešení i pravděpodobná příčina – klesání se SP nebo ruční dávka O₂ před nárůstem (P).",
    "„Ukázat v grafu ›“ i u přepnutí setpointu, SP mimo závěr, nízkého pO₂ při zanoření, Souvislosti CO₂ (každá epizoda), rozjetých čidel a hustého plynu (také v Událostech).",
    "Oprava: popisky značek nad grafem (např. SP 0,5 na začátku) se už neořezávají.",
  ] },
  { version: "1.34.13", date: "2026-11-19", title: "Zátěž bez vlivu výstupu", items: [
    "Zátěž a dechová práce: pokles pO₂ se opravuje o změnu okolního tlaku (při výstupu pO₂ klesá samo) – zmizí falešné špičky při výstupu; úsek od 3 m k hladině se nepočítá.",
  ] },
  { version: "1.34.12", date: "2026-11-19", title: "1:1 bez skoku, popisek Scrubber", items: [
    "Zrušení zoomu (1:1, dvojklep, Zpět) ani zavření nabídky či dialogu už neposune stránku na začátek; Zpět z Grafů vede na začátek Logbooku.",
    "Dlaždice Scrubber: dole „stáří N d“.",
  ] },
  { version: "1.34.11", date: "2026-11-19", title: "Jednotná mřížka V kostce", items: [
    "V kostce: dlaždice mají stejnou šířku i výšku, obsah se zalomí uvnitř a nepřetéká přes okraj.",
    "Scrubber na dva řádky: „7 h 00 → 5 h 25“ a pod tím „před → po · stáří“.",
  ] },
  { version: "1.34.10", date: "2026-11-19", title: "Dlaždice Scrubber", items: [
    "Detail ponoru: dlaždice „Scrubber“ – zbývá před → po ponoru · stáří náplně; časy žlutě pod nastavením (výchozí 1 h 30 min), červeně pod 30 min, stáří žlutě nad nastavením.",
    "Rámeček dlaždice i při Souvislosti CO₂ (žlutě) a Alarmu CO₂ z počítače (červeně); klepnutí otevře hlášení o CO₂.",
  ] },
  { version: "1.34.9", date: "2026-11-19", title: "Vysoké pO₂ i bez alarmu počítače", items: [
    "Detail ponoru: „Vysoké pO₂ (bez alarmu počítače)“ – červeně nad 1,6 bar, žlutě nad 1,4 bar déle než 1 min mimo deko; časy, max., hloubka, řešení a odkaz do grafu. Neopakuje se, když ve stejné chvíli běžel alarm z počítače.",
    "Oprava: za deko zastávku se bere jen pobyt v hloubce zastávky po nejhlubším bodě – dno deko ponoru už se z hlídání nevyjímá.",
  ] },
  { version: "1.34.8", date: "2026-11-19", title: "Tlačítko Zpět v telefonu", items: [
    "Detail ponoru: Zpět z Grafů / Hodnot / Událostí vede na Logbook (i po „Ukázat v grafu“); přiblížený graf Zpět nejdřív vrátí na celý ponor.",
    "Zpět zavře otevřený dialog, nabídku logů v titulku, nabídky Akce a výběr ponorů.",
    "Z hlavních záložek (Ponory, B&L, DB, Nastavení) vede Zpět na Přehled; až z Přehledu se aplikace zavře.",
  ] },
  { version: "1.34.7", date: "2026-11-19", title: "Nápověda ovládání v grafu", items: [
    "Prázdný pruh pod grafem: „Táhni: hodnoty · Roztáhni: přiblížit · Dvojklep: zpět“ (u grafů bez zoomu „Dvojklep: zrušit“).",
  ] },
  { version: "1.34.6", date: "2026-11-19", title: "Info z posuvníku pod grafem", items: [
    "Hodnoty z posuvníku se ukazují v pruhu pod grafem (nad legendou) – graf zůstává celý vidět; čas, hloubka, alarm a hodnoty řad kompaktně.",
    "Posuvník zůstane na místě i po zvednutí prstu; zrušení ✕ v pruhu nebo dvojklepnutím.",
  ] },
  { version: "1.34.5", date: "2026-11-19", title: "Každý alarm zvlášť s odkazem do grafu", items: [
    "Rozbalené varování / alarm ukáže každou situaci zvlášť (čas, délka, kroky řešení); víc než 5 situací je sbalených.",
    "„Ukázat v grafu ›“ přepne na Grafy, přiblíží situaci (±2 min), posune na příslušný graf a postaví posuvník na začátek alarmu.",
  ] },
  { version: "1.34.4", date: "2026-11-19", title: "Alarmy pO₂ červeně", items: [
    "Alarm vysokého i nízkého pO₂ z počítače během ponoru je červený (detail, tag pO₂, rámeček řádku); nízké pO₂ při setpointu 0,19 před výstupem zůstává žluté.",
  ] },
  { version: "1.34.3", date: "2026-11-19", title: "Formát časů", items: [
    "Okamžiky v ponoru jako 11′36″ (osa řešení, varování, události, popisek grafu), délky pod minutu jako „44 s“, delší 1′05″.",
    "Osa řešení: jen „alarm ztlumen“ s hodnotou.",
  ] },
  { version: "1.34.2", date: "2026-11-19", title: "Přesnější osa řešení alarmu", items: [
    "Alarmy pO₂ a CO₂: první krok „alarm spuštěn“ s hodnotou a hloubkou; „alarm ztlumen, dál na displeji“ – ztlumení problém nekončí.",
    "Konec varování: potvrzeno tlačítkem (jen při zapsaném stisku) nebo „varování zmizelo“, s údajem, zda už hodnota byla pod prahem.",
    "Délka alarmu v min:s od spuštění do zmizení varování z displeje (dřív jen do ztlumení).",
  ] },
  { version: "1.34.1", date: "2026-11-19", title: "Přepínač logu v titulku", items: [
    "Přehled: v titulku jméno aktivního logu ›; klepnutím výběr mezi mým logem a uloženými cizími logy (otevřou se jen pro čtení).",
  ] },
  { version: "1.34", date: "2026-11-19", title: "Vysoké pO₂, řešení varování, zoom grafů", items: [
    "Vlastní hlídání vysokého pO₂: žlutě nad 1,4 bar déle než 1 min mimo deko zastávky, červeně nad 1,6 bar (prahy v Nastavení → Upozornění) – pásma v grafu, dlaždice Max. pO₂, tag pO₂.",
    "Varování a alarmy z počítače mají v rozbalení časovou osu řešení: potvrzení, setpoint, ruční dávky, diluent / upuštění smyčky, lahve, OC, konec alarmu ((P) = odhad).",
    "Grafy v detailu ponoru: jemná linka profilu, zoom dvěma prsty (všechny grafy najednou, osy zůstávají, zpět 1:1 nebo dvojklepnutím), posuvník jedním prstem beze změny.",
    "Graf pO₂ a čidel: typ čidla z Výbavy, tenčí čáry, klikatelná legenda (zapnout/vypnout), legenda pásem, rozjetá čidla tyrkysově, v posuvníku info o alarmu.",
  ] },
  { version: "1.33", date: "2026-11-17", title: "Sdílení srovnání jako stránky", items: [
    "Srovnání: tlačítko ⤴ Sdílet srovnání pošle přes WhatsApp, Messenger, mail statickou stránku .html (hlavička, závěr, grafy, rozdíly) – příjemce nepotřebuje myX, otevře ji v prohlížeči i v náhledu na iPhonu.",
    "Bez ID počítačů a surových dat ponorů; grafy zjednodušené (~70 kB pro 3 potápěče); odkaz na myX v hlavičce i patičce.",
    "„Já“ se ve sdílené stránce nahradí tvým jménem (Nastavení → Sdílení; zeptá se při prvním sdílení).",
  ] },
  { version: "1.32.3", date: "2026-11-17", title: "Filtry ponorů se pamatují, křížek v hledání", items: [
    "Ponory: filtry (parťáci, hledání, hodnocení, plyny, tagy, Jen společné, výběr) a pozice v seznamu zůstanou po otevření ponoru nebo srovnání; „Vše“ u hodnocení je vynuluje.",
    "Hledání a výběr jmen / lokalit mají ✕ pro vyprázdnění.",
    "Žádné pole nenabízí automatické vyplnění (platební karty, adresy).",
  ] },
  { version: "1.32.2", date: "2026-11-17", title: "Volba sdílení a mazání cizích ponorů", items: [
    "Sdílení (⤴, výběr ponorů, Sdílet můj log) nabídne: Poslat přes… (WhatsApp, Messenger, mail – jako .txt, Chrome .db sdílet nedovolí) nebo Uložit jako .db.",
    "Cizí log: smazání jednotlivého ponoru v detailu nebo víc ponorů ve výběru; prázdný log zmizí, majitel a aliasy zůstanou.",
  ] },
  { version: "1.32.1", date: "2026-11-17", title: "Nápověda aktualizovaná", items: [
    "Nápověda (?) popisuje sdílení vybraných ponorů, výběr v seznamu, aliasy, Akce v Databázi, nové srovnání, filtr společných ponorů a výměnu baterie.",
  ] },
  { version: "1.32", date: "2026-11-17", title: "Sdílení vybraných ponorů", items: [
    "Detail ponoru: tlačítko ⤴ sdílí jen tento ponor (spojený ponor se všemi částmi); seznam ponorů: ☑ Vybrat → zaškrtnout → Sdílet. Funguje i v otevřeném cizím logu.",
    "Soubor .db ve formátu exportu Shearwater Cloud jen s vybranými ponory (záznamy beze změny) + moje lokalita a parťáci z myX; hodnocení a poznámka se nesdílí.",
    "Import stejného počítače už log nenahrazuje, ale slučuje – jednotlivé sdílené ponory a pozdější celý export dají stejný výsledek bez duplicit.",
    "Sdílený soubor nepřepíše uložený celý export pro „Sdílet můj log“.",
  ] },
  { version: "1.31.3", date: "2026-11-17", title: "Aliasy parťáků a lokalit", items: [
    "Detail ponoru → Z logů ostatních: každé jméno tučně s tlačítkem Akce – To je… (propojit s mým parťákem / lokalitou), Přidat k ponoru, Založit nového, To jsem já; u podobného jména nabídne „To je Radek Patak?“.",
    "Propojení (alias) platí pro všechny ponory, přežije aktualizaci i smazání cizího logu.",
    "B&L: v detailu parťáka a lokality karta Aliasy s možností zrušit propojení; Nastavení → Výbava → Moje aliasy.",
  ] },
  { version: "1.31.2", date: "2026-11-17", title: "Filtr společných ponorů se pamatuje", items: [
    "Filtr společných ponorů (lidé, rok, měsíc, den) a pozice v seznamu zůstanou po návratu ze srovnání; vynuluje je „Vše“ nebo zavření aplikace.",
  ] },
  { version: "1.31.1", date: "2026-11-17", title: "Přehlednější rozdíly ve srovnání", items: [
    "Rozdíly jako bloky: název přes celou šířku, pod ním hodnoty potápěčů ve sloupcích – nic nepřetéká z obrazovky.",
    "Jména potápěčů zůstávají při posouvání nahoře.",
    "Nejvyšší / nejnižší hodnota jen tenkým červeným ▲ / fialovým ▼ rámečkem.",
    "Menší písmo (oprava: řádky s výrazným rozdílem omylem dostaly 18 px), méně podstatné údaje sbalené pod „Další údaje“.",
  ] },
  { version: "1.31", date: "2026-11-17", title: "Logy ostatních, bez ID počítačů, přehlednější rozdíly", items: [
    "Databáze: „Logy ostatních“; u každého počítače jedno tlačítko Akce (majitel, hlavní počítač, To je můj počítač, Smazat), Otevřít a Srovnání zůstávají u majitele.",
    "Místo skloňovaného „buddy“ se v textech používá parťák / ostatní.",
    "ID počítače se ukazuje jen v Databázi – jinde jméno majitele, případně model (baterie: „Baterie – Petrel 3“, u dvou stejných modelů pořadí).",
    "Srovnání: nejvyšší hodnota červeně podbarvená ▲, nejnižší fialově ▼, legenda pod nadpisem, menší písmo; barvy potápěčů bez červené a fialové.",
  ] },
  { version: "1.30.2", date: "2026-11-17", title: "Výměna baterie Petrelu", items: [
    "Aplikace pozná výměnu baterie (skok procent, u NiMH skok napětí, jiný typ) a trend počítá jen od ní – po výměně už nehlásí „Baterie slábne“.",
    "Lithiová baterie se hlídá podle procent z Petrelu: pod 50 % „slábne“, pod 25 % „slabá“.",
    "V Událostech ponoru informace „Baterie vyměněna“ s napětím a procenty před a po.",
    "Tlačítko „Baterii jsem vyměnil“ u baterie Petrelu skryje upozornění do dalšího ponoru.",
  ] },
  { version: "1.30.1", date: "2026-11-17", title: "Vlastní potvrzovací dialogy", items: [
    "Potvrzení a zadání jména se zobrazují v aplikaci místo systémových oken prohlížeče (ta mohla být potlačená – tlačítka pak nic nedělala).",
    "„To je můj počítač“ ukazuje průběh přesunu.",
  ] },
  { version: "1.30", date: "2026-11-17", title: "Spojené ponory, porucha solenoidu, zarovnání srovnání", items: [
    "Víc záznamů počítače jako jeden ponor: stejné číslo v Shearwater Cloudu nebo povrchový interval do 30 min (Nastavení → Výbava); části jdou ručně oddělit nebo spojit.",
    "Spojený ponor: jeden řádek „N části“, grafy s vyznačeným pobytem na hladině, karta Části ponoru.",
    "Nové příznaky: porucha solenoidu / baterie v hlavě (P), slabá baterie (P); pojmenované obrazovky menu a info.",
    "Srovnání se zarovnává podle prvních 10 minut – kratší ponor buddyho už neposune časovou osu.",
  ] },
  { version: "1.29", date: "2026-11-17", title: "Vlastní log z víc počítačů", items: [
    "První import souboru s víc počítači se zeptá, které jsou tvoje.",
    "DB → Databáze: u logu volba „To je můj počítač“ – ponory se přesunou k tvým (i s lokalitami a buddyi z Cloudu).",
    "Nastavení → Výbava: seznam tvých počítačů, počítač jde odebrat.",
  ] },
  { version: "1.28", date: "2026-11-17", title: "Víc počítačů jednoho buddyho", items: [
    "Počítače se stejným majitelem tvoří jeden log: jedna dlaždice v DB, společný seznam ponorů, jeden účastník srovnání.",
    "Při načtení souboru s víc cizími počítači se aplikace zeptá, zda patří stejnému člověku.",
    "Ponor ze dvou počítačů současně se zobrazí jednou z hlavního počítače (volba „Nastavit jako hlavní“), se štítkem 2 počítače.",
    "Srovnání počítačů: rozdíly hloubky, pO₂, mV čidel, teploty, deko a hodin – pro hledání závady.",
  ] },
  { version: "1.27", date: "2026-11-17", title: "Nápověda a nové Nastavení", items: [
    "Ikona „?“ v záhlaví otevře Nápovědu – přehled funkcí po sekcích (import a export ze Shearwater Cloudu, sdílení, seznam, detail, co aplikace z logu vyčte, srovnání, B&L, nastavení).",
    "Nastavení rozdělené do sbalitelných sekcí; upozornění podle oblastí; synchronizace přes Worker v sekci Dev.",
    "Import přijme jakýkoli soubor (i na iPhonu) a ověří, že jde o databázi Shearwater.",
  ] },
  { version: "1.26.4", date: "2026-11-17", title: "Vzhled zapnutých filtrů", items: [
    "Zapnutý filtr má bílý rám a text bez modrého obrysu; počet pod ním se nepřekrývá.",
  ] },
  { version: "1.26.3", date: "2026-11-17", title: "Filtry s počty", items: [
    "Označení všech plynů výběr zruší (zobrazí se všechny ponory).",
    "Pod zapnutými štítky filtru je počet ponorů; u více problémů x/y (zobrazené / s daným tagem).",
  ] },
  { version: "1.26.2", date: "2026-11-17", title: "Filtr plynů a problémů, onboard ↔ externí lahev", items: [
    "Plné zobrazení: řádek filtrů – vlevo plyny (AIR, TMX, NX), vpravo problémy (pO₂, CO₂, ČIDLA, TLAK, BAT, SP); přepínače.",
    "Tagy v řádcích ponoru otevírají detail (nefiltrují).",
    "Přechod z onboard na externí lahev se rozpozná podle ustáleného tlaku – jen informace, bez tagu TLAK.",
    "Otevření / zavření onboard lahve během ponoru se nepočítá do spotřeby; v Událostech je vidět, kdy se lahev zavřela a otevřela.",
  ] },
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
