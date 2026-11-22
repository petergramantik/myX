// Tlačítko „Stáhnout z počítače“ – stažení nových ponorů ze Shearwater přes Bluetooth (Chrome na Androidu).
import { useRef, useState } from "react";
import { bleDownload, bleSupported, type BleProgress } from "../app/ble";
import { downloadPlan, saveDownloaded, toast, type DownloadPlan } from "../app/store";
import { useStore } from "./common";

export function BleDownload() {
  const st = useStore();
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<BleProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const stop = useRef(false);
  if (!bleSupported() || st.guest || st.temp) return null;
  const add = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString("cs-CZ")} ${s}`]);
  const run = async () => {
    setBusy(true); setErr(null); setLog([]); setProg(null);
    let lock: { release: () => Promise<void> } | null = null;
    try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* displej může zhasnout */ }
    let n = 0, dest: DownloadPlan | null = null;
    stop.current = false;
    try {
      const r = await bleDownload(async (serial, model, total) => { dest = await downloadPlan(serial, model, total); return dest; },
        async (raw) => { if (dest) n += await saveDownloaded(dest, [raw]); }, setProg, add, () => stop.current);
      const where = dest ? (dest as DownloadPlan).label : "";
      add(`Uloženo ${n} z ${r.saved} stažených${where ? ` (${where})` : ""}${r.cancelled ? " – ukončeno" : ""}`);
      if (!r.cancelled || n) toast(n ? `Staženo z počítače: ${n} ${n === 1 ? "ponor" : n < 5 ? "ponory" : "ponorů"}${dest && !(dest as DownloadPlan).mine ? ` do ${(dest as DownloadPlan).label}` : ""}` : `Žádné nové ponory (v počítači ${r.listed})`);
      setProg(null);
    } catch (e) {
      const m = (e as Error).message || String(e);
      if (/cancel|chosen/i.test(m) && !n) { setProg(null); return; }
      setErr(m + (n ? ` – ${n} ${n === 1 ? "ponor je" : "ponorů je"} uloženo, zbytek stáhneš dalším pokusem` : "")); add("Chyba: " + m);
    } finally { setBusy(false); lock?.release().catch(() => {}); }
  };
  return (
    <div className="ble">
      {busy ? <button className="btn danger" disabled={stop.current} onClick={() => { stop.current = true; setProg({ phase: "Dokončuji ponor, pak skončím…" }); }}>{stop.current ? "Dokončuji ponor…" : "Ukončit stahování"}</button>
        : <button className="btn primary" onClick={run}>Stáhnout z počítače (Bluetooth)</button>}
      {!busy && !err && !log.length && <p className="note">Na Petrelu otevři Upload log (Bluetooth), pak klepni a vyber počítač. Petrel 2 přes prohlížeč nejde – použij aplikaci <a href="https://github.com/petergramantik/myX/releases" target="_blank" rel="noreferrer">myX Petrel</a> a na konci vyber Sdílet → myX (nebo soubor načti tlačítkem Importovat).</p>}
      {busy && prog && <p className="muted small">{prog.phase}{prog.of ? ` ${prog.dive}/${prog.of}` : ""}{prog.bytes ? ` · ${Math.round(prog.bytes / 1024)} kB` : ""}</p>}
      {err && <p className="c-bad small">{err}</p>}
      {log.length > 0 && !busy && (
        <details className="ble-log"><summary>Ladicí výpis ({log.length})</summary>
          <pre>{log.join("\n")}</pre>
          <button className="btn small" onClick={() => navigator.clipboard?.writeText(log.join("\n")).then(() => toast("Zkopírováno"))}>Zkopírovat výpis</button>
        </details>
      )}
    </div>
  );
}
