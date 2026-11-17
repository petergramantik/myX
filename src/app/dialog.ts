// Vlastní potvrzovací dialogy (místo systémových confirm/prompt, které prohlížeč může potlačit).
export interface DialogReq { msg: string; ok: string; cancel: string; input?: string; danger?: boolean; done: (v: string | boolean | null) => void }
let cur: DialogReq | null = null;
const queue: DialogReq[] = [];
const subs = new Set<(d: DialogReq | null) => void>();
const emit = () => subs.forEach((f) => f(cur));
function push(r: Omit<DialogReq, "done">): Promise<string | boolean | null> {
  return new Promise((res) => {
    const req: DialogReq = { ...r, done: (v) => { cur = queue.shift() || null; emit(); res(v); } };
    if (cur) queue.push(req); else { cur = req; emit(); }
  });
}
export const onDialog = (f: (d: DialogReq | null) => void) => { subs.add(f); f(cur); return () => { subs.delete(f); }; };
/** Potvrzení ano / ne. */
export const ask = (msg: string, o: { ok?: string; cancel?: string; danger?: boolean } = {}) =>
  push({ msg, ok: o.ok || "OK", cancel: o.cancel || "Zrušit", danger: o.danger ?? /^(Smazat|Odebrat|Úplný reset|Opravdu)/.test(msg) }).then((v) => v === true);
/** Zadání textu (null = zrušeno). */
export const askText = (msg: string, value = "", o: { ok?: string } = {}) =>
  push({ msg, ok: o.ok || "OK", cancel: "Zrušit", input: value }).then((v) => (typeof v === "string" ? v : null));
