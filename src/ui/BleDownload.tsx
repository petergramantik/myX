// Tlačítko „Stáhnout z počítače“ – stažení nových ponorů ze Shearwater přes Bluetooth (Chrome na Androidu).
import { useState } from "react";
import { bleDownload, bleSupported, type BleProgress } from "../app/ble";
import { importBle, knownStarts, toast } from "../app/store";
import { useStore } from "./common";

export function BleDownload() {
  const st = useStore();
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<BleProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  if (!bleSupported() || st.guest || st.temp) return null;
  const add = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString("cs-CZ")} ${s}`]);
  const run = async () => {
    setBusy(true); setErr(null); setLog([]); setProg(null);
    let lock: { release: () => Promise<void> } | null = null;
    try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* displej může zhasnout */ }
    let n = 0;
    try {
      const r = await bleDownload(knownStarts, async (raw) => { n += await importBle([raw]); }, setProg, add);
      add(`Uloženo ${n} z ${r.saved} stažených`);
      toast(n ? `Staženo z počítače: ${n} ${n === 1 ? "ponor" : n < 5 ? "ponory" : "ponorů"}` : `Žádné nové ponory (v počítači ${r.listed})`);
      setProg(null);
    } catch (e) {
      const m = (e as Error).message || String(e);
      if (/cancel|chosen/i.test(m) && !n) { setProg(null); return; }
      setErr(m + (n ? ` – ${n} ${n === 1 ? "ponor je" : "ponorů je"} uloženo, zbytek stáhneš dalším pokusem` : "")); add("Chyba: " + m);
    } finally { setBusy(false); lock?.release().catch(() => {}); }
  };
  return (
    <div className="ble">
      <button className="btn primary" disabled={busy} onClick={run}>{busy ? "Stahuji…" : "Stáhnout z počítače (Bluetooth)"}</button>
      {!busy && !err && !log.length && <p className="note">Na Petrelu otevři Upload log (Bluetooth), pak klepni a vyber počítač.</p>}
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
