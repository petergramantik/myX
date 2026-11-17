import { ask, askText } from "../app/dialog";
import { useEffect, useState } from "react";
import { ME, adoptForeign, ownMetas, clockDrift, foreignNames, getState, guestLogs, mergeInto, openGuest, ownLb, remove, toast, upsertBuddy, upsertSite, locate, type GuestLog } from "../app/store";
import { distKm, norm, siteCoords } from "../app/model";
import { loadSpDetail, loadSpList, parseSpRef, searchSp, spUrl, type SpListItem } from "../app/sp";
import { BLSwitch, Card, KV, Picker, back, fmtDate, go, num, useStore } from "./common";
import { WeatherCard } from "./Weather";

const MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function SitesScreen() {
  const st = useStore(), my = { lb: ownLb(), metas: ownMetas() };
  const [q, setQ] = useState("");
  const counts: Record<string, { n: number; last: number }> = {};
  for (const m of my.metas) { const s = my.lb.notes[m.id]?.siteId; if (s) counts[s] = { n: (counts[s]?.n || 0) + 1, last: m.start }; }
  const list = Object.values(my.lb.sites).filter((s) => !q || norm(s.name).includes(norm(q)))
    .map((s) => ({ s, c: counts[s.id], km: st.pos && siteCoords(s) ? distKm(st.pos, siteCoords(s)!) : null }))
    .sort((a, b) => (b.c?.n || 0) - (a.c?.n || 0) || a.s.name.localeCompare(b.s.name, "cs"));
  const [name, setName] = useState("");
  return (
    <div className="screen">
      <BLSwitch on="sites" />
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
      <ForeignNames kind="site" />
    </div>
  );
}

export function SiteScreen({ id }: { id: string }) {
  const st = useStore(), my = { lb: ownLb(), metas: ownMetas() };
  const s = my.lb.sites[id];
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
  const dives = my.metas.filter((m) => my.lb.notes[m.id]?.siteId === id);
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
  const others = Object.values(my.lb.sites).filter((x) => x.id !== id);
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
        <MergeRow items={others.map((x) => ({ id: x.id, name: x.name }))} current={s.name} onMerge={async (into, nm) => { await mergeInto("site", id, into, nm); back(); toast("Lokality sloučeny"); }} />
        <button className="btn danger" onClick={async () => { if (await ask(`Smazat lokalitu „${s.name}“? Ponory zůstanou bez lokality.`)) { await remove("site", id); back(); } }}>Smazat lokalitu</button>
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

/** Sloučení: výběr cíle a názvu, který zůstane (lze upravit). */
function MergeRow({ items, current, onMerge }: { items: { id: string; name: string }[]; current: string; onMerge: (into: string, name: string) => void }) {
  const [sel, setSel] = useState("");
  const [name, setName] = useState("");
  if (!items.length) return null;
  const target = items.find((x) => x.id === sel);
  return (
    <div>
      <div className="row">
        <select value={sel} onChange={(e) => { setSel(e.target.value); setName(items.find((x) => x.id === e.target.value)?.name || ""); }}>
          <option value="">Sloučit do…</option>
          {[...items].sort((a, b) => a.name.localeCompare(b.name, "cs")).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className="btn" disabled={!sel || !name.trim()} onClick={() => onMerge(sel, name)}>Sloučit</button>
      </div>
      {target && <NameChoice a={target.name} b={current} value={name} onChange={setName} />}
    </div>
  );
}

/** Volba názvu po sloučení: jeden ze dvou, nebo vlastní úprava. */
export function NameChoice({ a, b, value, onChange }: { a: string; b: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="namechoice">
      <small className="muted">Ponechat název:</small>
      {[...new Set([a, b])].map((n) => <label key={n} className="check"><input type="radio" checked={value === n} onChange={() => onChange(n)} /> {n}</label>)}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Vlastní název" />
    </div>
  );
}

export function BuddiesScreen() {
  const st = useStore(), my = { lb: ownLb(), metas: ownMetas() };
  const [name, setName] = useState("");
  const counts: Record<string, { n: number; last: number }> = {};
  for (const m of my.metas) for (const b of my.lb.notes[m.id]?.buddyIds || []) counts[b] = { n: (counts[b]?.n || 0) + 1, last: m.start };
  const list = Object.values(my.lb.buddies).sort((a, b) => (counts[b.id]?.n || 0) - (counts[a.id]?.n || 0) || a.name.localeCompare(b.name, "cs"));
  return (
    <div className="screen">
      <BLSwitch on="buddies" />
      {list.map((b) => (
        <div key={b.id} className="list-item" onClick={() => go({ t: "buddy", id: b.id })}>
          <div className="li-main"><b>{b.name}</b><small>{counts[b.id] ? `${counts[b.id].n} ponorů · naposledy ${fmtDate(counts[b.id].last)}` : "bez ponorů"}</small></div>
        </div>
      ))}
      {!list.length && <p className="muted center">Buddy se založí, když ho zadáš u ponoru.</p>}
      <div className="row">
        <input value={name} placeholder="Nový buddy" onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()} onClick={async () => { await upsertBuddy({ name: name.trim() }); setName(""); }}>Přidat</button>
      </div>
      <ForeignNames kind="buddy" />
    </div>
  );
}

/** Jména z cizích logů: ve výchozím stavu se k mým neukládají; jde je přidat nebo přiřadit k mému záznamu. */
function ForeignNames({ kind }: { kind: "buddy" | "site" }) {
  const st = useStore();
  const [list, setList] = useState<Awaited<ReturnType<typeof foreignNames>>>([]);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [nm, setNm] = useState("");
  const reload = () => foreignNames(kind).then(setList);
  useEffect(() => { reload(); }, [ownLb().aliases, ownLb().buddies, ownLb().sites, st.guest, st.guestRev]);
  useEffect(() => { if (list.length) setOpen(true); }, [list.length > 0]);
  if (!list.length) return null;
  const mine = Object.values(kind === "buddy" ? ownLb().buddies : ownLb().sites).sort((a, b) => a.name.localeCompare(b.name, "cs"));
  const done = async (name: string, id: string | null, keep?: string) => {
    const n = await adoptForeign(kind, name, id, keep);
    setPick(null); setTarget(null); reload();
    if (n) toast(`${kind === "site" ? "Lokalita doplněna" : "Buddy doplněn"} k ${n} ponorům`);
  };
  return (
    <section className="panel">
      <button className="panel-h" onClick={() => setOpen(!open)}>
        <span className="ph-main">Z cizích logů ({list.length})</span>
        <span className="ph-sub">{kind === "buddy" ? "Buddy" : "Lokality"} zapsané v lozích buddyů – přidej je nebo přiřaď k tvým</span>
        <span className="ph-arrow">{open ? "▴" : "▾"}</span>
      </button>
      {open && <div className="panel-b">
        {list.map((x) => (
          <div key={x.name} className="foreign">
            <div className="fn-line"><span className="fn-name"><b>{x.name}</b><small className="muted">{x.n}× · {x.logs.join(", ")}</small></span>
              <span className="fn-acts">
                <button className="btn small" onClick={() => done(x.name, null)}>Přidat k mým</button>
                <button className="btn small" onClick={() => { setPick(pick === x.name ? null : x.name); setTarget(null); }}>Je to…</button>
                {kind === "buddy" && <button className="btn small" onClick={() => done(x.name, ME)}>To jsem já</button>}
              </span>
            </div>
            {pick === x.name && !target && (
              <Picker items={mine.map((m) => ({ id: m.id, name: m.name }))} placeholder={kind === "buddy" ? "Vyber mého buddyho" : "Vyber mou lokalitu"}
                onPick={(id) => { const t = mine.find((m) => m.id === id)!; setTarget({ id, name: t.name }); setNm(t.name); }}
                onCreate={() => done(x.name, null)} />
            )}
            {pick === x.name && target && (
              <div>
                <NameChoice a={target.name} b={x.name} value={nm} onChange={setNm} />
                <div className="row"><button className="btn primary" disabled={!nm.trim()} onClick={() => done(x.name, target.id, nm)}>Sloučit</button><button className="btn" onClick={() => setTarget(null)}>Zpět</button></div>
              </div>
            )}
          </div>
        ))}
      </div>}
    </section>
  );
}

/** Odchylka hodin buddyho počítače proti mým (odhad z časů začátku společných ponorů). */
function Drift({ serial }: { serial: string }) {
  const [d, setD] = useState<{ at: number; diff: number }[]>([]);
  useEffect(() => { clockDrift(serial).then(setD); }, [serial]);
  if (!d.length) return null;
  const f = (s: number) => `${s >= 0 ? "+" : "−"}${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}${Math.abs(Math.abs(s) - 3600) <= 900 ? " (1 h)" : ""}`;
  const last = d[d.length - 1];
  return <div className="small muted">Hodiny: naposledy {f(last.diff)} min ({fmtDate(last.at)}){d.length > 1 ? ` · vývoj: ${d.slice(-6).map((x) => f(x.diff)).join(" → ")}` : ""}<br />Odhad z času začátku společných ponorů; kladné = jdou napřed.</div>;
}

function BuddyComputer({ id }: { id: string }) {
  const st = useStore();
  const [logs, setLogs] = useState<GuestLog[]>([]);
  useEffect(() => { guestLogs().then(setLogs); }, [st.guest, st.guestRev]);
  const comps = Object.values(ownLb().computers || {}).filter((c) => c.buddyId === id);
  if (!comps.length) return <span className="muted">–</span>;
  return <>{comps.map((c) => {
    const log = logs.find((l) => l.serial === c.id);
    return <div key={c.id}>{c.model} {c.id}{log && st.guest?.id !== log.id && <> · <a onClick={async () => { await openGuest(log); go({ t: "home" }); }}>Otevřít jeho log ›</a></>}<Drift serial={c.id} /></div>;
  })}</>;
}

export function BuddyScreen({ id }: { id: string }) {
  const st = useStore(), my = { lb: ownLb(), metas: ownMetas() };
  const b = my.lb.buddies[id];
  const [name, setName] = useState(b?.name || "");
  useEffect(() => setName(b?.name || ""), [id, b?.name]);
  if (!b) return <div className="screen"><p>Buddy neexistuje.</p></div>;
  const dives = my.metas.filter((m) => my.lb.notes[m.id]?.buddyIds.includes(id));
  const sites: Record<string, number> = {};
  for (const m of dives) { const s = my.lb.notes[m.id]?.siteId; if (s) sites[s] = (sites[s] || 0) + 1; }
  return (
    <div className="screen">
      <Card title="Buddy">
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!name.trim() || name === b.name} onClick={() => upsertBuddy({ ...b, name: name.trim() })}>Uložit</button>
        </div>
        <KV rows={[
          ["Společných ponorů", <a onClick={() => go({ t: "dives", buddy: id })}>{dives.length} ›</a>],
          ["Hodin spolu", num(dives.reduce((a, m) => a + m.h.diveTimeS, 0) / 3600, 1)],
          ["Naposledy", dives.length ? fmtDate(dives[dives.length - 1].start) : "–"],
          ["Počítač", <BuddyComputer id={id} />],
          ["Lokality", Object.entries(sites).sort((a, c) => c[1] - a[1]).map(([s, n]) => `${getState().lb.sites[s]?.name} (${n})`).join(", ") || "–"],
        ]} />
      </Card>
      <Card title="Úpravy">
        <MergeRow items={Object.values(my.lb.buddies).filter((x) => x.id !== id)} current={b.name} onMerge={async (into, nm) => { await mergeInto("buddy", id, into, nm); back(); toast("Sloučeno"); }} />
        <button className="btn danger" onClick={async () => { if (await ask(`Smazat buddyho „${b.name}“?`)) { await remove("buddy", id); back(); } }}>Smazat</button>
      </Card>
    </div>
  );
}
