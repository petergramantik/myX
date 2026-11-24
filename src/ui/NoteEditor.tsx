// Společný editor logbooku (lokalita, buddy, hodnocení, poznámka, počasí) pro ponor i rozpracovaný ponor.
import { useEffect, useState } from "react";
import type { DiveNote } from "../app/model";
import { findBuddyByName, findSiteByName, upsertBuddy, upsertSite } from "../app/store";
import { weatherText } from "../app/weather";
import { PrepCard } from "./Prep";
import { Card, Chip, Picker, RatingPicker, go, num, useStore } from "./common";

export function NoteEditor({ note, onChange, pos, real, cc, diveId }: { note: DiveNote; onChange: (p: Partial<DiveNote>) => void; pos?: { lat?: number; lon?: number }; /** tlaky on-board lahví z počítače (u spárovaného ponoru) */ real?: { dil: number | null; o2: number | null }; cc?: boolean; diveId?: string }) {
  const st = useStore();
  const lb = st.lb;
  const [text, setText] = useState(note.note);
  useEffect(() => setText(note.note), [note.note]);
  const site = note.siteId ? lb.sites[note.siteId] : undefined;
  const siteItems = Object.values(lb.sites).map((s) => ({ id: s.id, name: s.name }));
  const buddyItems = Object.values(lb.buddies).filter((b) => !note.buddyIds.includes(b.id)).map((b) => ({ id: b.id, name: b.name }));
  const w = note.weather;
  // nejčastější lokality a buddy (počet ponorů, při shodě novější použití)
  const top = (pick: (n: DiveNote) => string[]) => {
    const cnt = new Map<string, { n: number; last: number }>();
    for (const n of [...Object.values(lb.notes), ...Object.values(lb.drafts)]) for (const id of pick(n)) {
      const c = cnt.get(id) || { n: 0, last: 0 };
      cnt.set(id, { n: c.n + 1, last: Math.max(c.last, n.updated || 0) });
    }
    return [...cnt].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last).map(([id]) => id);
  };
  const topSites = top((n) => (n.siteId ? [n.siteId] : [])).filter((id) => lb.sites[id]).slice(0, 3);
  const topBuddies = top((n) => n.buddyIds || []).filter((id) => lb.buddies[id] && !note.buddyIds.includes(id)).slice(0, 3);
  return (
    <>
      <Card title="Lokalita">
        {site ? <Chip onClick={() => go({ t: "site", id: site.id })} onX={() => onChange({ siteId: undefined })}>📍 {site.name}</Chip>
          : <Picker items={siteItems} placeholder="Napiš název lokality" onPick={(sid) => onChange({ siteId: sid })}
              onCreate={async (name) => { const s = findSiteByName(name) || (await upsertSite({ name, lat: pos?.lat, lon: pos?.lon })); onChange({ siteId: s.id }); }} />}
        {!site && topSites.length > 0 && <div className="quick">{topSites.map((id) => <button key={id} className="btn small" onClick={() => onChange({ siteId: id })}>{lb.sites[id].name}</button>)}</div>}
      </Card>
      <Card title="S kým">
        <div className="chips">{note.buddyIds.map((b) => lb.buddies[b] && <Chip key={b} onClick={() => go({ t: "buddy", id: b })} onX={() => onChange({ buddyIds: note.buddyIds.filter((x) => x !== b) })}>{lb.buddies[b].name}</Chip>)}</div>
        <Picker items={buddyItems} placeholder="Přidat parťáka" onPick={(bid) => onChange({ buddyIds: [...note.buddyIds, bid] })}
          onCreate={async (name) => { const b = findBuddyByName(name) || (await upsertBuddy({ name })); onChange({ buddyIds: [...new Set([...note.buddyIds, b.id])] }); }} />
        {topBuddies.length > 0 && <div className="quick">{topBuddies.map((id) => <button key={id} className="btn small" onClick={() => onChange({ buddyIds: [...note.buddyIds, id] })}>＋ {lb.buddies[id].name}</button>)}</div>}
      </Card>
      <PrepCard prep={note.prep} real={real} cc={cc} diveId={diveId} onChange={(prep) => onChange({ prep })} />
      <Card title="Hodnocení">
        <RatingPicker value={note.rating} onChange={(rating) => onChange({ rating })} />
      </Card>
      <Card title="Poznámka">
        <textarea value={text} rows={4} placeholder="Jak se ponor povedl, viditelnost, co jste viděli, problémy…" onChange={(e) => setText(e.target.value)} onBlur={() => text !== note.note && onChange({ note: text })} />
      </Card>
      {w && (
        <Card title="Počasí na lokalitě">
          <p className="big">{num(w.temp, 1)} °C, {weatherText(w.code)}</p>
          <p className="muted">Vítr {num(w.wind, 1)} m/s (nárazy {num(w.gust, 0)}) · oblačnost {w.cloud} % · tlak {num(w.pressure, 0)} hPa · srážky {num(w.precip, 1)} mm</p>
          <p className="note">Zaznamenáno {new Date(w.at).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })} · Open-Meteo</p>
        </Card>
      )}
    </>
  );
}
