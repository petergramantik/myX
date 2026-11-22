import { ask, askText } from "../app/dialog";
import { deleteDraft, draftCandidates, linkDraft, locate, moveDraft, myNum, toast, updateDraft } from "../app/store";
import { Card, back, fmtDate, fmtDateTime, num, useStore } from "./common";
import { NoteEditor } from "./NoteEditor";

export function DraftScreen({ id }: { id: string }) {
  const st = useStore();
  const dr = st.lb.drafts[id];
  if (!dr) return <div className="screen"><p className="muted">Ponor už byl spárován s daty z počítače nebo smazán.</p></div>;
  const cands = draftCandidates(dr);
  const sameDay = st.metas.filter((m) => fmtDate(m.start) === fmtDate(dr.created) && !cands.includes(m));
  return (
    <div className="screen">
      <p className="muted center">Založeno {fmtDateTime(dr.created)}{dr.lat != null ? ` · poloha ${dr.lat.toFixed(4)}, ${dr.lon!.toFixed(4)}` : " · bez polohy"}</p>
      <div className="center"><button className="btn small" onClick={async () => { const p = await locate(true); if (p) { await moveDraft(id, p, true); toast("Poloha a počasí aktualizovány"); } else toast("Polohu se nepodařilo zjistit"); }}>Aktualizovat polohu a počasí</button></div>
      <NoteEditor note={dr} pos={{ lat: dr.lat, lon: dr.lon }} onChange={(p) => updateDraft(id, p)} />
      <Card title="Data z počítače">
        {cands.length === 0 && sameDay.length === 0 && <p className="muted">Po importu logu se ponor spáruje automaticky podle času (začátek ponoru 3 h před až 48 h po založení; když se najde víc ponorů, vybereš sám).</p>}
        {cands.length > 1 && <p>Časově odpovídá víc ponorů – vyber, ke kterému patří:</p>}
        {[...cands, ...sameDay].map((m) => (
          <button key={m.id} className="btn block" onClick={async () => { await linkDraft(id, m.id); back(); }}>
            Ponor č. {myNum(m.id)} · {fmtDateTime(m.start)} · {num(m.h.maxDepth)} m · {Math.round(m.h.diveTimeS / 60)} min
          </button>
        ))}
      </Card>
      <button className="btn danger" onClick={async () => { if (await ask("Smazat rozpracovaný ponor?")) { await deleteDraft(id); back(); } }}>Smazat</button>
    </div>
  );
}
