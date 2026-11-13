import { useEffect, useState } from "react";
import { getState, mergeInto, remove, toast, upsertBuddy, upsertSite, locate } from "../app/store";
import { distKm, norm, siteCoords } from "../app/model";
import { loadSpDetail, loadSpList, parseSpRef, searchSp, spUrl, type SpListItem } from "../app/sp";
import { Card, KV, back, fmtDate, go, num, useStore } from "./common";
import { WeatherCard } from "./Weather";

const MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function SitesScreen() {
  const st = useStore();
  const [q, setQ] = useState("");
  const counts: Record<string, { n: number; last: number }> = {};
  for (const m of st.metas) { const s = st.lb.notes[m.id]?.siteId; if (s) counts[s] = { n: (counts[s]?.n || 0) + 1, last: m.start }; }
  const list = Object.values(st.lb.sites).filter((s) => !q || norm(s.name).includes(norm(q)))
    .map((s) => ({ s, c: counts[s.id], km: st.pos && siteCoords(s) ? distKm(st.pos, siteCoords(s)!) : null }))
    .sort((a, b) => (b.c?.n || 0) - (a.c?.n || 0) || a.s.name.localeCompare(b.s.name, "cs"));
  const [name, setName] = useState("");
  return (
    <div className="screen">
      <input className="search" placeholder="Hledat lokalitu" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.map(({ s, c, km }) => (
        <div key={s.id} className="list-item" onClick={() => go({ t: "site", id: s.id })}>
          <div className="li-main"><b>{s.name}</b><small>{c ? `${c.n} ponorů · naposledy ${fmtDate(c.last)}` : "bez ponorů"}{km != null ? ` · ${num(km, 1)} km` : ""}{s.spId ? " · SP" : ""}</small></div>
        </div>
      ))}
      {!list.length && <p className="muted center">Lokality vznikají, když je zadáš u ponoru.</p>}
      <div className="row">
        <input value={name} placeholder="Nová lokalita" onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()} onClick={async () => { const s = await upsertSite({ name: name.trim() }); setName(""); go({ t: "site", id: s.id }); }}>Přidat</button>
      </div>
    </div>
  );
}

export function SiteScreen({ id }: { id: string }) {
  const st = useStore();
  const s = st.lb.sites[id];
  const [name, setName] = useState(s?.name || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(s?.name || ""), [id, s?.name]);
  // po prvním otevření zkusit automaticky dohledat lokalitu na Stranách potápěčských podle názvu
  const [cands, setCands] = useState<SpListItem[] | null>(null);
  useEffect(() => {
    if (!s || s.spId) return;
    loadSpList().then((l) => setCands(searchSp(l, s.name))).catch(() => setCands(null));
  }, [id, s?.name, s?.spId]);
  if (!s) return <div className="screen"><p>Lokalita neexistuje.</p></div>;
  const dives = st.metas.filter((m) => st.lb.notes[m.id]?.siteId === id);
  const c = siteCoords(s);
  const linkSp = async (spId: number) => {
    setBusy(true);
    try {
      const sp = await loadSpDetail(spId);
      await upsertSite({ ...s, spId, sp, lat: s.lat ?? sp.lat, lon: s.lon ?? sp.lon });
      toast(sp.lat ? "Spárováno se Stranami potápěčskými" : "Spárováno (stránka neobsahuje GPS)");
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const others = Object.values(st.lb.sites).filter((x) => x.id !== id);
  return (
    <div className="screen">
      <Card title="Lokalita">
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!name.trim() || name === s.name} onClick={() => upsertSite({ ...s, name: name.trim() })}>Uložit</button>
        </div>
        <KV rows={[
          ["Ponorů", <a onClick={() => go({ t: "dives", site: id })}>{dives.length} ›</a>],
          ["Poloha", c ? <a href={`https://mapy.com/?q=${c.lat},${c.lon}`} target="_blank" rel="noreferrer">{c.lat.toFixed(5)}, {c.lon.toFixed(5)}</a> : "neznámá"],
          ["Vzdálenost", st.pos && c ? `${num(distKm(st.pos, c), 1)} km` : "–"],
        ]} />
        <div className="row">
          <button className="btn" onClick={async () => { const p = await locate(); if (p) { await upsertSite({ ...s, lat: p.lat, lon: p.lon }); toast("Poloha uložena"); } }}>Nastavit podle mé polohy</button>
        </div>
      </Card>

      <Card title="Strany potápěčské">
        {s.spId ? (
          <>
            <p><a href={spUrl(s.spId)} target="_blank" rel="noreferrer">{s.sp?.name || "Otevřít popis lokality"} ↗</a></p>
            {s.sp && <KV rows={[
              ...(s.sp.type ? [["Typ", s.sp.type] as [string, string]] : []),
              ...(s.sp.region ? [["Region", s.sp.region] as [string, string]] : []),
              ...(s.sp.maxDepth ? [["Max. hloubka", `${s.sp.maxDepth} m`] as [string, string]] : []),
              ...(s.sp.visibility ? [["Prům. viditelnost", `${s.sp.visibility} m`] as [string, string]] : []),
              ...(s.sp.rating ? [["Hodnocení", s.sp.rating] as [string, string]] : []),
              ["Načteno", fmtDate(s.sp.fetched / 1000 - new Date().getTimezoneOffset() * 60)],
            ]} />}
            {s.sp?.temps && (
              <div className="months">{s.sp.temps.map((t, i) => <div key={i} className={i === new Date().getMonth() ? "on" : ""}><small>{MONTHS[i]}</small>{t ?? "–"}°</div>)}</div>
            )}
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => linkSp(s.spId!)}>Načíst znovu</button>
              <button className="btn" onClick={() => upsertSite({ ...s, spId: undefined, sp: undefined })}>Zrušit spárování</button>
            </div>
          </>
        ) : (
          <>
            {cands && cands.length > 0 && <p className="muted">Možné shody podle názvu:</p>}
            {cands?.map((x) => <button key={x.id} className="btn block" disabled={busy} onClick={() => linkSp(x.id)}>{x.name}</button>)}
            {cands && !cands.length && <p className="muted">Podle názvu jsem nic nenašel.</p>}
            <SpLinkInput onLink={linkSp} busy={busy} />
          </>
        )}
      </Card>

      {c && <WeatherCard lat={c.lat} lon={c.lon} />}

      <Card title="Úpravy">
        <MergeRow items={others.map((x) => ({ id: x.id, name: x.name }))} onMerge={async (into) => { await mergeInto("site", id, into); back(); toast("Lokality sloučeny"); }} />
        <button className="btn danger" onClick={async () => { if (confirm(`Smazat lokalitu „${s.name}“? Ponory zůstanou bez lokality.`)) { await remove("site", id); back(); } }}>Smazat lokalitu</button>
      </Card>
    </div>
  );
}

function SpLinkInput({ onLink, busy }: { onLink: (id: number) => void; busy: boolean }) {
  const [v, setV] = useState("");
  const [q, setQ] = useState<SpListItem[]>([]);
  const ref = parseSpRef(v);
  useEffect(() => {
    if (ref || v.trim().length < 3) { setQ([]); return; }
    loadSpList().then((l) => setQ(searchSp(l, v))).catch(() => setQ([]));
  }, [v]);
  return (
    <>
      <div className="row">
        <input value={v} placeholder="Hledat název nebo vložit odkaz" onChange={(e) => setV(e.target.value)} />
        <button className="btn" disabled={!ref || busy} onClick={() => ref && onLink(ref)}>Spárovat</button>
      </div>
      {q.map((x) => <button key={x.id} className="btn block" disabled={busy} onClick={() => onLink(x.id)}>{x.name}</button>)}
    </>
  );
}

function MergeRow({ items, onMerge }: { items: { id: string; name: string }[]; onMerge: (into: string) => void }) {
  const [sel, setSel] = useState("");
  if (!items.length) return null;
  return (
    <div className="row">
      <select value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">Sloučit do…</option>
        {[...items].sort((a, b) => a.name.localeCompare(b.name, "cs")).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <button className="btn" disabled={!sel} onClick={() => onMerge(sel)}>Sloučit</button>
    </div>
  );
}

export function BuddiesScreen() {
  const st = useStore();
  const [name, setName] = useState("");
  const counts: Record<string, { n: number; last: number }> = {};
  for (const m of st.metas) for (const b of st.lb.notes[m.id]?.buddyIds || []) counts[b] = { n: (counts[b]?.n || 0) + 1, last: m.start };
  const list = Object.values(st.lb.buddies).sort((a, b) => (counts[b.id]?.n || 0) - (counts[a.id]?.n || 0) || a.name.localeCompare(b.name, "cs"));
  return (
    <div className="screen">
      {list.map((b) => (
        <div key={b.id} className="list-item" onClick={() => go({ t: "buddy", id: b.id })}>
          <div className="li-main"><b>{b.name}</b><small>{counts[b.id] ? `${counts[b.id].n} ponorů · naposledy ${fmtDate(counts[b.id].last)}` : "bez ponorů"}</small></div>
        </div>
      ))}
      {!list.length && <p className="muted center">Parťáci vznikají, když je zadáš u ponoru.</p>}
      <div className="row">
        <input value={name} placeholder="Nový parťák" onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()} onClick={async () => { await upsertBuddy({ name: name.trim() }); setName(""); }}>Přidat</button>
      </div>
    </div>
  );
}

export function BuddyScreen({ id }: { id: string }) {
  const st = useStore();
  const b = st.lb.buddies[id];
  const [name, setName] = useState(b?.name || "");
  useEffect(() => setName(b?.name || ""), [id, b?.name]);
  if (!b) return <div className="screen"><p>Parťák neexistuje.</p></div>;
  const dives = st.metas.filter((m) => st.lb.notes[m.id]?.buddyIds.includes(id));
  const sites: Record<string, number> = {};
  for (const m of dives) { const s = st.lb.notes[m.id]?.siteId; if (s) sites[s] = (sites[s] || 0) + 1; }
  return (
    <div className="screen">
      <Card title="Parťák">
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!name.trim() || name === b.name} onClick={() => upsertBuddy({ ...b, name: name.trim() })}>Uložit</button>
        </div>
        <KV rows={[
          ["Společných ponorů", <a onClick={() => go({ t: "dives", buddy: id })}>{dives.length} ›</a>],
          ["Hodin spolu", num(dives.reduce((a, m) => a + m.h.diveTimeS, 0) / 3600, 1)],
          ["Naposledy", dives.length ? fmtDate(dives[dives.length - 1].start) : "–"],
          ["Lokality", Object.entries(sites).sort((a, c) => c[1] - a[1]).map(([s, n]) => `${getState().lb.sites[s]?.name} (${n})`).join(", ") || "–"],
        ]} />
      </Card>
      <Card title="Úpravy">
        <MergeRow items={Object.values(st.lb.buddies).filter((x) => x.id !== id)} onMerge={async (into) => { await mergeInto("buddy", id, into); back(); toast("Sloučeno"); }} />
        <button className="btn danger" onClick={async () => { if (confirm(`Smazat parťáka „${b.name}“?`)) { await remove("buddy", id); back(); } }}>Smazat</button>
      </Card>
    </div>
  );
}
