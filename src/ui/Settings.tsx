import { useRef, useState } from "react";
import { scrubberFill } from "../core/analysis";
import { DEFAULT_ALL_TH } from "../app/model";
import { exportBackup, importBackup, saveSettings, syncNow, toast, wipeLocal } from "../app/store";
import { setWorker, syncKey, workerUrl } from "../app/config";
import { APP_VERSION, RELEASES } from "../app/version";
import { Card, KV, fmtDate, go, useStore } from "./common";
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
      <Card title="Synchronizace">
        <p className={"sync " + st.sync.state}>{st.sync.msg || "–"}{st.sync.at ? ` (${new Date(st.sync.at).toLocaleTimeString("cs-CZ")})` : ""}</p>
        <label>Adresa Workeru<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://myx-sync.….workers.dev" /></label>
        <label>Klíč<input value={key} type="password" onChange={(e) => setKey(e.target.value)} /></label>
        <div className="row">
          <button className="btn primary" onClick={() => { setWorker(url, key); syncNow(); }}>Uložit a synchronizovat</button>
        </div>
      </Card>

      <Card title="Upozornění">
        <label>Scrubber – upozornit při zbytku (%)<input inputMode="decimal" defaultValue={th.scrubPct} onBlur={(e) => setTh("scrubPct", e.target.value)} /></label>
        <label>Scrubber – upozornit po dnech od náplně<input inputMode="decimal" defaultValue={th.scrubDays} onBlur={(e) => setTh("scrubDays", e.target.value)} /></label>
        <label>Baterie – rezerva nad prahem varování (V)<input inputMode="decimal" defaultValue={th.batMarginV} onBlur={(e) => setTh("batMarginV", e.target.value)} /></label>
        <label>Čidla – životnost, když u čidla není zadaná (měsíce)<input inputMode="decimal" defaultValue={th.cellLifeM} onBlur={(e) => setTh("cellLifeM", e.target.value)} /></label>
        <label>Čidla – výměna nejpozději po (měsíce)<input inputMode="decimal" defaultValue={th.cellMaxM} onBlur={(e) => setTh("cellMaxM", e.target.value)} /></label>
        <label>Čidla – varování pod (mV na vzduchu)<input inputMode="decimal" defaultValue={th.cellAirWarn} onBlur={(e) => setTh("cellAirWarn", e.target.value)} /></label>
        <label>Čidla – výměna pod (mV na vzduchu)<input inputMode="decimal" defaultValue={th.cellAirBad} onBlur={(e) => setTh("cellAirBad", e.target.value)} /></label>
        <label>Čidla – pokles citlivosti za měsíc (%)<input inputMode="decimal" defaultValue={th.cellDropPct} onBlur={(e) => setTh("cellDropPct", e.target.value)} /></label>
        <label>Čidla – linearita pod (current limiting)<input inputMode="decimal" defaultValue={th.cellLinWarn} onBlur={(e) => setTh("cellLinWarn", e.target.value)} /></label>
        <label>CO₂ – podezřelé maximum (mbar)<input inputMode="decimal" defaultValue={th.co2Mbar} onBlur={(e) => setTh("co2Mbar", e.target.value)} /></label>
        <label>Datum náplně scrubberu (jinak podle počítadla{fill ? `: ${fmtDate(fill.start)}` : ""})
          <input type="date" value={manual ? new Date(manual * 1000).toISOString().slice(0, 10) : ""} onChange={(e) => saveSettings({ manualFill: e.target.value ? Date.parse(e.target.value + "T12:00:00Z") / 1000 : null })} />
        </label>
        <button className="btn" onClick={() => saveSettings({ th: { ...DEFAULT_ALL_TH }, manualFill: null })}>Výchozí hodnoty</button>
      </Card>

      <Card title="Data">
        <div className="col">
          <ImportButton />
          <button className="btn" onClick={async () => {
            const b = await exportBackup();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(b); a.download = `myx-zaloha-${new Date().toISOString().slice(0, 10)}.json`; a.click();
          }}>Stáhnout zálohu</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Obnovit ze zálohy</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (f) try { toast(`Obnoveno, nových ponorů: ${await importBackup(f)}`); } catch (err) { toast((err as Error).message); }
          }} />
          <button className="btn danger" onClick={async () => { if (confirm("Smazat všechna data v tomto telefonu? Data ve Workeru zůstanou.")) { await wipeLocal(); toast("Smazáno"); } }}>Smazat data v telefonu</button>
        </div>
      </Card>

      <Card title="O aplikaci">
        <KV rows={[["Verze", <a onClick={() => go({ t: "about" })}>{APP_VERSION} – co je nového ›</a>], ["Ponorů v telefonu", st.metas.length]]} />
      </Card>
    </div>
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
