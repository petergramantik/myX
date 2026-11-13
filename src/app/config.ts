// Adresa Workeru (synchronizace + proxy Stran potápěčských) a klíč. Výchozí adresa je v public/config.js.
declare global { interface Window { MYX_WORKER?: string } }

const K_URL = "myx.worker", K_KEY = "myx.key";
const ls = (): Storage | null => { try { return localStorage; } catch { return null; } };

export const workerUrl = (): string => (ls()?.getItem(K_URL) || window.MYX_WORKER || "").replace(/\/+$/, "");
export const syncKey = (): string => ls()?.getItem(K_KEY) || "";
export function setWorker(url: string, key: string) {
  ls()?.setItem(K_URL, url.trim());
  ls()?.setItem(K_KEY, key.trim());
}
