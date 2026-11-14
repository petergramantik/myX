// Lokální úložiště v telefonu (IndexedDB): surové ponory, souhrny a logbook.
const DB = "myx";
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [n, k] of [["raw", "id"], ["meta", "id"], ["kv", null], ["img", "id"]] as const) {
        if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, k ? { keyPath: k } : undefined);
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function getAll<T>(store: string): Promise<T[]> {
  const db = await open();
  return req(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
}
export async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  return req(db.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);
}
export async function put(store: string, value: unknown, key?: string): Promise<void> {
  const db = await open();
  await req(db.transaction(store, "readwrite").objectStore(store).put(value, key));
}
export async function del(store: string, key: string): Promise<void> {
  const db = await open();
  await req(db.transaction(store, "readwrite").objectStore(store).delete(key));
}
export async function clearAll(): Promise<void> {
  const db = await open();
  for (const s of ["raw", "meta", "kv", "img"]) await req(db.transaction(s, "readwrite").objectStore(s).clear());
}
