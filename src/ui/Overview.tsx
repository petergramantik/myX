import { useEffect, useRef, useState } from "react";
import { alerts } from "../core/analysis";
import { importDb, localNow, locate, nearestSite, toast, upsertSite } from "../app/store";
import { AlertBox, Card, Tiles, fmtDate, go, num, useStore } from "./common";
import { WeatherCard } from "./Weather";

export function ImportButton({ label = "Importovat export ze Shearwater Cloud" }: { label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className="btn primary" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Načítám…" : label}</button>
      <input ref={ref} type="file" accept=".db,application/octet-stream,application/x-sqlite3,*/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setBusy(true);
        try { const n = await importDb(f); toast(n ? `Přidáno ponorů: ${n}` : "Žádné nové ponory"); }
        catch (err) { toast("Import selhal: " + (err as Error).message); }
        finally { setBusy(false); }
      }} />
    </>
  );
}

export function OverviewScreen() {
  const st = useStore();
  useEffect(() => { if (!st.pos) locate(); }, []);
  const lb = st.lb;
  const al = alerts(st.metas.map((m) => m.h), localNow(), lb.settings.th, lb.settings.manualFill);
  const near = nearestSite();
  const last = st.metas[st.metas.length - 1];
  const totalMin = st.metas.reduce((a, m) => a + m.h.diveTimeS, 0) / 60;
  const lastNote = last ? lb.notes[last.id] : undefined;
  const here = near && near.km <= 2 ? near.site : null;
  return (
    <div className="screen">
      {al.map((a, i) => <AlertBox key={i} a={a} />)}

      <Card title="Kde jsem">
        {st.pos ? (
          here ? (
            <p className="big">📍 <a onClick={() => go({ t: "site", id: here.id })}>{here.name}</a> <small>({num(near!.km * 1000, 0)} m)</small></p>
          ) : (
            <>
              <p>{near ? <>Nejbližší známá lokalita: <a onClick={() => go({ t: "site", id: near.site.id })}>{near.site.name}</a> ({num(near.km, 1)} km)</> : "Zatím nemáš lokality s polohou."}</p>
              <NewSiteHere lat={st.pos.lat} lon={st.pos.lon} />
            </>
          )
        ) : <p className="muted">{st.posErr || "Zjišťuji polohu…"} <a onClick={() => locate()}>Zkusit znovu</a></p>}
      </Card>

      {(here || st.pos) && <WeatherCard lat={here?.lat ?? here?.sp?.lat ?? st.pos!.lat} lon={here?.lon ?? here?.sp?.lon ?? st.pos!.lon} />}

      {last ? (
        <Card title="Poslední ponor" right={<a onClick={() => go({ t: "dive", id: last.id })}>Detail ›</a>}>
          <p className="muted">č. {st.metas.length} · {fmtDate(last.start)} · {lastNote?.siteId ? lb.sites[lastNote.siteId]?.name : "lokalita nezadaná"}</p>
          <Tiles items={[
            ["Max. hloubka", `${num(last.h.maxDepth)} m`], ["Doba", `${Math.round(last.h.diveTimeS / 60)} min`],
            ["Max. CO₂", last.sum.co2Max != null ? `${num(last.sum.co2Max, 2)} mbar` : "–"], ["Scrubber zbývá", `${last.h.scrubLeftEndMin} min`],
            ["Baterie", `${last.h.batVEnd.toFixed(2)} V`], ["O₂ / dil", `${num(last.sum.o2End, 0)} / ${num(last.sum.dilEnd, 0)} bar`],
          ]} />
        </Card>
      ) : (
        <Card title="Začni importem">
          <p>V aplikaci Shearwater Cloud: <b>Profile → Options → Export Database</b>, ulož soubor a načti ho tady.</p>
        </Card>
      )}

      {st.metas.length > 0 && (
        <Card title="Celkem">
          <Tiles items={[
            ["Ponorů", st.metas.length], ["Hodin pod vodou", num(totalMin / 60, 1)],
            ["Lokalit", Object.keys(lb.sites).length], ["Parťáků", Object.keys(lb.buddies).length],
            ["Nejhlubší", `${num(Math.max(...st.metas.map((m) => m.h.maxDepth)))} m`],
            ["Nejdelší", `${Math.round(Math.max(...st.metas.map((m) => m.h.diveTimeS)) / 60)} min`],
          ]} />
        </Card>
      )}
      <div className="center"><ImportButton /></div>
    </div>
  );
}

function NewSiteHere({ lat, lon }: { lat: number; lon: number }) {
  const [name, setName] = useState("");
  return (
    <div className="row">
      <input value={name} placeholder="Název nové lokality zde" onChange={(e) => setName(e.target.value)} />
      <button className="btn" disabled={!name.trim()} onClick={async () => { const s = await upsertSite({ name: name.trim(), lat, lon }); setName(""); go({ t: "site", id: s.id }); }}>Uložit</button>
    </div>
  );
}
