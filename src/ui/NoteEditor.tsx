// Společný editor logbooku (lokalita, parťáci, hodnocení, poznámka, počasí) pro ponor i rozpracovaný ponor.
import { useEffect, useState } from "react";
import type { DiveNote } from "../app/model";
import { findBuddyByName, findSiteByName, upsertBuddy, upsertSite } from "../app/store";
import { weatherText } from "../app/weather";
import { Card, Chip, Picker, RatingPicker, go, num, useStore } from "./common";

export function NoteEditor({ note, onChange, pos }: { note: DiveNote; onChange: (p: Partial<DiveNote>) => void; pos?: { lat?: number; lon?: number } }) {
  const st = useStore();
  const lb = st.lb;
  const [text, setText] = useState(note.note);
  useEffect(() => setText(note.note), [note.note]);
  const site = note.siteId ? lb.sites[note.siteId] : undefined;
  const siteItems = Object.values(lb.sites).map((s) => ({ id: s.id, name: s.name }));
  const buddyItems = Object.values(lb.buddies).filter((b) => !note.buddyIds.includes(b.id)).map((b) => ({ id: b.id, name: b.name }));
  const w = note.weather;
  return (
    <>
      <Card title="Lokalita">
        {site ? <Chip onClick={() => go({ t: "site", id: site.id })} onX={() => onChange({ siteId: undefined })}>📍 {site.name}</Chip>
          : <Picker items={siteItems} placeholder="Napiš název lokality" onPick={(sid) => onChange({ siteId: sid })}
              onCreate={async (name) => { const s = findSiteByName(name) || (await upsertSite({ name, lat: pos?.lat, lon: pos?.lon })); onChange({ siteId: s.id }); }} />}
      </Card>
      <Card title="S kým">
        <div className="chips">{note.buddyIds.map((b) => lb.buddies[b] && <Chip key={b} onClick={() => go({ t: "buddy", id: b })} onX={() => onChange({ buddyIds: note.buddyIds.filter((x) => x !== b) })}>{lb.buddies[b].name}</Chip>)}</div>
        <Picker items={buddyItems} placeholder="Přidat parťáka" onPick={(bid) => onChange({ buddyIds: [...note.buddyIds, bid] })}
          onCreate={async (name) => { const b = findBuddyByName(name) || (await upsertBuddy({ name })); onChange({ buddyIds: [...new Set([...note.buddyIds, b.id])] }); }} />
      </Card>
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
