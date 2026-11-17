import { useEffect, useState } from "react";
import { onDialog, type DialogReq } from "../app/dialog";

/** Zobrazení vlastních dialogů (překryv přes celou aplikaci). */
export function DialogHost() {
  const [d, setD] = useState<DialogReq | null>(null);
  const [v, setV] = useState("");
  useEffect(() => onDialog((x) => { setD(x); setV(x?.input ?? ""); }), []);
  if (!d) return null;
  const ok = () => d.done(d.input != null ? v : true);
  return (
    <div className="dlg-back" onClick={() => d.done(d.input != null ? null : false)}>
      <div className="dlg card" onClick={(e) => e.stopPropagation()}>
        <p className="dlg-msg">{d.msg}</p>
        {d.input != null && <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ok(); }} />}
        <div className="row dlg-btns">
          <button className="btn" onClick={() => d.done(d.input != null ? null : false)}>{d.cancel}</button>
          <button className={"btn " + (d.danger ? "danger" : "primary")} onClick={ok}>{d.ok}</button>
        </div>
      </div>
    </div>
  );
}
