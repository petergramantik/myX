import { useEffect, useRef, useState } from "react";
import { scrubberFill } from "../core/analysis";
import { DEFAULT_ALL_TH } from "../app/model";
import { OwnerPicker } from "./Owner";
import { closeGuest, deleteGuest, ownerName, setComputerOwner, exportBackup, guestLogs, guestIndexLoad, importAny, importBackup, nearestPair, openGuest, ownMetas, saveSettings, syncNow, toast, wipeLocal, resetAll, type GuestLog } from "../app/store";
import { setWorker, syncKey, workerUrl } from "../app/config";
import { APP_VERSION, RELEASES } from "../app/version";
import { Card, KV, fmtDate, go, tab, useStore } from "./common";
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
        <label>Datum náplně scrubberu (jinak podle počítadla{fill ? `: ${fmtDate(fill.start)}` : ""})
          <input type="date" value={manual ? new Date(manual * 1000).toISOString().slice(0, 10) : ""} onChange={(e) => saveSettings({ manualFill: e.target.value ? Date.parse(e.target.value + "T12:00:00Z") / 1000 : null })} />
        </label>
      </Sec>

      <Sec title="Logy buddyů">
        <p className="note">Cizí logy (jen ke čtení) se načítají a spravují v záložce DB.</p>
        <button className="btn" onClick={() => tab({ t: "hub", sub: "db" })}>Spravovat logy buddyů ›</button>
      </Sec>

      <Sec title="Sdílení"><ShareInner /></Sec>

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
          <label>pN₂ – zvýraznit nad (bar; END ≈ {Math.round(((th.pn2Hot ?? 3.16) / 0.79 - 1) * 10)} m)<input inputMode="decimal" defaultValue={th.pn2Hot ?? 3.16} onBlur={(e) => setTh("pn2Hot", e.target.value)} /></label>
        <h3 className="subh">CO₂</h3>
          <label>Podezřelé maximum (mbar)<input inputMode="decimal" defaultValue={th.co2Mbar ?? 5} onBlur={(e) => setTh("co2Mbar", e.target.value)} /></label>
        <h3 className="subh">Setpoint</h3>
          <label>Pozdní přepnutí na vysoký: víc než (min) po dosažení dna<input inputMode="decimal" defaultValue={th.spLateMin ?? 5} onBlur={(e) => { const n = parseFloat(e.target.value.replace(",", ".")); if (!Number.isNaN(n)) saveSettings({ th: { ...th, spLateMin: n }, spLateSet: true }); }} /></label>
          <label>Oscilace hloubky na dně (m)<input inputMode="decimal" defaultValue={th.spOsc ?? 3} onBlur={(e) => setTh("spOsc", e.target.value)} /></label>
          <label>Výraznější klesání s vysokým SP (m)<input inputMode="decimal" defaultValue={th.spDescM ?? 6} onBlur={(e) => setTh("spDescM", e.target.value)} /></label>
        <h3 className="subh">Srovnání</h3>
          <label>Pod setpointem o víc než (bar)<input inputMode="decimal" defaultValue={th.spBelow ?? 0.15} onBlur={(e) => setTh("spBelow", e.target.value)} /></label>
          <label>Nad setpointem o víc než (bar, mimo deko)<input inputMode="decimal" defaultValue={th.spAbove ?? 0.2} onBlur={(e) => setTh("spAbove", e.target.value)} /></label>
        <h3 className="subh">Scrubber</h3>
          <label>Upozornit při zbytku (%)<input inputMode="decimal" defaultValue={th.scrubPct ?? 50} onBlur={(e) => setTh("scrubPct", e.target.value)} /></label>
          <label>Upozornit po dnech od náplně<input inputMode="decimal" defaultValue={th.scrubDays ?? 14} onBlur={(e) => setTh("scrubDays", e.target.value)} /></label>
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
            if (!confirm("Úplný reset logbooku: smaže všechny lokality, buddye, poznámky, hodnocení, rozpracované ponory, přiřazení jmen a cizí logy. Ponory, čidla, baterie a nastavení zůstanou. Pokračovat?")) return;
            if (!confirm("Opravdu? Před resetem se stáhne záloha do souboru.")) return;
            const b = await exportBackup();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(b); a.download = `myx-pred-resetem-${new Date().toISOString().slice(0, 10)}.json`; a.click();
            await resetAll(); toast("Logbook resetován");
          }}>Reset logbooku</button>
          <button className="btn danger" onClick={async () => { if (confirm("Smazat všechna data v tomto telefonu?")) { await wipeLocal(); toast("Smazáno"); } }}>Smazat data v telefonu</button>
        </div>
      </Sec>

      <Sec title="O aplikaci" open>
        <KV rows={[["Verze", <a onClick={() => go({ t: "about" })}>{APP_VERSION} – co je nového ›</a>], ["Ponorů v telefonu", st.metas.length]]} />
        <button className="btn" onClick={() => go({ t: "help" })}>Nápověda ›</button>
      </Sec>

      <Sec title="Dev">
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
      <p className="note">Každý má svá data jen ve svém zařízení. Svůj log pošleš buddymu v záložce DB → Sdílet můj log.</p>
    </>
  );
}

/** Cizí logy: jen k prohlížení, uložené zvlášť, bez synchronizace. */
export function GuestCard() {
  const st = useStore();
  const [logs, setLogs] = useState<GuestLog[]>([]);
  const [info, setInfo] = useState<Record<string, { from: number; to: number; common: number }>>({});
  const [busy, setBusy] = useState(false);
  const [ownerFor, setOwnerFor] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const reload = async () => {
    setLogs(await guestLogs());
    const ix = await guestIndexLoad(), mine = ownMetas(), out: typeof info = {};
    for (const { log, metas } of ix) {
      const st0 = metas.map((m) => m.start);
      out[log.id] = { from: Math.min(...st0), to: Math.max(...st0), common: mine.filter((m) => nearestPair(metas, m).length).length };
    }
    setInfo(out);
  };
  useEffect(() => { reload(); }, [st.guest, st.lb.computers]);
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await importAny(f);
      const g = r.guests[0];
      toast([r.own ? `Přidáno ${r.own} tvých ponorů` : "", ...r.guests.map((x) => `cizí log ${ownerName(x) || x.name} (${x.count} ponorů)`)].filter(Boolean).join(" · ") || "Žádné nové ponory");
      if (g) { await openGuest(g); go({ t: "home" }); }
    } catch (e) { toast("Soubor se nepodařilo načíst: " + (e as Error).message); }
    finally { setBusy(false); reload(); if (ref.current) ref.current.value = ""; }
  };
  return (
    <>
      <Card title="Logy buddyů">
        <input ref={ref} type="file" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button className="btn primary" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Načítám…" : "Načíst log buddyho"}</button>
        <p className="note">Export Shearwater Cloud buddyho. Jde ho poslat i přes WhatsApp nebo Quick Share → myX. Logy se ukládají zvlášť, jsou jen pro čtení, nesynchronizují se a s tvými ponory se nikdy nekombinují. Log ze tvého počítače se pozná a přidá k tvým ponorům.</p>
        {!logs.length && <p className="muted">Zatím žádné logy buddyů.</p>}
      </Card>
      {logs.map((l) => {
        const i = info[l.id], open = st.guest?.id === l.id, who = ownerName(l);
        return (
          <section key={l.id} className={"card logtile" + (open ? " open" : "")}>
            <div className="lt-h"><b>{who || "Nepřiřazený log"}</b>{open && <span className="pill info">otevřený</span>}</div>
            <div className="small">{l.model || "Počítač"}{l.serial ? ` ${l.serial}` : ""}</div>
            <div className="small muted">{l.count} ponorů{i ? ` · ${fmtDate(i.from)} – ${fmtDate(i.to)}` : ""}{i ? ` · ${i.common} společných se mnou` : ""}</div>
            <div className="small muted">Načteno {new Date(l.added).toLocaleDateString("cs-CZ")}</div>
            <div className="row">
              {open ? <button className="btn primary" onClick={() => closeGuest()}>Zavřít</button>
                : <button className="btn primary" onClick={async () => { await openGuest(l); go({ t: "home" }); }}>Otevřít (jen čtení)</button>}
              {i?.common ? <button className="btn" onClick={() => tab({ t: "hub", sub: "cmp", who: who || l.name })}>Srovnání</button> : null}
              {l.serial && <button className="btn" onClick={() => setOwnerFor(ownerFor === l.id ? null : l.id)}>Majitel</button>}
              <button className="btn" onClick={async () => { if (confirm(`Smazat log ${who || l.name}?`)) { await deleteGuest(l); reload(); } }}>Smazat</button>
            </div>
            {ownerFor === l.id && <div><OwnerPicker log={l} onDone={() => { setOwnerFor(null); reload(); }} />
              {who && <button className="btn small" onClick={async () => { await setComputerOwner(l, null); setOwnerFor(null); reload(); }}>Zrušit přiřazení</button>}</div>}
          </section>
        );
      })}
    </>
  );
}
