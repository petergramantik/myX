// Lokální úložiště v telefonu (IndexedDB): surové ponory, souhrny a logbook.
// „myx“ = vlastní data, „myx-guest“ = cizí logy jen k prohlížení (stejné úložiště, nikdy se nesynchronizují)
const dbps = new Map<string, Promise<IDBDatabase>>();
export const GUEST = "myx-guest";

function open(name = "myx"): Promise<IDBDatabase> {
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
