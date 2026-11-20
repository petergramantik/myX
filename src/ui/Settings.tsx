import { ask, askText, choose } from "../app/dialog";
import { AliasCard } from "./Sites";
import { useEffect, useRef, useState } from "react";
import { scrubberFill } from "../core/analysis";
import { DEFAULT_ALL_TH } from "../app/model";
import { OwnerPicker } from "./Owner";
import { ME, closeGuest, compLabel, deleteGuest, guestRawIndex, logName, ownerName, setComputerOwner, setPrimaryComputer, askSameOwner, adoptGuestAsOwn, ownComputers, removeOwnComputer, exportBackup, guestLogs, guestIndexLoad, importAny, importBackup, nearestPair, openGuest, ownMetas, saveSettings, syncNow, toast, wipeLocal, resetAll, type GuestLog } from "../app/store";
import { setWorker, syncKey, workerUrl } from "../app/config";
import { APP_VERSION, RELEASES } from "../app/version";
import { IS_DEV, copyProdToDev, devCopiedAt } from "../app/db";
import { openTempOwn, ownLb, rigChoices, setComputerRig } from "../app/store";
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
        <label className="check"><input type="checkbox" checked={st.lb.settings.motto !== false} onChange={(e) => saveSettings({ motto: e.target.checked })} /> Hláška nad scrubberem („Všecko v cajku…“ / „Mám warningy…“)</label>
      </Sec>

      <Sec title="Výbava">
        <label>Diluent – objem onboard lahve (l)<input inputMode="decimal" defaultValue={st.lb.settings.cyl?.dil ?? 3} onBlur={(e) => { const v = parseFloat(e.target.value.replace(",", ".")); if (v > 0) saveSettings({ cyl: { dil: v, o2: st.lb.settings.cyl?.o2 ?? 3 } }); }} /></label>
        <label>O₂ – objem onboard lahve (l)<input inputMode="decimal" defaultValue={st.lb.settings.cyl?.o2 ?? 3} onBlur={(e) => { const v = parseFloat(e.target.value.replace(",", ".")); if (v > 0) saveSettings({ cyl: { dil: st.lb.settings.cyl?.dil ?? 3, o2: v } }); }} /></label>
        <p className="note">Externí lahve (S80 = 11,1 l, S40 = 5,7 l) se zadávají u ponoru v kartě Spotřeba plynu.</p>
        <label>Spojit záznamy s povrchovým intervalem do (minuty, 0 = vypnuto)<input inputMode="decimal" defaultValue={st.lb.settings.segGap ?? 30} onBlur={(e) => { const v = parseFloat(e.target.value.replace(",", ".")); if (v >= 0) saveSettings({ segGap: v }); }} /></label>
        <p className="note">Víc záznamů počítače jako jeden ponor (bazén, krátký suchý přechod). Záznamy se stejným číslem ponoru v Shearwater Cloudu se spojují vždy; v detailu ponoru jdou části ručně oddělit nebo spojit.</p>
        <OwnComputers />
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
        <label>Moje jméno ve sdíleném srovnání (místo „Já“)<input defaultValue={st.lb.settings.myName || ""} placeholder="např. Peter" onBlur={(e) => saveSettings({ myName: e.target.value.trim() || undefined })} /></label>
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
          <button className="btn" onClick={async () => {
            const b = await exportBackup();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(b); a.download = `myx-zaloha-${new Date().toISOString().slice(0, 10)}.json`; a.click();
          }}>Stáhnout zálohu</button>
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

      <Sec title="O aplikaci" open>
        <KV rows={[["Verze", <a onClick={() => go({ t: "about" })}>{APP_VERSION} – co je nového ›</a>], ["Ponorů v telefonu", st.metas.length]]} />
        <button className="btn" onClick={() => go({ t: "help" })}>Nápověda ›</button>
      </Sec>

      <DevSec />

      <Sec title="Synchronizace">
        <p className="note">Vývojářská funkce: synchronizace a záloha přes vlastní Cloudflare Worker.</p>
        <p className={"sync " + st.sync.state}>{st.sync.msg || "–"}{st.sync.at ? ` (${new Date(st.sync.at).toLocaleTimeString("cs-CZ")})` : ""}</p>
        <label>Adresa Workeru<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://myx-sync.….workers.dev" /></label>
        <label>Klíč<input value={key} type="password" onChange={(e) => setKey(e.target.value)} /></label>
        <div className="row">
          <button className="btn primary" onClick={() => { setWorker(url, key); syncNow(); }}>Uložit a synchronizovat</button>
        </div>
      </Sec>
    </div>
  );
}

/** Moje počítače (víc po výměně počítače); odebrání vrátí ponory zpět mimo můj logbook. */
function OwnComputers() {
  useStore();
  const cs = ownComputers();
  if (!cs.length) return null;
  return (
    <div className="own-comps">
      <h3 className="subh">Moje počítače</h3>
      {cs.map((c) => (
        <div key={c.serial} className="row between">
          <span className="small">{c.model} {c.serial} · {c.count} ponorů · {fmtDate(c.from)} – {fmtDate(c.to)} · přístroj {rigLabel(parseInt(c.serial, 16))}</span>
          <button className="btn small" onClick={() => editRig(parseInt(c.serial, 16))}>Přístroj</button>
          {cs.length > 1 && <button className="btn small" onClick={async () => { if (await ask(`Odebrat počítač ${c.serial} z tvých? Jeho ${c.count} ponorů se smaže z tvého logbooku (i s poznámkami). Znovu ho můžeš načíst jako cizí log a přidat přes „To je můj počítač“.`)) toast(`Odebráno ponorů: ${await removeOwnComputer(c.serial)}`); }}>Odebrat</button>}
        </div>
      ))}
      <p className="note">Další svůj počítač přidáš v DB → Databáze u jeho logu volbou „To je můj počítač“, nebo při prvním importu.</p>
    </div>
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
      {RELEASES.map((r) => (
        <Card key={r.version} title={`${r.version} – ${r.title}`}>
          <p className="muted">{r.date}</p>
          <ul>{r.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Card>
      ))}
    </div>
  );
}

export const APP_URL = "https://petergramantik.github.io/myX/";

/** Sdílení aplikace: systémové sdílení (nebo zkopírování odkazu) a QR kód. */
function ShareInner() {
  const share = async () => {
    const data = { title: "myX", text: "myX – logbook pro rebreather, import ze Shearwater Cloud", url: APP_URL };
    try {
      if (navigator.share) { await navigator.share(data); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    try { await navigator.clipboard.writeText(APP_URL); toast("Odkaz zkopírován do schránky"); }
    catch { toast(APP_URL); }
  };
  return (
    <>
      <button className="btn primary" onClick={share}>Sdílet aplikaci</button>
      <img className="qr" src="qr.svg" alt={"QR kód: " + APP_URL} width={180} height={180} />
      <p className="center small"><a href={APP_URL}>{APP_URL.replace("https://", "")}</a></p>
      <p className="note">Každý má svá data jen ve svém zařízení. Svůj log pošleš parťákovi v záložce DB → Sdílet můj log.</p>
    </>
  );
}

/** Cizí logy: jen k prohlížení, uložené zvlášť, bez synchronizace. */
export function GuestCard() {
  const st = useStore();
  const [groups, setGroups] = useState<{ log: GuestLog; logs: GuestLog[]; counts: Record<string, number>; from: number; to: number; common: number; alts: number }[]>([]);
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
      const counts: Record<string, number> = {}; for (const l of logs) counts[l.id] = raw.find((x) => x.log.id === l.id)?.metas.length ?? l.count;
      return { log: g.log, logs, counts, from: Math.min(...st0), to: Math.max(...st0), common: mine.filter((m) => nearestPair(g.metas, m).length).length, alts: g.alts.length };
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
                  <button className={"btn small act" + (actFor === l.id ? " on" : "")} disabled={moving === l.id} onClick={() => setActFor(actFor === l.id ? null : l.id)}>{moving === l.id ? "Přesouvám…" : "Akce ▾"}</button>
                </div>
                {actFor === l.id && <div className="actmenu">
                  {l.serial && <button onClick={() => { setActFor(null); setOwnerFor(ownerFor === l.id ? null : l.id); }}>{ownerName(l) ? "Změnit majitele" : "Přiřadit majitele"}</button>}
                  {multi && k > 0 && l.serial && <button onClick={() => { setActFor(null); setPrimaryComputer(l.serial!); }}>Nastavit jako hlavní</button>}
                  <button onClick={async () => {
                    setActFor(null);
                    if (!await ask(`Počítač ${compLabel(l)} je tvůj (např. po výměně počítače)?\n\nJeho ${g.counts[l.id]} ponorů se přesune k tvým ponorům, převezmou se lokality a parťáci z jeho Cloudu a cizí log zmizí. Odebrat ho jde později v Nastavení → Výbava.`)) return;
                    setMoving(l.id);
                    try { toast(`Přesunuto k tvým ponorům: ${await adoptGuestAsOwn(l)}`); } catch (e) { toast((e as Error).message); }
                    finally { setMoving(null); }
                    reload();
                  }}>To je můj počítač</button>
                  {l.serial && <button onClick={() => { setActFor(null); editRig(parseInt(l.serial!, 16)); }}>Přístroj: {rigLabel(parseInt(l.serial, 16))}</button>}
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


/** Přepnutí mezi běžnou (produkční) a dev verzí. Dev verze běží na …/dev/, bez synchronizace, na vlastní kopii dat. */
function DevSec() {
  const [copied, setCopied] = useState(0);
  useEffect(() => { devCopiedAt().then(setCopied); }, []);
  const base = location.pathname.replace(/\/dev(\/.*)?$/, "/").replace(/[^/]*$/, "");
  const goTo = (dev: boolean) => { location.href = base + (dev ? "dev/" : ""); };
  return (
    <Sec title="Dev">
      <label className="inline dev-sw"><input type="checkbox" checked={IS_DEV} onChange={(e) => goTo(e.target.checked)} /> Dev verze {IS_DEV ? "ON" : "OFF"}</label>
      <p className="note">Dev verze je testovací a může obsahovat chyby. Pracuje na vlastní kopii tvých dat (bez synchronizace). Změny v ní se do běžné verze nepřenesou.</p>
      {IS_DEV && <>
        <p className="note">Kopie dat z běžné verze: {copied ? new Date(copied).toLocaleString("cs-CZ") : "–"}</p>
        <button className="btn" onClick={async () => {
          if (!await ask("Zahodit data dev verze a znovu zkopírovat aktuální data z běžné verze?")) return;
          await copyProdToDev(); location.reload();
        }}>Obnovit kopii z produkce</button>
      </>}
    </Sec>
  );
}

/** Typ přístroje u počítače (zápis do mého logbooku). */
function rigLabel(serial: number): string {
  const c = ownLb().computers?.[serial.toString(16).toUpperCase()];
  return c?.rig ? `${c.rig}${c.supplyO2 ? `, ${c.supplyO2} % O₂` : ""}${c.rig === "pSCR" ? `, 1:${c.pscrRatio ?? 8}` : ""}` : "výchozí";
}
async function editRig(serial: number) {
  const c = ownLb().computers?.[serial.toString(16).toUpperCase()];
  const k = await choose("Typ dýchacího přístroje pro ponory z tohoto počítače (u jednotlivého ponoru jde změnit v detailu). Zašedlé typy zatím neumíme vyhodnotit.", rigChoices(c?.rig));
  if (!k) return;
  const patch: { rig: Rig; supplyO2?: number; pscrRatio?: number } = { rig: k as Rig };
  if (k !== "eCCR") {
    const v = await askText("Zásobní plyn – O₂ % (v Gauge módu ho počítač nezná; prázdné = podle logu)", c?.supplyO2 ? String(c.supplyO2) : "");
    if (v != null && v.trim()) patch.supplyO2 = Math.min(100, Math.max(5, Math.round(+v.replace(",", ".")) || 21));
  }
  if (k === "pSCR") {
    const v = await askText("Poměr dávkování pSCR 1 : N – zadej N (Tres Presidentes: 8 – předpoklad)", String(c?.pscrRatio ?? 8));
    if (v != null && +v.replace(",", ".") > 1) patch.pscrRatio = +v.replace(",", ".");
  }
  await setComputerRig(serial, patch);
}
