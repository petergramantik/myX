// Pravidelná záloha všech uživatelských dat do souboru (uložit do telefonu nebo sdílet, např. na Google Disk),
// anonymní počítadlo spuštění (produkce, jednou denně) a statistiky pro vlastníka (s klíčem synchronizace).
import { exportBackup } from "./store";
import { IS_DEV } from "./db";
import { syncKey, workerUrl } from "./config";
import type { Settings } from "./model";

const K_LAST = "myx-lastbak", K_HIT = "myx-hit";
const ls = (): Storage | null => { try { return localStorage; } catch { return null; } };
export const BAK_DAYS: Record<NonNullable<Settings["backupEvery"]>, number> = { off: 0, week: 7, month: 30 };
export const lastBackup = (): number => +(ls()?.getItem(K_LAST) || 0);

/** Je čas na zálohu? (podle intervalu v nastavení; výchozí měsíčně) */
export function backupDue(set: Settings, dives: number): boolean {
  const d = BAK_DAYS[set.backupEvery || "month"];
  if (!d || !dives) return false;
  return Date.now() - lastBackup() > d * 86400000;
}

/** Vytvoří zálohu a nabídne ji: sdílet (Google Disk, mail…) nebo uložit do telefonu. Vrací true po úspěchu. */
export async function doBackup(how: "share" | "save"): Promise<boolean> {
  const blob = await exportBackup(true);
  const name = `myx-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
  const f = new File([blob], name, { type: "application/json" });
  if (how === "share" && navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f], title: name }); }
    catch (e) { if ((e as Error).name === "AbortError") return false; throw e; }
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  ls()?.setItem(K_LAST, String(Date.now()));
  return true;
}

/** Anonymní počítadlo: jen produkce, nejvýš jednou denně; bez jakýchkoli údajů o uživateli. */
export function hitOnce() {
  if (IS_DEV) return;
  const day = new Date().toISOString().slice(0, 10);
  if (ls()?.getItem(K_HIT) === day) return;
  const w = workerUrl();
  if (!w) return;
  ls()?.setItem(K_HIT, day);
  fetch(w + "/hit", { method: "POST", keepalive: true }).catch(() => ls()?.removeItem(K_HIT));
}

/** Statistiky spuštění (jen s klíčem synchronizace). */
export async function fetchStats(): Promise<Record<string, Record<string, number>> | null> {
  const w = workerUrl(), k = syncKey();
  if (!w || !k) return null;
  const r = await fetch(w + "/stats", { headers: { "X-Myx-Key": k } });
  if (!r.ok) throw new Error(`Worker: ${r.status}`);
  return (await r.json()).days || {};
}
