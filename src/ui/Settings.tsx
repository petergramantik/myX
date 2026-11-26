import { appUrl } from "../app/appurl";
import type { Settings } from "../app/model";
import { doBackup, fetchStats, lastBackup } from "../app/backup";
import { LANG, LANGS, LOC, setLang, tr, type Lang } from "../app/i18n";
import { ask, askText, choose } from "../app/dialog";
import { AliasCard } from "./Sites";
import { useEffect, useRef, useState } from "react";
import { scrubberFill } from "../core/analysis";
import { CCR_MODELS, DEFAULT_ALL_TH, ccrModel, type CcrModel } from "../app/model";
import { OwnerPicker } from "./Owner";
import { ME, closeGuest, compLabel, deleteGuest, guestRawIndex, logName, ownerName, setComputerOwner, setPrimaryComputer, askSameOwner, adoptGuestAsOwn, ownComputers, removeOwnComputer, exportBackup, guestLogs, guestIndexLoad, importAny, importBackup, nearestPair, openGuest, ownMetas, saveSettings, syncNow, toast, wipeLocal, resetAll, type GuestLog } from "../app/store";
import { setWorker, syncKey, workerUrl } from "../app/config";
import { APP_VERSION, RELEASES } from "../app/version";
import { EN_REL } from "../i18n/en";
import { IS_DEV, copyProdToDev, devCopiedAt } from "../app/db";
import { lastExport } from "../app/store";
import { shareDb, shareDives } from "./share";
import { openDivesPick } from "./Dives";
import { computerCfg, openTempOwn, ownHidden, ownLb, rigChoices, setAiDil, setComputerRig, typeBreakdown } from "../app/store";
import type { Rig } from "../core/rig";
import { Card, KV, fmtDate, go, tab, useBackLayer, useStore } from "./common";
import { ImportButton } from "./Overview";

export function SettingsScreen() {
  const st = useStore();
  const [url, setUrl] = useState(workerUrl());
  const [key, setKey] = useState(syncKey());
  const th = st.lb.settings.th;
  const fileRef = useRef<HTMLInputElement>(null);
  const fill = scrubberFill(st.metas.map((m) => m.h));
  const manual = st.lb.settings.manualFill;
  const setTh = (k: keyof typeof th, v: string) => { const n = parseFloat(v.replace(",", ".")); if (!Number.isNaN(n)) saveSettings({ th: { ...th, [k]: n } }); };
  return (
    <div className="screen">
      <Sec title="Zobrazení">
        <label>Jazyk / Language<select data-noi18n value={LANG} onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={!!st.lb.settings.mottoNeutral} onChange={(e) => saveSettings({ mottoNeutral: e.target.checked })} /> Hlášky neutrálně (bez humoru)</label>
        <label className="check"><input type="checkbox" checked={st.lb.settings.motto !== false} onChange={(e) => saveSettings({ motto: e.target.checked })} /> Hláška nad scrubberem („Všecko v cajku…“ / „Mám warningy…“)</label>
        <label className="check"><input type="checkbox" checked={st.lb.settings.gearMotto !== false} onChange={(e) => saveSettings({ gearMotto: e.target.checked })} /> Pruh stavu výstroje nahoře ve Výstroji („Výstroj v cajku…“ podle revizí, servisů a závad)</label>
      </Sec>

      <Sec title="Výbava">
        <p className="note">Objemy on-board lahví a seznam lahví a automatik najdeš ve Výstroji.</p>
        <button className="btn" onClick={() => tab({ t: "gear" })}>Výstroj ›</button>
        <label>Spotřeba ve stresu pro výpočet bailoutu (l/min)<input inputMode="decimal" defaultValue={st.lb.settings.boSac ?? 20} onBlur={(e) => { const v = parseFloat(e.target.value.replace(",", ".")); if (v > 0) saveSettings({ boSac: v }); }} /></label>
        <label>Lahve: „Doplnit“ pod (% plnicího tlaku)<input inputMode="numeric" defaultValue={st.lb.settings.fillPct ?? 85} onBlur={(e) => { const v = Math.round(+e.target.value); if (v >= 30 && v <= 100) saveSettings({ fillPct: v }); }} /></label>
        <label>Lahve: výchozí plnicí tlak (bar)<input inputMode="numeric" defaultValue={st.lb.settings.fillBar ?? 200} onBlur={(e) => { const v = Math.round(+e.target.value); if (v >= 50 && v <= 350) saveSettings({ fillBar: v }); }} /></label>
        <p className="note">Platí pro lahve ve Výstroji mimo on-board lahve rebreatheru (ty „Doplnit“ pod 100 bar) a lahve na plnění. Plnicí tlak jde u lahve zadat zvlášť (např. ocel 232 nebo 300 bar). Prázdná pod 50 bar.</p>
        <label>Bailout: AIR dýchat do hloubky (m)<input inputMode="numeric" defaultValue={st.lb.settings.boAirMax ?? 40} onBlur={(e) => { const v = Math.round(+e.target.value); if (v > 0 && v <= 70) saveSettings({ boAirMax: v }); }} /></label>
        <label>Bailout: násobek TTS pro dekompresi na otevřeném okruhu<input inputMode="decimal" defaultValue={st.lb.settings.boTtsMul ?? 1.5} onBlur={(e) => { const v = parseFloat(e.target.value.replace(",", ".")); if (v >= 1 && v <= 4) saveSettings({ boTtsMul: v }); }} /></label>
        <p className="note">Bailout po ponoru: potřeba plynu v nejhorším okamžiku ponoru proti BO a deko lahvím z „Před a po ponoru“, po plynech (AIR do nastavené hloubky, EAN a O₂ podle MOD při pO₂ 1,6, trimix všude). TTS z počítače platí pro CCR – dekomprese na otevřeném okruhu je delší, proto násobek (P, prozatím; přesněji až s vlastním modelem dekomprese).</p>
        <label className="check"><input type="checkbox" checked={!st.lb.settings.surfGfOff} onChange={(e) => saveSettings({ surfGfOff: !e.target.checked })} /> SurfGF při vynoření (dlaždice, trend a upozornění)</label>
        {!st.lb.settings.surfGfOff && <label>Hranice SurfGF při vynoření (%)<input inputMode="numeric" defaultValue={st.lb.settings.surfGfLim ?? 70} onBlur={(e) => { const v = Math.round(+e.target.value); if (v > 0 && v <= 150) saveSettings({ surfGfLim: v }); }} /></label>}
        <label>Spojit záznamy s povrchovým intervalem do (minuty, 0 = vypnuto)<input inputMode="decimal" defaultValue={st.lb.settings.segGap ?? 30} onBlur={(e) => { const v = parseFloat(e.target.value.replace(",", ".")); if (v >= 0) saveSettings({ segGap: v }); }} /></label>
        <p className="note">Víc záznamů počítače jako jeden ponor (bazén, krátký suchý přechod). Záznamy se stejným číslem ponoru v Shearwater Cloudu se spojují vždy; v detailu ponoru jdou části ručně oddělit nebo spojit.</p>
        <p className="note">Moje počítače (přístroj, rebreather, vysílače) nastavíš v B&L → DB → Databáze → Můj log.</p>
        <button className="btn" onClick={() => tab({ t: "hub", sub: "db" })}>Moje počítače ›</button>
        <AliasCard kind="buddy" id={ME} title="Moje aliasy" />
        <label>Datum náplně scrubberu (jinak podle počítadla{fill ? `: ${fmtDate(fill.start)}` : ""})
          <input type="date" value={manual ? new Date(manual * 1000).toISOString().slice(0, 10) : ""} onChange={(e) => saveSettings({ manualFill: e.target.value ? Date.parse(e.target.value + "T12:00:00Z") / 1000 : null })} />
        </label>
      </Sec>

      <Sec title="Logy ostatních">
        <p className="note">Cizí logy (jen ke čtení) se načítají a spravují v záložce DB.</p>
        <button className="btn" onClick={() => tab({ t: "hub", sub: "db" })}>Spravovat logy ostatních ›</button>
      </Sec>

      <Sec title="Sdílení"><ShareInner />
        <p className="note">Své jméno a sdílení svého logu najdeš v B&L → DB → Databáze → Můj log.</p>
      </Sec>

      <Sec title="Upozornění">
        <h3 className="subh">Čidla O₂</h3>
          <label>Životnost, když u čidla není zadaná (měsíce)<input inputMode="decimal" defaultValue={th.cellLifeM ?? 12} onBlur={(e) => setTh("cellLifeM", e.target.value)} /></label>
          <label>Výměna nejpozději po (měsíce)<input inputMode="decimal" defaultValue={th.cellMaxM ?? 18} onBlur={(e) => setTh("cellMaxM", e.target.value)} /></label>
          <label>Varování pod (mV na vzduchu)<input inputMode="decimal" defaultValue={th.cellAirWarn ?? 9} onBlur={(e) => setTh("cellAirWarn", e.target.value)} /></label>
          <label>Výměna pod (mV na vzduchu)<input inputMode="decimal" defaultValue={th.cellAirBad ?? 8} onBlur={(e) => setTh("cellAirBad", e.target.value)} /></label>
          <label>Pokles citlivosti za měsíc (%)<input inputMode="decimal" defaultValue={th.cellDropPct ?? 15} onBlur={(e) => setTh("cellDropPct", e.target.value)} /></label>
          <label>Linearita pod (current limiting)<input inputMode="decimal" defaultValue={th.cellLinWarn ?? 0.9} onBlur={(e) => setTh("cellLinWarn", e.target.value)} /></label>
        <h3 className="subh">pO₂ a hypoxie</h3>
          <label>pO₂ při zanoření – nízké pod (bar)<input inputMode="decimal" defaultValue={th.po2Lo ?? 0.4} onBlur={(e) => setTh("po2Lo", e.target.value)} /></label>
          <label>pO₂ při zanoření – varovat, když minimum pod (bar)<input inputMode="decimal" defaultValue={th.po2LoMin ?? 0.3} onBlur={(e) => setTh("po2LoMin", e.target.value)} /></label>
          <label>pO₂ při zanoření – varovat po (s pod prahem)<input inputMode="decimal" defaultValue={th.po2LoWarnS ?? 30} onBlur={(e) => setTh("po2LoWarnS", e.target.value)} /></label>
          <label>Hypoxie? – minimum pod (bar)<input inputMode="decimal" defaultValue={th.po2Hypo ?? 0.21} onBlur={(e) => setTh("po2Hypo", e.target.value)} /></label>
          <label>Hypoxie? – pod prahem déle než (s)<input inputMode="decimal" defaultValue={th.po2LoBadS ?? 120} onBlur={(e) => setTh("po2LoBadS", e.target.value)} /></label>
          <label>Vysoké pO₂ – žlutě nad (bar; zaokrouhlí se na 0,05, 1,3–1,6)<input inputMode="decimal" defaultValue={th.po2HiWarn ?? 1.4} onBlur={(e) => setTh("po2HiWarn", e.target.value)} /></label>
          <label>Vysoké pO₂ – žlutě, když déle než (s, mimo deko zastávky)<input inputMode="decimal" defaultValue={th.po2HiWarnS ?? 60} onBlur={(e) => setTh("po2HiWarnS", e.target.value)} /></label>
          <label>Vysoké pO₂ – červeně nad (bar, kdykoli)<input inputMode="decimal" defaultValue={th.po2HiBad ?? 1.6} onBlur={(e) => setTh("po2HiBad", e.target.value)} /></label>
          <label>pN₂ – zvýraznit nad (bar; END ≈ {Math.round(((th.pn2Hot ?? 3.16) / 0.79 - 1) * 10)} m)<input inputMode="decimal" defaultValue={th.pn2Hot ?? 3.16} onBlur={(e) => setTh("pn2Hot", e.target.value)} /></label>
        <h3 className="subh">CO₂</h3>
          <label>Podezřelé maximum (mbar)<input inputMode="decimal" defaultValue={th.co2Mbar ?? 5} onBlur={(e) => setTh("co2Mbar", e.target.value)} /></label>
        <h3 className="subh">Setpoint</h3>
          <label>Pozdní přepnutí na vysoký: víc než (minuty) po dosažení dna<input inputMode="decimal" defaultValue={th.spLateMin ?? 2} onBlur={(e) => { const n = parseFloat(e.target.value.replace(",", ".")); if (!Number.isNaN(n)) saveSettings({ th: { ...th, spLateMin: n }, spLateSet: true }); }} /></label>
          <label className="check"><input type="checkbox" checked={!!th.spLateWarn} onChange={(e) => saveSettings({ th: { ...th, spLateWarn: e.target.checked } })} /> Pozdní přepnutí jako varování (žlutě v detailu ponoru a tag SP; vypnuto = jen informace v Událostech)</label>
          <label>Oscilace hloubky na dně (m)<input inputMode="decimal" defaultValue={th.spOsc ?? 3} onBlur={(e) => setTh("spOsc", e.target.value)} /></label>
          <label>Výraznější klesání s vysokým SP (m)<input inputMode="decimal" defaultValue={th.spDescM ?? 6} onBlur={(e) => setTh("spDescM", e.target.value)} /></label>
        <h3 className="subh">Srovnání</h3>
          <label>Pod setpointem o víc než (bar)<input inputMode="decimal" defaultValue={th.spBelow ?? 0.15} onBlur={(e) => setTh("spBelow", e.target.value)} /></label>
          <label>Nad setpointem o víc než (bar, mimo deko)<input inputMode="decimal" defaultValue={th.spAbove ?? 0.2} onBlur={(e) => setTh("spAbove", e.target.value)} /></label>
        <h3 className="subh">Scrubber</h3>
          <label>Upozornit při zbytku (%)<input inputMode="decimal" defaultValue={th.scrubPct ?? 50} onBlur={(e) => setTh("scrubPct", e.target.value)} /></label>
          <label>Upozornit po dnech od náplně<input inputMode="decimal" defaultValue={th.scrubDays ?? 14} onBlur={(e) => setTh("scrubDays", e.target.value)} /></label>
          <label>Zvýraznit v ponoru, když zbývá méně než (minuty; pod 30 minut červeně)<input inputMode="decimal" defaultValue={th.scrubLeftMin ?? 90} onBlur={(e) => setTh("scrubLeftMin", e.target.value)} /></label>
        <h3 className="subh">Baterie</h3>
          <label>Rezerva nad prahem varování (V)<input inputMode="decimal" defaultValue={th.batMarginV ?? 0.05} onBlur={(e) => setTh("batMarginV", e.target.value)} /></label>
          <label>Baterie v hlavě – varovat po hodinách pod vodou (0 = vypnuto)<input inputMode="decimal" defaultValue={th.headBatHours ?? 0} onBlur={(e) => setTh("headBatHours", e.target.value)} /></label>
          <label>Baterie v hlavě – varovat po měsících od výměny (0 = vypnuto)<input inputMode="decimal" defaultValue={th.headBatMonths ?? 0} onBlur={(e) => setTh("headBatMonths", e.target.value)} /></label>
        <button className="btn" onClick={() => saveSettings({ th: { ...DEFAULT_ALL_TH }, manualFill: null })}>Výchozí hodnoty</button>
      </Sec>

      <Sec title="Data">
        <div className="col">
          <ImportButton />
          <BackupBox />
          <button className="btn" onClick={() => fileRef.current?.click()}>Obnovit ze zálohy</button>
          <input ref={fileRef} type="file" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (f) try { toast(`Obnoveno, nových ponorů: ${await importBackup(f)}`); } catch (err) { toast((err as Error).message); }
          }} />
          <button className="btn danger" onClick={async () => {
            if (!await ask("Úplný reset logbooku: smaže všechny lokality, parťáky, poznámky, hodnocení, rozpracované ponory, přiřazení jmen a cizí logy. Ponory, čidla, baterie a nastavení zůstanou. Pokračovat?")) return;
            if (!await ask("Opravdu? Před resetem se stáhne záloha do souboru.")) return;
            const b = await exportBackup();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(b); a.download = `myx-pred-resetem-${new Date().toISOString().slice(0, 10)}.json`; a.click();
            await resetAll(); toast("Logbook resetován");
          }}>Reset logbooku</button>
          <button className="btn danger" onClick={async () => { if (await ask("Smazat všechna data v tomto telefonu?")) { await wipeLocal(); toast("Smazáno"); } }}>Smazat data v telefonu</button>
        </div>
      </Sec>

      <Sec title="Podpořit vývoj">
        <p className="note">myX je zdarma a vzniká ve volném čase. Pokud ti pomáhá, můžeš vývoj podpořit dobrovolným příspěvkem.</p>
        <a className="btn primary" href="https://buymeacoffee.com/petergramantik" target="_blank" rel="noopener noreferrer">☕ Buy me a coffee</a>
      </Sec>

      {syncKey() && <StatsSec />}

      <Sec title="O aplikaci" open>
        <KV rows={[["Verze", <a onClick={() => go({ t: "about" })}>{APP_VERSION} – co je nového ›</a>], ["Ponorů v telefonu", st.metas.length]]} />
        <button className="btn" onClick={() => go({ t: "help" })}>Nápověda ›</button>
      </Sec>

      <DevSec />

      <Sec title="Synchronizace">
        <p className="note">Vývojářská funkce: synchronizace a záloha přes vlastní Cloudflare Worker.</p>
        <p className={"sync " + st.sync.state}>{st.sync.msg || "–"}{st.sync.at ? ` (${new Date(st.sync.at).toLocaleTimeString(LOC)})` : ""}</p>
        <label>Adresa Workeru<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://myx-sync.….workers.dev" /></label>
        <label>Klíč<input value={key} type="password" onChange={(e) => setKey(e.target.value)} /></label>
        <div className="row">
          <button className="btn primary" onClick={() => { setWorker(url, key); syncNow(); }}>Uložit a synchronizovat</button>
        </div>
      </Sec>
    </div>
  );
}

/** Můj log v DB: jméno, období, počítače s akcemi a sdílení – stejné rozložení jako karty logů ostatních. */
export function MyLogCard() {
  const st = useStore();
  const cs = ownComputers();
  const [actFor, setActFor] = useState<string | null>(null);
  useBackLayer(actFor != null, () => setActFor(null));
  const [common, setCommon] = useState(0);
  const [last, setLast] = useState<Awaited<ReturnType<typeof lastExport>>>();
  useEffect(() => { lastExport().then(setLast); }, []);
  useEffect(() => { guestIndexLoad().then((ix) => setCommon(ownMetas().filter((m) => ix.some((g) => nearestPair(g.metas, m).length)).length)); }, [st.metas.length, st.guestRev]);
  if (st.guest) return null;
  const all = [...ownMetas(), ...ownHidden()];
  const from = all.length ? Math.min(...all.map((m) => m.start)) : 0, to = all.length ? Math.max(...all.map((m) => m.start)) : 0;
  const share = async () => {
    const k = await choose("Sdílet můj log", [
      { key: "all", label: `Vše (${all.length} ponorů)`, note: "všechny ponory z myX včetně stažených přes Bluetooth, s lokalitami a parťáky", primary: true },
      { key: "pick", label: "Vybrat ponory", note: "seznam ponorů ve výběru" },
    ]);
    if (k === "all") await shareDives(all);
    else if (k === "pick") openDivesPick();
  };
  return (
    <section className="card logtile mine">
      <div className="lt-h"><b>Můj log</b><span className="pill info">můj</span></div>
      <label className="lt-name">Moje jméno (místo „Já“)<input defaultValue={st.lb.settings.myName || ""} placeholder="např. Peter" onBlur={(e) => saveSettings({ myName: e.target.value.trim() || undefined })} /></label>
      <div className="small muted">{all.length} ponorů{all.length ? ` · ${fmtDate(from)} – ${fmtDate(to)}` : ""} · {common} společných s ostatními</div>
      {cs.map((c) => {
        const ser = parseInt(c.serial, 16), ms = all.filter((m) => m.h.serial === ser), tb = typeBreakdown(ms);
        return (
          <div key={c.serial} className="lt-comp">
            <div className="lt-comp-h">
              <div className="small">{c.model} {c.serial} · {c.count} ponorů · {fmtDate(c.from)} – {fmtDate(c.to)}</div>
              {tb.text && <div className="small muted">{tb.text} · přístroj {rigLabel(ser)} · {ccrModel(computerCfg(ser)?.ccr).label}</div>}
              <button className={"btn small act" + (actFor === c.serial ? " on" : "")} onClick={() => setActFor(actFor === c.serial ? null : c.serial)}>Akce ▾</button>
            </div>
            {actFor === c.serial && <div className="actmenu">
              <button onClick={() => { setActFor(null); editRig(ser, majorityMode(ms)); }}>Přístroj: {rigLabel(ser)}</button>
              <button onClick={() => { setActFor(null); editCcr(ser); }}>Rebreather: {ccrModel(computerCfg(ser)?.ccr).label}</button>
              {aiUnnamed(ser) && <button onClick={() => { setActFor(null); editAi(ser); }}>Vysílače: {aiLabel(ser)}</button>}
              {cs.length > 1 && <button className="danger" onClick={async () => { setActFor(null); if (await ask(`Odebrat počítač ${c.serial} z tvých? Jeho ${c.count} ponorů se smaže z tvého logbooku (i s poznámkami). Znovu ho můžeš načíst jako cizí log a přidat přes „To je můj počítač“.`)) toast(`Odebráno ponorů: ${await removeOwnComputer(c.serial)}`); }}>Odebrat</button>}
            </div>}
          </div>
        );
      })}
      <div className="row">
        <button className="btn primary" disabled={!all.length} onClick={share}>Sdílet můj log</button>
      </div>
      {last && <p className="note"><a onClick={() => shareDb(last.data, last.name, "Můj log")}>Poslat původní export Cloudu</a> (pro Shearwater Cloud; import {new Date(last.at).toLocaleDateString(LOC)}, {last.count} ponorů)</p>}
      <p className="note">Další svůj počítač přidáš u jeho logu níže volbou „To je můj počítač“, nebo při prvním importu.</p>
    </section>
  );
}

/** Sbalitelná sekce nastavení. */
function Sec({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="card sec" open={open}>
      <summary><h2>{title}</h2></summary>
      <div className="sec-b">{children}</div>
    </details>
  );
}

export function AboutScreen() {
  return (
    <div className="screen">
      {LANG === "en" && <p className="note">Detailed release notes are in Czech (switch the language in Settings → Display).</p>}
      {RELEASES.map((r) => (
        <Card key={r.version} title={`${r.version} – ${LANG === "en" ? EN_REL[r.title] ?? r.title : r.title}`}>
          <p className="muted" data-noi18n>{r.date}</p>
          {LANG !== "en" && <ul>{r.items.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </Card>
      ))}
    </div>
  );
}

export const APP_URL = appUrl();
/** public/qr.svg kóduje tuto adresu – po přesunu na jinou doménu vygenerovat znovu. */
const QR_URL = "https://petergramantik.github.io/myX/";

/** Sdílení aplikace: systémové sdílení (nebo zkopírování odkazu) a QR kód. */
function ShareInner() {
  const share = async () => {
    const data = { title: "myX", text: tr("myX – logbook pro rebreather, import ze Shearwater Cloud"), url: APP_URL };
    try {
      if (navigator.share) { await navigator.share(data); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    try { await navigator.clipboard.writeText(APP_URL); toast("Odkaz zkopírován do schránky"); }
    catch { toast(APP_URL); }
  };
  return (
    <>
      <button className="btn primary" onClick={share}>Sdílet aplikaci</button>
      {APP_URL === QR_URL && <img className="qr" src="qr.svg" alt={"QR kód: " + APP_URL} width={180} height={180} />}
      <p className="center small"><a href={APP_URL}>{APP_URL.replace("https://", "")}</a></p>
      <p className="note">Každý má svá data jen ve svém zařízení. Svůj log pošleš parťákovi v záložce DB → Sdílet můj log.</p>
    </>
  );
}

/** Cizí logy: jen k prohlížení, uložené zvlášť, bez synchronizace. */
export function GuestCard() {
  const st = useStore();
  const [groups, setGroups] = useState<{ log: GuestLog; logs: GuestLog[]; counts: Record<string, number>; types: Record<string, string>; modes: Record<string, string>; ai: Record<string, boolean>; from: number; to: number; common: number; alts: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [ownerFor, setOwnerFor] = useState<string | null>(null);
  const [actFor, setActFor] = useState<string | null>(null);
  useBackLayer(actFor != null, () => setActFor(null));
  const [moving, setMoving] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const reload = async () => {
    const raw = await guestRawIndex(), ix = await guestIndexLoad(), mine = ownMetas();
    setGroups(ix.map((g) => {
      const logs = g.log.logs || [g.log], st0 = g.metas.map((m) => m.start);
      const counts: Record<string, number> = {}, types: Record<string, string> = {}, modes: Record<string, string> = {}, ai: Record<string, boolean> = {};
      for (const l of logs) { const ms = raw.find((x) => x.log.id === l.id)?.metas || []; counts[l.id] = ms.length || l.count; const tb = typeBreakdown(ms); types[l.id] = tb.text; modes[l.id] = majorityMode(ms); ai[l.id] = ms.some((m) => m.h.aiUnnamed); }
      return { log: g.log, logs, counts, types, modes, ai, from: Math.min(...st0), to: Math.max(...st0), common: mine.filter((m) => nearestPair(g.metas, m).length).length, alts: g.alts.length };
    }));
  };
  useEffect(() => { reload(); }, [st.guest, st.lb.computers, st.guestRev]);
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await importAny(f);
      toast([r.own ? `Přidáno ${r.own} tvých ponorů` : "", ...r.guests.map((x) => `cizí log ${logName(x)} (${x.count} ponorů)`)].filter(Boolean).join(" · ") || "Žádné nové ponory");
      if (r.guests.length > 1) await askSameOwner(r.guests);
      const g = r.guests[0];
      if (g) { await openGuest(g); tab({ t: "home" }); }
    } catch (e) { toast("Soubor se nepodařilo načíst: " + (e as Error).message); }
    finally { setBusy(false); reload(); if (ref.current) ref.current.value = ""; }
  };
  return (
    <>
      <Card title="Logy ostatních">
        <input ref={ref} type="file" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button className="btn primary" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Načítám…" : "Načíst log"}</button>
        <p className="note">Export ze Shearwater Cloudu parťáka. Jde ho poslat i přes WhatsApp nebo Quick Share → myX. Logy se ukládají zvlášť, jsou jen pro čtení, nesynchronizují se a s tvými ponory se nikdy nekombinují. Log ze tvého počítače se pozná a přidá k tvým ponorům. Víc počítačů jednoho člověka spojíš tak, že jim přiřadíš stejného majitele.</p>
        {!groups.length && <p className="muted">Zatím žádné logy ostatních.</p>}
      </Card>
      {groups.map((g) => {
        const open = st.guest?.id === g.log.id, who = ownerName(g.log), multi = g.logs.length > 1;
        return (
          <section key={g.log.id} className={"card logtile" + (open ? " open" : "")}>
            <div className="lt-h"><b>{who || "Nepřiřazený log"}</b>{multi && <span className="pill">{g.logs.length} počítače</span>}{open && <span className="pill info">otevřený</span>}</div>
            <div className="small muted">{g.log.count} ponorů · {fmtDate(g.from)} – {fmtDate(g.to)} · {g.common} společných se mnou{g.alts ? ` · ${g.alts} ponorů se 2 počítači` : ""}</div>
            {g.logs.map((l, k) => (
              <div key={l.id} className="lt-comp">
                <div className="lt-comp-h">
                  <div className="small">{compLabel(l)} · {g.counts[l.id]} ponorů{multi && k === 0 ? " · hlavní" : ""}</div>
                  {g.types[l.id] && <div className="small muted">{g.types[l.id]}</div>}
                  <button className={"btn small act" + (actFor === l.id ? " on" : "")} disabled={moving === l.id} onClick={() => setActFor(actFor === l.id ? null : l.id)}>{moving === l.id ? "Přesouvám…" : "Akce ▾"}</button>
                </div>
                {actFor === l.id && <div className="actmenu">
                  {l.serial && <button onClick={() => { setActFor(null); setOwnerFor(ownerFor === l.id ? null : l.id); }}>{ownerName(l) ? "Změnit majitele" : "Přiřadit majitele"}</button>}
                  {multi && k > 0 && l.serial && <button onClick={() => { setActFor(null); setPrimaryComputer(l.serial!); }}>Nastavit jako hlavní</button>}
                  <button onClick={async () => {
                    setActFor(null);
                    if (!await ask(`Počítač ${compLabel(l)} je tvůj (např. po výměně počítače)?\n\nJeho ${g.counts[l.id]} ponorů se přesune k tvým ponorům, převezmou se lokality a parťáci z jeho Cloudu a cizí log zmizí. Odebrat ho jde později v DB → Můj log → Akce.`)) return;
                    setMoving(l.id);
                    try { toast(`Přesunuto k tvým ponorům: ${await adoptGuestAsOwn(l)}`); } catch (e) { toast((e as Error).message); }
                    finally { setMoving(null); }
                    reload();
                  }}>To je můj počítač</button>
                  {l.serial && <button onClick={() => { setActFor(null); editRig(parseInt(l.serial!, 16), g.modes[l.id]); }}>Přístroj: {rigLabel(parseInt(l.serial, 16))}</button>}
                  {l.serial && g.ai[l.id] && <button onClick={() => { setActFor(null); editAi(parseInt(l.serial!, 16)); }}>Vysílače: {aiLabel(parseInt(l.serial, 16))}</button>}
                  <button className="danger" onClick={async () => { setActFor(null); if (await ask(`Smazat log počítače ${compLabel(l)}?`, { danger: true })) { await deleteGuest(l); reload(); } }}>Smazat</button>
                </div>}
                {ownerFor === l.id && <div><OwnerPicker log={l} onDone={() => { setOwnerFor(null); reload(); }} />
                  {ownerName(l) && <button className="btn small" onClick={async () => { await setComputerOwner(l, null); setOwnerFor(null); reload(); }}>Zrušit přiřazení majitele{multi ? " (odpojit počítač)" : ""}</button>}</div>}
              </div>
            ))}
            <div className="row">
              {open ? <button className="btn primary" onClick={() => closeGuest()}>Zavřít</button>
                : <button className="btn primary" onClick={async () => { await openGuest(g.log); tab({ t: "home" }); }}>Otevřít (jen čtení)</button>}
              {IS_DEV && <button className="btn" onClick={async () => { await openTempOwn(g.log); tab({ t: "home" }); }}>Jako můj (dočasně)</button>}
              {g.common ? <button className="btn" onClick={() => tab({ t: "hub", sub: "cmp", who: who || logName(g.log) })}>Srovnání</button> : null}
            </div>
          </section>
        );
      })}
    </>
  );
}


/** Záloha: interval připomínky, poslední záloha, zálohovat teď (uložit / sdílet). */
function BackupBox() {
  const st = useStore();
  const [last, setLast] = useState(lastBackup());
  const go2 = async (how: "share" | "save") => { try { if (await doBackup(how)) { setLast(lastBackup()); toast("Záloha vytvořena"); } } catch (e) { toast((e as Error).message); } };
  return (<>
    <p className="note">Záloha obsahuje všechna tvoje data: ponory, lokality, parťáky, poznámky, Výstroj, čidla, baterie, nastavení i logy ostatních. Obnova ze zálohy data sloučí – nic nepřepíše.</p>
    <KV rows={[["Poslední záloha", last ? new Date(last).toLocaleDateString(LOC) : "zatím žádná"]]} />
    <label>Připomínat zálohu<select value={st.lb.settings.backupEvery || "month"} onChange={(e) => saveSettings({ backupEvery: e.target.value as Settings["backupEvery"] })}>
      <option value="week">každý týden</option><option value="month">každý měsíc</option><option value="off">vypnuto</option>
    </select></label>
    <div className="row"><button className="btn" onClick={() => go2("save")}>Stáhnout zálohu</button><button className="btn" onClick={() => go2("share")}>Sdílet zálohu…</button></div>
  </>);
}

/** Anonymní počítadlo spuštění – jen pro vlastníka (s klíčem synchronizace). */
function StatsSec() {
  const [d, setD] = useState<Record<string, Record<string, number>> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetchStats().then(setD).catch((e) => setErr((e as Error).message)); }, []);
  const days = d ? Object.keys(d).sort().reverse() : [];
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const byCc: Record<string, number> = {};
  for (const x of days) for (const [cc, n] of Object.entries(d![x])) byCc[cc] = (byCc[cc] || 0) + n;
  const total = Object.values(byCc).reduce((a, b) => a + b, 0);
  return (
    <Sec title="Přístupy">
      {err ? <p className="c-warn small">{err}</p> : !d ? <p className="muted small">Načítám…</p> : !days.length ? <p className="muted small">Zatím žádné přístupy.</p> : <>
        <p>Celkem <b>{total}</b> spuštění · posledních 7 dní <b>{days.slice(0, 7).reduce((a, x) => a + sum(d![x]), 0)}</b></p>
        <table className="stats-t"><tbody>{Object.entries(byCc).sort((a, b) => b[1] - a[1]).map(([cc, n]) => <tr key={cc}><td data-noi18n>{cc}</td><td>{n}</td></tr>)}</tbody></table>
        <h3 className="subh">Po dnech</h3>
        <table className="stats-t"><tbody>{days.slice(0, 14).map((x) => <tr key={x}><td data-noi18n>{new Date(x).toLocaleDateString(LOC)}</td><td data-noi18n>{Object.entries(d![x]).map(([cc, n]) => `${cc} ${n}`).join(" · ")}</td><td>{sum(d![x])}</td></tr>)}</tbody></table>
      </>}
      <p className="note">Anonymní počet spuštění produkční verze (každé zařízení nejvýš jednou denně) podle země. Neukládá se IP adresa ani žádný identifikátor. Vidíš jen ty – karta se ukáže jen s klíčem synchronizace.</p>
    </Sec>
  );
}

/** Přepnutí mezi běžnou (produkční) a dev verzí. Dev verze běží na …/dev/, bez synchronizace, na vlastní kopii dat. */
function DevSec() {
  const [copied, setCopied] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { devCopiedAt().then(setCopied); }, []);
  const base = location.pathname.replace(/\/dev(\/.*)?$/, "/").replace(/[^/]*$/, "");
  const goTo = (dev: boolean) => { location.href = base + (dev ? "dev/" : ""); };
  return (
    <Sec title="Dev">
      <label className="inline dev-sw"><input type="checkbox" checked={IS_DEV} onChange={(e) => goTo(e.target.checked)} /> Dev verze {IS_DEV ? "ON" : "OFF"}</label>
      <p className="note">Dev verze je testovací a může obsahovat chyby. Pracuje na vlastní kopii tvých dat (bez synchronizace). Změny v ní se do běžné verze nepřenesou.</p>
      {IS_DEV && <>
        <p className="note">Poslední sync z produkce: {copied ? new Date(copied).toLocaleString(LOC) : "–"}</p>
        <button className="btn primary" disabled={busy} onClick={async () => {
          if (!await ask("Sync z produkce: data dev verze se nahradí aktuální kopií dat z běžné (produkční) verze – tvůj log, poznámky, lokality, parťáci, nastavení, Výstroj i logy ostatních. Všechno, co jsi změnil jen v dev verzi, se ztratí. Produkce se jen čte, nic se v ní nezmění.", { ok: "Sync z produkce", danger: true })) return;
          setBusy(true); toast("Kopíruji data z produkce…");
          await copyProdToDev(); location.reload(); // po načtení se přepočítají souhrny ponorů, on-board lahve i stav výbavy
        }}>{busy ? "Kopíruji…" : "Sync z produkce"}</button>
        <p className="note">Po syncu se aplikace znovu načte a přepočítá souhrny všech ponorů aktuální verzí analýzy (i u logů ostatních při otevření), on-board lahve z posledního ponoru a stav čidel, scrubberu, baterií a upozornění.</p>
      </>}
    </Sec>
  );
}

/** Typ přístroje u počítače (zápis do mého logbooku). */
function rigLabel(serial: number): string {
  const c = ownLb().computers?.[serial.toString(16).toUpperCase()];
  return c?.rig ? `${c.rig}${c.supplyO2 ? `, ${c.supplyO2} % O₂` : ""}${c.rig === "pSCR" ? `, 1:${c.pscrRatio ?? 8}` : ""}` : "výchozí";
}
/** Převládající mód ponorů počítače. */
function majorityMode(ms: { h: { mode: string } }[]): string {
  const by = new Map<string, number>(); for (const m of ms) by.set(m.h.mode, (by.get(m.h.mode) || 0) + 1);
  return [...by].sort((a, b) => b[1] - a[1])[0]?.[0] || "CCR";
}
/** Má počítač ponory s nepojmenovanými vysílači tlaku? */
const aiUnnamed = (serial: number) => [...ownMetas(), ...ownHidden()].some((m) => m.h.serial === serial && m.h.aiUnnamed);
function aiLabel(serial: number): string {
  const v = computerCfg(serial)?.aiDil;
  return v ? `diluent ${v}, O₂ ${v === "T1" ? "T2" : "T1"}` : "nenastaveno";
}
/** Model rebreatheru u počítače – určuje počet, typ a funkci baterií v hlavě. */
async function editCcr(serial: number) {
  const cur = ccrModel(computerCfg(serial)?.ccr).id;
  const k = await choose("Model rebreatheru (podle něj se evidují baterie v hlavě – počet, typ a co napájí):", CCR_MODELS.map((m) => ({
    key: m.id, label: `${m.label}${m.bats.length ? ` – ${m.bats.length}× ${m.bats[0].type || "baterie (?)"}` : " – bez baterií"}`, primary: m.id === cur,
  })));
  if (!k) return;
  await setComputerRig(serial, { ccr: k as CcrModel });
  toast(`Rebreather: ${ccrModel(k as CcrModel).label}`);
}
async function editAi(serial: number) {
  const cur = computerCfg(serial)?.aiDil;
  const k = await choose("Vysílače tlaku nemají v počítači jméno (T1/T2), takže z logu nejde poznat, který je na diluentu a který na kyslíku. Který vysílač je na diluentu?", [
    { key: "T1", label: "T1 = diluent, T2 = O₂", primary: cur === "T1" },
    { key: "T2", label: "T2 = diluent, T1 = O₂", primary: cur === "T2" },
    { key: "none", label: "Nepoužívat tlaky z vysílačů", primary: !cur },
  ]);
  if (!k) return;
  await setAiDil(serial, k === "none" ? null : (k as "T1" | "T2"));
  toast("Ponory počítače přepočítány");
}
async function editRig(serial: number, mode: string) {
  const c = ownLb().computers?.[serial.toString(16).toUpperCase()];
  const k = await choose(`Typ přístroje pro ponory v módu ${mode} z tohoto počítače (převládající mód; ponory v jiném módu se řídí svým módem, u jednotlivého ponoru jde změnit v detailu). Zašedlé typy zatím neumíme vyhodnotit – jejich ponory se nezobrazují.`, rigChoices(c?.rig, mode));
  if (!k) return;
  const patch: { rig: Rig; supplyO2?: number; pscrRatio?: number } = { rig: k as Rig };
  if (k === "pSCR" || k === "OC" || k === "aSCR") {
    const v = await askText("Zásobní plyn – O₂ % (v Gauge módu ho počítač nezná; prázdné = podle logu)", c?.supplyO2 ? String(c.supplyO2) : "");
    if (v != null && v.trim()) patch.supplyO2 = Math.min(100, Math.max(5, Math.round(+v.replace(",", ".")) || 21));
  }
  if (k === "pSCR") {
    const v = await askText("Poměr dávkování pSCR 1 : N – zadej N (Tres Presidentes: 8 – předpoklad)", String(c?.pscrRatio ?? 8));
    if (v != null && +v.replace(",", ".") > 1) patch.pscrRatio = +v.replace(",", ".");
  }
  await setComputerRig(serial, patch);
}
