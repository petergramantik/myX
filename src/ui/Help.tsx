// Nápověda: přehled funkcí aplikace po sekcích (sbalitelné karty).
import type { ReactNode } from "react";

function H({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="card sec help" open={open}>
      <summary><h2>{title}</h2></summary>
      <div className="sec-b">{children}</div>
    </details>
  );
}

export function HelpScreen() {
  return (
    <div className="screen">
      <p className="muted">myX je logbook pro potápění s rebreatherem. Čte logy z počítačů Shearwater (Petrel 2, Petrel 3) a vyhodnocuje z nich čidla, CO₂, setpoint, plyny i ovládání počítače.</p>

      <H title="1. Jak dostat log do myX" open>
        <p><b>Export ze Shearwater Cloudu (mobil):</b> Profil → Možnosti → Export (*.db). Vznikne soubor se všemi ponory.</p>
        <p><b>Android:</b> v nabídce sdílení zvol <b>myX</b>. Aplikace musí být nainstalovaná přes Chrome → ⋮ → Instalovat aplikaci. Totéž funguje, když ti parťák pošle svůj soubor .db přes WhatsApp.</p>
        <p><b>iPhone:</b> sdílení přímo do myX iOS neumí. Soubor dej Sdílet → Uložit do Souborů a v myX ho načti tlačítkem importu (Přehled nebo Nastavení → Data).</p>
        <p><b>Tvůj nebo cizí log?</b> myX pozná podle sériového čísla počítače, jestli jde o tvůj log (ponory se přidají k tvým), nebo o cizí log (uloží se zvlášť jen ke čtení). Logy různých lidí se nikdy nemíchají.</p>
        <p>Opakovaný import stejného souboru nevadí – přidají se jen nové ponory. Platí i pro cizí logy: nový export nebo jednotlivé sdílené ponory stejného počítače se k už načtenému logu přidají, nic se nenahrazuje ani nezdvojí.</p>
      </H>

      <H title="2. Sdílení">
        <p><b>Sdílet aplikaci:</b> Nastavení → Sdílení – odkaz nebo QR kód.</p>
        <p><b>Počítače a typ přístroje:</b> myX čte mód každého ponoru z logu (CC, OC, Gauge…) a typ přístroje odvodí sám: CC → eCCR, Gauge → pSCR (OC a Freedive zatím zašedlé). Zobrazují se jen podporované typy (CC s eCCR, Gauge s pSCR); ostatní ponory zůstávají uložené a v seznamu je řádek „Skryto…“. V detailu ponoru řádek „počítač · mód · přístroj“ – klepnutím změníš typ (nabídka podle módu) a zásobní plyn jen pro tento ponor; výchozí pro převládající mód počítače nastavíš v Nastavení (Moje počítače, u cizích logů Akce → Přístroj). Bez čidel O₂ (Gauge) se nezobrazují čidla, setpoint, dávky, zátěž, scrubber ani dekomprese; pO₂ je jen vypočtené ze zásobního plynu (u polouzavřeného okruhu horní mez). U pSCR se zadaným zásobním plynem je i odhad pO₂ ve smyčce (?) podle poměru přístroje (výchozí 1:8) – jen výpočet, ne měření. Bez vysílačů tlaku zadáš u ponoru lahev a tlak před a po (u pSCR na to upozorní žlutý rámeček nahoře). Scrubber bez časovače v logu: na Přehledu zadáš datum naplnění a výdrž náplně, myX sečte čas ponorů od naplnění.</p>
        <p><b>Dev verze:</b> Nastavení → Dev – testovací verze s novinkami ve vývoji (štítek DEV v záhlaví). Pracuje na vlastní kopii tvých dat, nesynchronizuje a do běžné verze nic nepřenese; „Obnovit kopii z produkce“ ji načte znovu. Vypnutím se vrátíš do běžné verze. V dev verzi jde cizí log otevřít „jako můj“ (přepínač logů v záhlaví nebo DB → Logy ostatních) – aplikace se chová jako u vlastních dat, ale nic se neukládá: žlutý pruh upozorňuje, že změny jsou jen dočasné a po restartu zmizí.</p>
        <p><b>Sdílet svůj log:</b> záložka DB → Sdílet můj log – pošle parťákovi tvůj původní export, aby si mohl ponory porovnat.</p>
        <p><b>Sdílet jen vybrané ponory:</b> v detailu ponoru tlačítko ⤴ (spojený ponor se všemi částmi), v seznamu ponorů ☑ (v cizím logu „Vybrat“) → klepnutím vyber ponory → Sdílet. Vznikne malý soubor .db se záznamy beze změny a s tvou lokalitou a parťáky; hodnocení a poznámka se nesdílí. Jde sdílet i ponory z otevřeného cizího logu – u příjemce patří původnímu majiteli. Po klepnutí vybereš: Poslat přes… (WhatsApp, Messenger, mail – soubor odejde jako .txt, příjemce ho otevře přes Sdílet → myX nebo importem) nebo Uložit jako .db.</p>
        <p><b>Smazání cizího ponoru:</b> v detailu ponoru z cizího logu „Smazat ponor z cizího logu“, nebo víc najednou přes Vybrat → Smazat. Prázdný log zmizí; majitel a aliasy zůstanou.</p>
        <p><b>Záloha:</b> Nastavení → Data → Stáhnout zálohu (lokality, parťáci, poznámky, hodnocení, čidla, baterie, nastavení). Obnova ze zálohy ji načte zpět.</p>
      </H>

      <H title="3. Seznam ponorů">
        <p><b>Filtry se pamatují:</b> po otevření ponoru nebo srovnání a návratu zůstanou filtry i pozice v seznamu; „Vše“ u hodnocení je vynuluje. Hledací pole vyprázdníš křížkem ✕.</p>
        <p><b>Výběr ponorů:</b> ☑ vpravo u filtrů zapne výběr – klepnutím ponory zaškrtáváš, dole je Vše / Sdílet / ✕.</p>
        <p><b>Plné / kompaktní zobrazení:</b> přepínač ☰ / ≡ vpravo u filtrů. V kompaktním zobrazení naznačí problém barevný rámeček řádku.</p>
        <p><b>Filtry:</b> Vše / 👍 / 👎 / ❗ podle hodnocení; pod nimi plyny (AIR, TMX, NX) a problémy (pO₂, CO₂, ČIDLA, TLAK, BAT, SP). Uvnitř skupiny stačí kterýkoli, mezi skupinami platí obojí. Pod zapnutým filtrem je počet ponorů.</p>
        <p><b>Hledání:</b> lokalita, parťák, poznámka nebo datum. Parťáci jdou filtrovat i štítky, „Bez parťáka“ ukáže ponory bez parťáka.</p>
        <p><b>Tagy problémů</b> (žlutě varování, červeně závažné): pO₂ (hypoxie, nízké / vysoké pO₂), CO₂ (vysoké CO₂, souvislost s námahou, chyba čidla), ČIDLO 1 2 3 (problémová O₂ čidla), TLAK (nízký tlak onboard lahve), BAT (baterie), SP (chyby v obsluze setpointu). ⇄ 2 = ponor jde porovnat s buddym (počet potápěčů).</p>
      </H>

      <H title="4. Detail ponoru">
        <p><b>Logbook:</b> upozornění (klepnutím se rozbalí popis), V kostce (hloubka, doba, plyny, teplota, pO₂, pN₂, hustota), profil s deko stropem a zastávkami, spotřeba plynu (onboard / EXT), námaha, lokalita, parťáci, hodnocení a poznámka. Swipem přecházíš mezi ponory.</p>
        <p><b>Zátěž:</b> rychlost poklesu pO₂ (spotřeba O₂) proti tvé obvyklé úrovni z tvých ponorů. Počítá se z 3min okna bez rušených vzorků (klesání, hladina, přepnutí SP a ruční dávka O₂ do ustálení pO₂, 90 s po doplnění diluentu); při úvodním sestupu chybí, mezery do 3 min jsou přemostěné tečkovaně (dopočteno). „Zvýšená zátěž“ = nad 2× aspoň 3 min. Je v grafu „CO₂ a dechová práce“ spolu s CO₂ a hustotou plynu.</p>
        <p><b>Grafy:</b> pO₂ s čidly a setpointem, CO₂ ve smyčce se zátěží a hustotou plynu, dekomprese (NDL, TTS), tkáně a kyslík (GF99, CNS; šedě úseky nasycování, kdy počítač GF99 neukazuje), teplota a baterie; podbarvené alarmy, dávky O₂ a rozjetí čidel. Pod legendou grafu je sbalovací řádek „Události“ – chronologicky upozornění, která se grafu týkají; klepnutím na událost se na ni nastaví posuvník. Vysvětlení grafu je ve sbalovacím řádku „Popis grafu“. Časové údaje: okamžik v ponoru 2′15″, délka 2 min 15 s.</p>
        <p><b>Spojené ponory:</b> záznamy s povrchovým intervalem do 30 min (Nastavení → Výbava) se spojí automaticky; v detailu je karta s částmi a tlačítkem Oddělit, oddělenou část jde zase spojit zpět.</p>
        <p><b>Hodnoty:</b> všechny údaje z hlavičky a patičky logu (GF, CNS, baterie, scrubber, kalibrace…) se značkou jistoty.</p>
        <p><b>Události:</b> přepnutí setpointu (i ručně v menu), ovládání počítače (tlačítka, menu, info obrazovky), alarmy z počítače, varování zobrazená na počítači a kdy jsi je potvrdil, zavření / otevření onboard lahve, informace (modré hlášky).</p>
      </H>

      <H title="5. Co myX z logu vyčte">
        <p><b>O₂ čidla:</b> historie citlivosti (mV na vzduchu, stárnutí, current limiting), rozjetí v ponoru – jedno vadné čidlo, nebo vlhkost / zatékání (víc čidel najednou), vyřazené čidlo z hlasování.</p>
        <p><b>CO₂:</b> vysoké hodnoty a alarmy, věrohodnost čidla (oříznutá nula, nesmyslné hodnoty), souvislost s námahou, hustotou plynu a dávkami.</p>
        <p><b>pO₂:</b> nízké pO₂ při zanoření rozlišené podle průběhu – dohánění setpointu vs. podezření na hypoxii (zavřený ventil O₂), vysoké pO₂, pN₂ / END.</p>
        <p><b>Setpoint:</b> kdy a jak jsi přepnul (ručně v menu), pozdní přepnutí (víc než 2 min po dosažení dna, hodnotí se jen první přepnutí nahoru; jako informace v Událostech, nebo po zapnutí v Nastavení jako žluté varování s tagem SP), klesání s vysokým SP, 0,19 mimo závěr.</p>
        <p><b>Plyny a lahve:</b> spotřeba onboard lahví, externí lahev, přechod z onboard na externí, nízký tlak, dávky O₂ (solenoid / ručně).</p>
        <p><b>Počítač:</b> varování na displeji a jejich potvrzení, baterie, nízké NDL.</p>
        <p><b>Vysoké pO₂:</b> kromě alarmu z počítače hlídá myX samo: žlutě nad 1,4 bar déle než 1 min mimo deko zastávky, červeně nad 1,6 bar (Nastavení → Upozornění). V seznamu tag pO₂, v grafu pásma. Když nad 1,4 bar dostane pO₂ sám diluent v hloubce, nevaruje se – v grafu je to světle modré pásmo (klepnutím v legendě skryješ); nad 1,6 bar je vždy červeně.</p>
        <p><b>Řešení varování:</b> v rozbaleném varování nebo alarmu z počítače je časová osa – potvrzení tlačítkem, přepnutí setpointu, ruční dávky O₂, diluent, otevření lahve, přechod na OC a konec alarmu. (P) = odhad z dat. Každá situace má odkaz „Ukázat v grafu ›“ – otevře Grafy, posune na graf a nastaví posuvník na začátek situace.</p>
        <p><b>Grafy:</b> posuvník jedním prstem; tlačítka − 0 + v řádku s nadpisem grafu: + přiblíží 2× kolem posuvníku (bez něj kolem středu), − oddálí, 0 = celý graf; přiblížit jde i roztažením dvou prstů, zpět i dvojklepnutím. Přiblížení platí pro všechny grafy ponoru. Posuvník dotažený k okraji přiblíženého grafu posouvá výřez. Šedá linka = profil hloubky. Hodnoty z posuvníku jsou v pruhu pod grafem a zůstanou i po zvednutí prstu (zrušíš ✕ nebo dvojklepnutím). Položky legendy jde zapínat a vypínat.</p>
        <p><b>Baterie Petrelu:</b> výměnu pozná sama (skok procent, u NiMH skok napětí, jiný typ) a trend počítá jen od ní; lithiovou hlídá podle procent (pod 50 % slábne, pod 25 % slabá). Po výměně po posledním ponoru skryje upozornění tlačítko „Baterii jsem vyměnil“ v panelu baterií.</p>
        <p><b>Značky jistoty:</b> ✓ potvrzeno daty, (P) pravděpodobně, (?) hypotéza – část záznamů Shearwater nedokumentuje a význam je odvozený z dat.</p>
      </H>

      <H title="6. Porovnání s ostatními">
        <p><b>Logy ostatních:</b> záložka DB → Načíst log (nebo sdílením souboru do myX). Cizí log jde otevřít jen ke čtení.</p>
        <p><b>Párování ponorů:</b> společné ponory se najdou podle profilu prvních 10 minut a času začátku – i když se hodiny počítačů rozcházejí o minuty nebo o hodinu (letní / zimní čas).</p>
        <p><b>Srovnání:</b> záložka DB → Srovnání nebo ⇄ u ponoru. Ukáže profily, pO₂, CO₂, deko a závěr po sekcích (deko, pO₂, CO₂, dech, profil, plyny); jde porovnat i víc potápěčů najednou. Nevěrohodná čidla se ze srovnání vynechají. V rozdílech je každý údaj blok s hodnotami potápěčů pod sebou; ▲ červený rámeček = nejvyšší, ▼ fialový = nejnižší; méně podstatné údaje jsou pod „Další údaje“. Filtr společných ponorů zůstane i po návratu ze srovnání.</p>
        <p><b>Sdílet srovnání:</b> ⤴ Sdílet srovnání nahoře na srovnání pošle statickou stránku .html (závěr, grafy, rozdíly) – příjemce ji otevře v prohlížeči i bez myX. Neobsahuje ID počítačů ani surová data; „Já“ nahradí tvé jméno z Nastavení → Sdílení.</p>
        <p><b>Převzaté údaje:</b> když má parťák u společného ponoru lokalitu nebo jména, myX je ukáže v detailu ponoru v kartě „Z logů ostatních“. U každého jména je Akce: To je… (propojit s tvým parťákem / lokalitou – vznikne alias), Přidat k ponoru, Založit nového, To jsem já. U podobného jména nabídne např. „To je Radek Patak?“.</p>
        <p><b>Aliasy:</b> propojení platí pro všechny ponory a zůstane i po smazání nebo aktualizaci cizího logu. Zrušit jde v B&L v detailu parťáka / lokality (karta Aliasy), tvoje jména v Nastavení → Výbava → Moje aliasy.</p>
        <p><b>Přepínání logů:</b> na Přehledu, Ponorech a v B&L klepni na jméno v záhlaví (›) – vybereš svůj log nebo uložený cizí log; cizí se otevře jen pro čtení (v B&L jeho názvy, „→“ = propojeno s tvým, „To je…“ propojí). DB a Nastavení jsou vždy tvoje – cizí log se tam zavře.</p>
        <p><b>Logy ostatních v DB:</b> u každého počítače tlačítko Akce (majitel, hlavní počítač, To je můj počítač, Smazat); Otevřít a Srovnání jsou u majitele. ID počítače se ukazuje jen tady, jinde jméno majitele.</p>
      </H>

      <H title="7. B&L – parťáci a lokality">
        <p>Tvoje lokality a parťáci s počty ponorů. Slučování dvou jmen (s výběrem, které zůstane). Karta „Z cizích logů“ nabízí jména z logů ostatních: Přidat k mým, Je to… (přiřadit k existujícímu) nebo To jsem já. V detailu parťáka a lokality je karta Aliasy s jmény z cizích logů, která k nim patří (✕ zruší propojení).</p>
      </H>

      <H title="8. Přehled a nastavení">
        <p><b>Přehled:</b> stav O₂ čidel a CO₂ čidla, scrubber, baterie, nejhlubší ponory, poslední ponor; ⚠ vpravo nahoře shrnuje všechna aktuální varování.</p>
        <p><b>Nastavení:</b> objemy onboard lahví, datum náplně scrubberu, prahy upozornění po oblastech, záloha, reset logbooku.</p>
        <p>Důležité je neklikat 2× na nadpis „Kde jsem“ na Přehledu.</p>
      </H>
    </div>
  );
}
