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
        <p><b>Sdílet svůj log:</b> záložka DB → Sdílet můj log – pošle parťákovi tvůj původní export, aby si mohl ponory porovnat.</p>
        <p><b>Sdílet jen vybrané ponory:</b> v detailu ponoru tlačítko ⤴ (spojený ponor se všemi částmi), v seznamu ponorů ☑ (v cizím logu „Vybrat“) → klepnutím vyber ponory → Sdílet. Vznikne malý soubor .db se záznamy beze změny a s tvou lokalitou a parťáky; hodnocení a poznámka se nesdílí. Jde sdílet i ponory z otevřeného cizího logu – u příjemce patří původnímu majiteli.</p>
        <p><b>Záloha:</b> Nastavení → Data → Stáhnout zálohu (lokality, parťáci, poznámky, hodnocení, čidla, baterie, nastavení). Obnova ze zálohy ji načte zpět.</p>
      </H>

      <H title="3. Seznam ponorů">
        <p><b>Výběr ponorů:</b> ☑ vpravo u filtrů zapne výběr – klepnutím ponory zaškrtáváš, dole je Vše / Sdílet / ✕.</p>
        <p><b>Plné / kompaktní zobrazení:</b> přepínač ☰ / ≡ vpravo u filtrů. V kompaktním zobrazení naznačí problém barevný rámeček řádku.</p>
        <p><b>Filtry:</b> Vše / 👍 / 👎 / ❗ podle hodnocení; pod nimi plyny (AIR, TMX, NX) a problémy (pO₂, CO₂, ČIDLA, TLAK, BAT, SP). Uvnitř skupiny stačí kterýkoli, mezi skupinami platí obojí. Pod zapnutým filtrem je počet ponorů.</p>
        <p><b>Hledání:</b> lokalita, parťák, poznámka nebo datum. Parťáci jdou filtrovat i štítky, „Bez parťáka“ ukáže ponory bez parťáka.</p>
        <p><b>Tagy problémů</b> (žlutě varování, červeně závažné): pO₂ (hypoxie, nízké / vysoké pO₂), CO₂ (vysoké CO₂, souvislost s námahou, chyba čidla), ČIDLO 1 2 3 (problémová O₂ čidla), TLAK (nízký tlak onboard lahve), BAT (baterie), SP (chyby v obsluze setpointu). ⇄ 2 = ponor jde porovnat s buddym (počet potápěčů).</p>
      </H>

      <H title="4. Detail ponoru">
        <p><b>Logbook:</b> upozornění (klepnutím se rozbalí popis), V kostce (hloubka, doba, plyny, teplota, pO₂, pN₂, hustota), profil s deko stropem a zastávkami, spotřeba plynu (onboard / EXT), námaha, lokalita, parťáci, hodnocení a poznámka. Swipem přecházíš mezi ponory.</p>
        <p><b>Grafy:</b> pO₂ s čidly a setpointem, CO₂ ve smyčce, teplota a baterie; podbarvené alarmy, dávky O₂ a rozjetí čidel.</p>
        <p><b>Hodnoty:</b> všechny údaje z hlavičky a patičky logu (GF, CNS, baterie, scrubber, kalibrace…) se značkou jistoty.</p>
        <p><b>Události:</b> přepnutí setpointu (i ručně v menu), ovládání počítače (tlačítka, menu, info obrazovky), alarmy z počítače, varování zobrazená na počítači a kdy jsi je potvrdil, zavření / otevření onboard lahve, informace (modré hlášky).</p>
      </H>

      <H title="5. Co myX z logu vyčte">
        <p><b>O₂ čidla:</b> historie citlivosti (mV na vzduchu, stárnutí, current limiting), rozjetí v ponoru – jedno vadné čidlo, nebo vlhkost / zatékání (víc čidel najednou), vyřazené čidlo z hlasování.</p>
        <p><b>CO₂:</b> vysoké hodnoty a alarmy, věrohodnost čidla (oříznutá nula, nesmyslné hodnoty), souvislost s námahou, hustotou plynu a dávkami.</p>
        <p><b>pO₂:</b> nízké pO₂ při zanoření rozlišené podle průběhu – dohánění setpointu vs. podezření na hypoxii (zavřený ventil O₂), vysoké pO₂, pN₂ / END.</p>
        <p><b>Setpoint:</b> kdy a jak jsi přepnul (ručně v menu), pozdní přepnutí, klesání s vysokým SP, 0,19 mimo závěr.</p>
        <p><b>Plyny a lahve:</b> spotřeba onboard lahví, externí lahev, přechod z onboard na externí, nízký tlak, dávky O₂ (solenoid / ručně).</p>
        <p><b>Počítač:</b> varování na displeji a jejich potvrzení, baterie, nízké NDL.</p>
        <p><b>Baterie Petrelu:</b> výměnu pozná sama (skok procent, u NiMH skok napětí, jiný typ) a trend počítá jen od ní; lithiovou hlídá podle procent (pod 50 % slábne, pod 25 % slabá). Po výměně po posledním ponoru skryje upozornění tlačítko „Baterii jsem vyměnil“ v panelu baterií.</p>
        <p><b>Značky jistoty:</b> ✓ potvrzeno daty, (P) pravděpodobně, (?) hypotéza – část záznamů Shearwater nedokumentuje a význam je odvozený z dat.</p>
      </H>

      <H title="6. Porovnání s ostatními">
        <p><b>Logy ostatních:</b> záložka DB → Načíst log (nebo sdílením souboru do myX). Cizí log jde otevřít jen ke čtení.</p>
        <p><b>Párování ponorů:</b> společné ponory se najdou podle profilu prvních 10 minut a času začátku – i když se hodiny počítačů rozcházejí o minuty nebo o hodinu (letní / zimní čas).</p>
        <p><b>Srovnání:</b> záložka DB → Srovnání nebo ⇄ u ponoru. Ukáže profily, pO₂, CO₂, deko a závěr po sekcích (deko, pO₂, CO₂, dech, profil, plyny); jde porovnat i víc potápěčů najednou. Nevěrohodná čidla se ze srovnání vynechají. V rozdílech je každý údaj blok s hodnotami potápěčů pod sebou; ▲ červený rámeček = nejvyšší, ▼ fialový = nejnižší; méně podstatné údaje jsou pod „Další údaje“. Filtr společných ponorů zůstane i po návratu ze srovnání.</p>
        <p><b>Převzaté údaje:</b> když má parťák u společného ponoru lokalitu nebo jména, myX je ukáže v detailu ponoru v kartě „Z logů ostatních“. U každého jména je Akce: To je… (propojit s tvým parťákem / lokalitou – vznikne alias), Přidat k ponoru, Založit nového, To jsem já. U podobného jména nabídne např. „To je Radek Patak?“.</p>
        <p><b>Aliasy:</b> propojení platí pro všechny ponory a zůstane i po smazání nebo aktualizaci cizího logu. Zrušit jde v B&L v detailu parťáka / lokality (karta Aliasy), tvoje jména v Nastavení → Výbava → Moje aliasy.</p>
        <p><b>Logy ostatních v DB:</b> u každého počítače tlačítko Akce (majitel, hlavní počítač, To je můj počítač, Smazat); Otevřít a Srovnání jsou u majitele. ID počítače se ukazuje jen tady, jinde jméno majitele.</p>
      </H>

      <H title="7. B&L – parťáci a lokality">
        <p>Tvoje lokality a parťáci s počty ponorů. Slučování dvou jmen (s výběrem, které zůstane). Karta „Z cizích logů“ nabízí jména z logů ostatních: Přidat k mým, Je to… (přiřadit k existujícímu) nebo To jsem já. V detailu parťáka a lokality je karta Aliasy s jmény z cizích logů, která k nim patří (✕ zruší propojení).</p>
      </H>

      <H title="8. Přehled a nastavení">
        <p><b>Přehled:</b> stav O₂ čidel a CO₂ čidla, scrubber, baterie, nejhlubší ponory, poslední ponor; ⚠ vpravo nahoře shrnuje všechna aktuální varování.</p>
        <p><b>Nastavení:</b> objemy onboard lahví, datum náplně scrubberu, prahy upozornění po oblastech, záloha, reset logbooku.</p>
      </H>
    </div>
  );
}
