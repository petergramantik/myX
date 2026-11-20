// Lokální úložiště v telefonu (IndexedDB): surové ponory, souhrny a logbook.
// „myx“ = vlastní data, „myx-guest“ = cizí logy jen k prohlížení (stejné úložiště, nikdy se nesynchronizují)
const dbps = new Map<string, Promise<IDBDatabase>>();
export const GUEST = "myx-guest";

/** Dev verze (…/myX/dev/) pracuje na vlastní kopii dat („dev-…“), zkopírované z produkce; produkční data nikdy nemění. */
export const IS_DEV = typeof location !== "undefined" && /\/dev(\/|$)/.test(location.pathname);
const DATA_DBS = ["myx", GUEST];

function rawOpen(name: string): Promise<IDBDatabase> {
  const have = dbps.get(name);
  if (have) return have;
  const dbp = new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(name, 3);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [n, k] of [["raw", "id"], ["meta", "id"], ["kv", null]] as const) {
        if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, k ? { keyPath: k } : undefined);
      }
      if (db.objectStoreNames.contains("img")) db.deleteObjectStore("img"); // fotky čidel už aplikace nepoužívá
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  dbps.set(name, dbp);
  return dbp;
}

/** Zkopíruje produkční data (vlastní i cizí logy, nastavení) do úložiště dev verze. Opačným směrem nikdy. */
export async function copyProdToDev(): Promise<void> {
  if (!IS_DEV) return;
  for (const n of DATA_DBS) {
    const src = await rawOpen(n), dst = await rawOpen("dev-" + n);
    for (const store of ["raw", "meta", "kv"]) {
      const rows: { k: IDBValidKey; v: unknown }[] = await new Promise((res, rej) => {
        const out: { k: IDBValidKey; v: unknown }[] = [];
        const c = src.transaction(store).objectStore(store).openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push({ k: cur.key, v: cur.value }); cur.continue(); } else res(out); };
        c.onerror = () => rej(c.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = dst.transaction(store, "readwrite"), os = tx.objectStore(store);
        os.clear();
        for (const r of rows) os.keyPath ? os.put(r.v) : os.put(r.v, r.k);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
      });
    }
  }
  const d = await rawOpen("dev-myx");
  await req(d.transaction("kv", "readwrite").objectStore("kv").put(Date.now(), "devCopiedAt"));
}

let devReady: Promise<void> | null = null;
function open(name = "myx"): Promise<IDBDatabase> {
  if (!IS_DEV) return rawOpen(name);
  devReady ??= (async () => {
    const d = await rawOpen("dev-myx");
    const at = await req(d.transaction("kv").objectStore("kv").get("devCopiedAt"));
    if (!at) await copyProdToDev(); // první spuštění dev verze: kopie dat z produkce
  })();
  return devReady.then(() => rawOpen("dev-" + name));
}
/** Kdy byla dev kopie dat naposledy vytvořena (ms), jen v dev verzi. */
export async function devCopiedAt(): Promise<number> {
  if (!IS_DEV) return 0;
  const d = await open();
  return ((await req(d.transaction("kv").objectStore("kv").get("devCopiedAt"))) as number) || 0;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function getAll<T>(store: string, name?: string): Promise<T[]> {
  const db = await open(name);
  return req(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
}
export async function get<T>(store: string, key: string, name?: string): Promise<T | undefined> {
  const db = await open(name);
  return req(db.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);
}
export async function put(store: string, value: unknown, key?: string, name?: string): Promise<void> {
  const db = await open(name);
  await req(db.transaction(store, "readwrite").objectStore(store).put(value, key));
}
export async function del(store: string, key: string, name?: string): Promise<void> {
  const db = await open(name);
  await req(db.transaction(store, "readwrite").objectStore(store).delete(key));
}
export async function clearAll(): Promise<void> {
  const db = await open();
  for (const s of ["raw", "meta", "kv"]) await req(db.transaction(s, "readwrite").objectStore(s).clear());
}
