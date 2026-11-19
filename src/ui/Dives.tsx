import { useEffect, useMemo, useRef, useState } from "react";
import type { Dive } from "../core/shearwater";
import { BTN_NAMES, GAS_COLOR, dur, tpt, po2HighZones, po2HiLevel, cellCalibration, pressureAnalysis, cellSpread, diveWarnings, batSwapInfo, gasLabel, gasSegments, o2Doses, realStops, scrName, setpointChanges, summarize } from "../core/analysis";
import { ME, adoptForeign, aliasGuess, compModel, deleteGuestDives, toast, nearestPair, applySuggestion, diveHeads, loadDive, myNum, ownMetas, segInfo, setNote, setSegOverride, suggestionsFor, viewMetas, type Suggest } from "../app/store";
import { cellDiveWarnings, mergeCellAlerts } from "../core/cells";
import { computerWarnings } from "../core/compwarn";
import { TAG_ORDER, diveTagsOf, type DiveTag, type TagCat } from "../core/tags";
import { norm, uid, type DiveNote, type ExtGas, type Meta } from "../app/model";
import { partIds, shareDives } from "./share";
import { ask } from "../app/dialog";
import { AlertBox, Card, ClearInput, KV, Picker, RATING, Tiles, back, fmtDate, fmtDateTime, go, hm, leaveY, num, useStore } from "./common";
import { NoteEditor } from "./NoteEditor";
import { dilVents, effortOf, gasDensity, workloadIndex } from "../core/effort";
import { BuddyDivesCard, commonDives, type Common } from "./Compare";
import { ChartDefs, LineChart, TissueMap, ZoomCtx } from "./Chart";

const C = ["#4fc3f7", "#ffb74d", "#81c784", "#ce93d8", "#fff176", "#ef5350"];

const DL0 = { q: "", rate: "", tagF: [] as TagCat[], gasF: [] as string[], onlyCommon: true, bsel: [] as string[], noBuddy: false, pickMode: false, picked: [] as string[] };
const dlMemo: typeof DL0 & { ctx: string | null; y: number } = { ...DL0, ctx: null, y: 0 };

export function DivesScreen({ site, buddy }: { site?: string; buddy?: string }) {
  const st = useStore();
  // filtry seznamu přežijí otevření ponoru / srovnání a návrat (do zavření aplikace nebo změny logu)
  const ctx = `${st.guest?.id || ""}|${site || ""}|${buddy || ""}`;
  if (dlMemo.ctx !== ctx) Object.assign(dlMemo, { ...DL0, ctx, bsel: buddy ? [buddy] : [] });
  const mem = <K extends keyof typeof DL0>(k: K) => {
    const [v, set0] = useState(dlMemo[k]);
    return [v, (x: (typeof DL0)[K]) => { dlMemo[k] = x; set0(x); }] as const;
  };
  const [q, setQ] = mem("q");
  const [rate, setRate] = mem("rate");
  const [tagF, setTagF] = mem("tagF");
  const [gasF, setGasF] = mem("gasF");
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem("myx-compact") === "1"; } catch { return false; } });
  const lb = st.lb;
  const [onlyCommon, setOnlyCommon] = mem("onlyCommon");
  const [bsel, setBsel] = mem("bsel");
  const [noBuddy, setNoBuddy] = mem("noBuddy");
  const [moreB, setMoreB] = useState(false);
  const [pickMode, setPickMode] = mem("pickMode");
  const [picked, setPicked] = mem("picked");
  const endPick = () => { setPickMode(false); setPicked([]); };
  useEffect(() => { const y = dlMemo.y; if (y) requestAnimationFrame(() => window.scrollTo(0, y)); return () => { dlMemo.y = leaveY; }; }, []);
  // seznam ponorů s buddym: ponory, ke kterým mám log buddyho, se otevřou rovnou jako srovnání
  const [cmp, setCmp] = useState<Map<string, Common>>(new Map());
  const [sugSite, setSugSite] = useState<Map<string, { name: string; who: string }>>(new Map());
  useEffect(() => {
    if (st.guest) return;
    (async () => {
      const out = new Map<string, { name: string; who: string }>();
      for (const m of st.metas) {
        if (lb.notes[m.id]?.siteId) continue;
        const sg = (await suggestionsFor(m)).find((x) => x.site);
        if (sg?.site) out.set(m.id, { name: sg.site.mine ? lb.sites[sg.site.mine]?.name || sg.site.name : sg.site.name, who: sg.who });
      }
      setSugSite(out);
    })();
  }, [st.metas, st.guest, st.guestRev, lb.notes, lb.aliases]);
  useEffect(() => { if (!st.guest) commonDives(diveHeads()).then((c) => setCmp(new Map(c.map((x) => [x.m.id, x])))); }, [st.metas, st.guest, st.guestRev, lb.computers, lb.settings.segOv, lb.settings.segGap]);
  // u cizího logu: ponory, ke kterým mám svůj ponor (začátek do ±15 min)
  const mine = st.guest ? ownMetas() : [];
  const common = (m: Meta) => mine.some((x) => nearestPair([m], x).length > 0);
  const n = norm(q);
  const match = (note: { siteId?: string; buddyIds: string[]; note: string; rating?: string } | undefined, date: number) => {
    if (site && note?.siteId !== site) return false;
    if (bsel.some((b) => !note?.buddyIds.includes(b))) return false;
    if (rate && note?.rating !== rate) return false;
    if (!n) return true;
    const txt = norm([note?.siteId ? lb.sites[note.siteId]?.name : "", ...(note?.buddyIds || []).map((b) => lb.buddies[b]?.name || ""), note?.note || "", fmtDate(date)].join(" "));
    return n.split(" ").every((w) => txt.includes(w));
  };
  const vm = viewMetas();
  const rows = vm.map((m, i) => ({ m, no: i + 1, note: lb.notes[m.id] })).reverse()
    .filter(({ m, note }) => match(note, m.start) && (!st.guest || !onlyCommon || common(m)) && (!noBuddy || (!note?.buddyIds.length && !cmp.has(m.id))) && (!tagF.length || diveTagsOfMeta(st.metas, m, lb.settings.th).some((t) => tagF.includes(t.cat)))
      && (!gasF.length || gasCats(m).some((g) => gasF.includes(g))));
  // dostupné filtry: kategorie plynů a problémů, které se v ponorech vyskytují
  const gasAll = GAS_CATS.filter((g) => vm.some((m) => gasCats(m).includes(g)));
  const tagAll = TAG_ORDER.filter((c) => vm.some((m) => diveTagsOfMeta(st.metas, m, lb.settings.th).some((t) => t.cat === c)));
  const tog = <T,>(arr: T[], v: T, set: (x: T[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  // buddy s počtem mých ponorů (pro štítky filtru)
  const bcount = new Map<string, number>();
  for (const m of st.metas) for (const b of lb.notes[m.id]?.buddyIds || []) if (lb.buddies[b]) bcount.set(b, (bcount.get(b) || 0) + 1);
  const blist = [...bcount].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const withSel = (ids: string[]) => st.metas.filter((m) => ids.every((b) => lb.notes[m.id]?.buddyIds.includes(b))).length;
  const drafts = st.guest ? [] : Object.values(lb.drafts).filter((d) => match(d, d.created)).sort((a, b) => b.created - a.created);
  return (
    <div className="screen">
      {site && <p className="muted">Filtr: {lb.sites[site]?.name} · <a onClick={() => go({ t: "dives" })}>zrušit</a></p>}
      {!st.guest && blist.length > 0 && (
        <div className="chips buddyfilter">
          {(moreB ? blist : blist.slice(0, 8)).map((b) => {
            const on = bsel.includes(b), next = on ? bsel.filter((x) => x !== b) : [...bsel, b], n = withSel(next);
            return <button key={b} className={"chip" + (on ? " on" : "")} disabled={!on && !n} onClick={() => { setBsel(next); setNoBuddy(false); }}>{lb.buddies[b].name} ({on ? withSel(bsel) : n})</button>;
          })}
          {blist.length > 8 && <button className="chip" onClick={() => setMoreB(!moreB)}>{moreB ? "méně" : "další…"}</button>}
          <button className={"chip" + (noBuddy ? " on" : "")} onClick={() => { setNoBuddy(!noBuddy); setBsel([]); }}>Bez parťáka</button>
        </div>
      )}
      <ClearInput className="search" placeholder="Hledat lokalitu, parťáka, poznámku, datum…" value={q} onChange={setQ} />
      {st.guest ? (
        <div className="seg filter">
          <button className={onlyCommon ? "on" : ""} onClick={() => setOnlyCommon(true)}>Jen společné ({st.metas.filter(common).length})</button>
          <button className={!onlyCommon ? "on" : ""} onClick={() => setOnlyCommon(false)}>Všechny ({st.metas.length})</button>
          <button className={pickMode ? "on" : ""} onClick={() => (pickMode ? endPick() : setPickMode(true))}>Vybrat</button>
        </div>
      ) : (<>
        <div className="filter-row">
          <div className="seg filter">
            {[["", "Vše"], ["up", "👍"], ["down", "👎"], ["problem", "❗"]].map(([k, l]) => <button key={k} className={rate === k ? "on" : ""} onClick={() => { setRate(k); if (!k) { setQ(""); setTagF([]); setGasF([]); setBsel([]); setNoBuddy(false); dlMemo.y = 0; } }}>{l}</button>)}
          </div>
          <button className={"btn view-tg pick-tg" + (pickMode ? " on" : "")} title="Vybrat ponory ke sdílení" onClick={() => (pickMode ? endPick() : setPickMode(true))}>☑</button>
          <button className="btn view-tg" title={compact ? "Kompaktní zobrazení" : "Plné zobrazení"} onClick={() => { setCompact(!compact); try { localStorage.setItem("myx-compact", compact ? "0" : "1"); } catch { /* */ } }}>{compact ? "≡" : "☰"}</button>
        </div>
        {!compact && (gasAll.length > 0 || tagAll.length > 0) && <div className="cat-filter">
          <span className="cf-group">{gasAll.map((g) => <span key={g} className="cf-col"><button className={"gchip cf " + GAS_CLS[g] + (gasF.includes(g) ? " on" : "")} onClick={() => { const n = gasF.includes(g) ? gasF.filter((x) => x !== g) : [...gasF, g]; setGasF(n.length === gasAll.length ? [] : n); }}>{g}</button>{gasF.includes(g) && <small>{vm.filter((m) => gasCats(m).includes(g)).length}</small>}</span>)}</span>
          <span className="cf-group">{tagAll.map((c) => { const y = vm.filter((m) => diveTagsOfMeta(st.metas, m, lb.settings.th).some((t) => t.cat === c)).length; return <span key={c} className="cf-col"><button className={"tag cf" + (tagF.includes(c) ? " on" : "")} onClick={() => tog(tagF, c, setTagF)}>{c === "ČIDLO" ? "ČIDLA" : c}</button>{tagF.includes(c) && <small>{tagF.length > 1 ? `${rows.length}/${y}` : y}</small>}</span>; })}</span>
        </div>}
      </>)}
      {drafts.map((d) => (
        <div key={d.id} className="dive-row draft" onClick={() => go({ t: "draft", id: d.id })}>
          <div className="dr-main"><b>{d.siteId ? lb.sites[d.siteId]?.name : "bez lokality"}</b><small>{fmtDate(d.created)} · čeká na data z počítače</small></div>
          <div className="dr-num muted">⏳</div>
          <div className="dr-rate">{d.rating ? RATING[d.rating].icon : ""}</div>
        </div>
      ))}
      {rows.map(({ m, no, note }) => {
        const siteEl = note?.siteId ? lb.sites[note.siteId]?.name : sugSite.get(m.id) ? <i className="sugg">{sugSite.get(m.id)!.name} <small>· z logu {sugSite.get(m.id)!.who}</small></i> : <span className="muted">bez lokality</span>;
        const buds = (note?.buddyIds || []).map((b) => lb.buddies[b]?.name).filter(Boolean).join(", ");
        const c = cmp.get(m.id);
        const badge = c ? <span className="badge cmpb">⇄&nbsp;{c.with.length + 1}</span> : null;
        const rate = note?.rating ? <span className="dr-rt">{RATING[note.rating].icon}</span> : null;
        const isPicked = picked.includes(m.id);
        const open = () => { if (pickMode) { setPicked(isPicked ? picked.filter((x) => x !== m.id) : [...picked, m.id]); return; } const cc = bsel.length ? c : undefined; go(cc ? { t: "cmp", id: m.id, other: cc.with.map((x) => x.id).join(",") } : { t: "dive", id: m.id }); };
        if (compact) return (
          <div key={m.id} className={"dive-row compact " + rowLevel(diveTagsOfMeta(st.metas, m, lb.settings.th)) + (pickMode ? " pickable" : "") + (isPicked ? " picked" : "")} onClick={open}>
            <div className="dr-main"><b>{siteEl}</b><small>č. {no} · {fmtDate(m.start)}{m.parts ? ` · ${m.parts.length} části` : ""}{buds ? " · " + buds : ""}</small></div>
            <div className="dr-num fixed"><span>{num(m.h.maxDepth)}<small>m</small></span><span>{Math.round(m.h.diveTimeS / 60)}<small>min</small></span></div>
            <div className="dr-rate">{rate}{badge}</div>
          </div>
        );
        return (
          <div key={m.id} className={"dive-row full" + (pickMode ? " pickable" : "") + (isPicked ? " picked" : "")} onClick={open}>
            <div className="dr-mid">
              <div className="dr-main"><b>{siteEl}</b><small>č. {no} · {fmtDate(m.start)}{m.alt ? " · 2 počítače" : ""}{m.parts ? ` · ${m.parts.length} části` : ""}</small></div>
              <div className="dr-num"><span>{num(m.h.maxDepth)}<small>m</small></span><span>{Math.round(m.h.diveTimeS / 60)}<small>min</small></span></div>
            </div>
            {(buds || badge) && <div className="dr-bud"><span className="dr-bnames">{buds}</span>{badge}</div>}
            <div className="dr-top"><span className="dr-chips"><DilChip m={m} /><DiveTags m={m} /></span>{rate}</div>
          </div>
        );
      })}
      {!rows.length && !drafts.length && <p className="muted center">Žádné ponory</p>}
      {pickMode && <div className="pickbar">
        <span>{picked.length ? `Vybráno ${picked.length}` : "Klepnutím vyber ponory"}</span>
        <button className="btn" onClick={() => setPicked(picked.length === rows.length ? [] : rows.map((r) => r.m.id))}>{picked.length === rows.length ? "Nic" : "Vše"}</button>
        {st.guest && <button className="btn danger" disabled={!picked.length} onClick={async () => {
          const ms = rows.filter((r) => picked.includes(r.m.id)).map((r) => r.m);
          if (!await ask(`Smazat ${ms.length} ponorů z cizího logu? Při dalším importu stejného souboru se znovu přidají.`, { danger: true, ok: "Smazat" })) return;
          toast(`Smazáno ponorů: ${await deleteGuestDives(ms.flatMap(partIds))}`); endPick();
        }}>Smazat</button>}
        <button className="btn primary" disabled={!picked.length} onClick={async () => { await shareDives(rows.filter((r) => picked.includes(r.m.id)).map((r) => r.m)); endPick(); }}>Sdílet{picked.length ? ` (${picked.length})` : ""}</button>
        <button className="btn" onClick={endPick}>✕</button>
      </div>}
    </div>
  );
}

type Tab = "log" | "charts" | "values" | "events";

export function DiveScreen({ id }: { id: string }) {
  const st = useStore();
  const [d, setD] = useState<Dive | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("log");
  const [slide, setSlide] = useState("");
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setD(null); loadDive(id).then(setD).catch((e) => setErr(e.message)); }, [id]);
  const headId = segInfo().head.get(id) || id;
  useEffect(() => { if (headId !== id) go({ t: "dive", id: headId }); }, [headId, id]);
  const vm = viewMetas();
  const meta = vm.find((m) => m.id === headId);
  if (!meta) return <div className="screen"><p>Ponor nenalezen.</p></div>;
  const idx = vm.indexOf(meta);
  const prev = vm[idx - 1], next = vm[idx + 1];
  const onTouchStart = (e: React.TouchEvent) => {
    const el = e.target as HTMLElement;
    // grafy a aktivní prvky mají vlastní gesta – tam přejetí ponor nepřepíná
    touch.current = el.closest(".chart, .tile.link, .toggle, button, input, textarea, select, a, label, .picker, .heat") ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touch.current; touch.current = null;
    if (!t0) return;
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (dx < 0 && next) { setSlide("from-right"); go({ t: "dive", id: next.id }); }
    else if (dx > 0 && prev) { setSlide("from-left"); go({ t: "dive", id: prev.id }); }
  };
  return (
    <div className={"screen " + slide} key={id} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onAnimationEnd={() => setSlide("")}>
      <div className="dive-head">
        <button className="btn small" disabled={!prev} onClick={() => { if (prev) { setSlide("from-left"); go({ t: "dive", id: prev.id }); } }}>‹</button>
        <div><b>Ponor {myNum(id)}</b><small>{fmtDateTime(meta.start)} · v počítači #{meta.num}</small></div>
        <button className="btn small share-btn" title="Sdílet ponor" onClick={() => shareDives([meta])}>⤴</button>
        <button className="btn small" disabled={!next} onClick={() => { if (next) { setSlide("from-right"); go({ t: "dive", id: next.id }); } }}>›</button>
      </div>
      <div className="tabs">
        {([["log", "Logbook"], ["charts", "Grafy"], ["values", "Hodnoty"], ["events", "Události"]] as [Tab, string][]).map(([k, l]) =>
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <DiveTitle id={id} />
      {err && <p className="alert bad">{err}</p>}
      {tab === "log" && <LogTab id={id} d={d} />}
      {tab !== "log" && !d && !err && <p className="muted center">Dekóduji…</p>}
      {tab === "charts" && d && <ChartsTab d={d} />}
      {tab === "values" && d && <ValuesTab d={d} />}
      {tab === "events" && d && <EventsTab d={d} />}
    </div>
  );
}

const DOSE_COLOR = { sol: "#4fc3f7", man: "#ffb74d", amb: "#b39ddb", dil: "#cfd8dc" } as const;
const fmtSp = (v: number) => v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
/** Značky přepnutí setpointu do grafů. */
function spPins(d: Dive) {
  return setpointChanges(d).map((c) => ({ t: c.t, label: `SP ${fmtSp(c.to)}${c.manual ? "" : "?"}`, color: c.to >= 1 ? "#ffb74d" : c.to < 0.3 ? "#b0bec5" : "#81c784" }));
}

/** Sloučí upozornění se stejným nadpisem do jednoho („Nadpis – N×“), popisy pod sebe; úroveň podle nejzávažnějšího. */
function groupAlerts<T extends { level: string; title: string; text: string; parts?: string[] }>(as: T[]): { level: string; title: string; text: string; parts?: string[] }[] {
  const rank: Record<string, number> = { bad: 3, warn: 2, info: 1 };
  const m = new Map<string, { level: string; title: string; text: string; parts: string[]; own?: string[] }>();
  for (const a of as) {
    const g = m.get(a.title);
    if (!g) { m.set(a.title, { level: a.level, title: a.title, text: a.text, parts: [a.text], own: a.parts }); continue; }
    g.parts.push(a.text);
    if ((rank[a.level] || 0) > (rank[g.level] || 0)) g.level = a.level;
  }
  return [...m.values()].map((g) => g.parts.length > 1 ? { ...g, title: `${g.title} – ${g.parts.length}×` } : { level: g.level, title: g.title, text: g.text, parts: g.own });
}

/** Štítek hlavního diluentu (plyn s nejdelším časem) v pravém horním rohu řádku. */
function DilChip({ m }: { m: Meta }) {
  const g = [...(m.sum.gases || [])].sort((a, b) => b.s - a.s)[0];
  if (!g) return null;
  const l = gasLabel(g.mix);
  return <span className={"gchip " + l.cls}>{l.label}</span>;
}

/** Tagy ponoru v seznamu (jen důležité): CO₂, nevěrohodné čidlo CO₂, vysoké a nízké pO₂, rozjetá čidla. */
/** Souhrnné kategorie plynů ponoru pro filtr (AIR, TMX, NX). */
const GAS_CATS = ["AIR", "TMX", "NX"];
const GAS_CLS: Record<string, string> = { AIR: "air", TMX: "tmx", NX: "nx" };
function gasCats(m: Meta): string[] {
  return [...new Set((m.sum.gases || []).map((g) => gasLabel(g.mix).cls).filter((c) => c !== "o2").map((c) => c.toUpperCase()))];
}

function DiveTags({ m }: { m: Meta }) {
  const st = useStore();
  const tags = diveTagsOfMeta(st.metas, m, st.lb.settings.th);
  if (!tags.length) return null;
  return <div className="dr-tags">{tags.map((t) => <span key={t.cat} className={"tag " + t.level}>{t.label}</span>)}</div>;
}

/** Tagy ponoru = kategorie oranžových a červených varování ze záhlaví detailu (včetně čidel z historie). */
function diveTagsOfMeta(metas: Meta[], m: Meta, th: Parameters<typeof cellDiveWarnings>[2]): DiveTag[] {
  const idx = metas.findIndex((x) => x.id === m.id);
  const cw = idx >= 0 ? cellDiveWarnings(metas, idx, th) : [];
  const hi = po2HiLevel(m.sum, th);
  return diveTagsOf([...(m.warns || []), ...cw, ...(hi ? [{ level: hi, title: "Vysoké pO₂ (vlastní detekce)" }] : [])]);
}

/** Nejzávažnější úroveň tagů pro rámeček kompaktního řádku. */
function rowLevel(tags: DiveTag[]): string {
  return tags.some((t) => t.level === "bad") ? "lvl-bad" : tags.length ? "lvl-warn" : "";
}

/** Návrhy lokality a parťáků z logů ostatních ke stejnému ponoru – každé jméno s nabídkou Akce. */
function SuggestCard({ meta }: { meta: Meta }) {
  const st = useStore();
  const [sg, setSg] = useState<Suggest[]>([]);
  useEffect(() => { suggestionsFor(meta).then(setSg); }, [meta.id, st.lb.notes[meta.id]?.updated, st.lb.aliases, st.lb.buddies, st.lb.sites, st.guestRev]);
  const note = st.lb.notes[meta.id];
  // lokalita: nepropojenou nabídnout vždy (jde ji propojit), propojenou jen když ponor lokalitu nemá
  const items = sg.map((x) => ({ ...x, site: x.site && (!x.site.mine || (!note?.siteId && x.site.mine !== ME)) ? x.site : null })).filter((x) => x.site || x.buddies.length);
  if (!items.length) return null;
  return (
    <Card title="Z logů ostatních">
      {items.map((x) => (
        <div key={x.who} className="suggest">
          <small className="muted">{x.who} má u tohoto ponoru zapsáno:</small>
          {x.site && <ForeignRow kind="site" v={x.site} who={x.who} diveId={meta.id} />}
          {x.buddies.map((b) => <ForeignRow key={b.name} kind="buddy" v={b} who={x.who} diveId={meta.id} />)}
        </div>
      ))}
    </Card>
  );
}

/** Jedno jméno z cizího logu: tučně, vpravo Akce (To je…, přidat k ponoru, založit, To jsem já). */
function ForeignRow({ kind, v, who, diveId }: { kind: "site" | "buddy"; v: { name: string; mine: string | null }; who: string; diveId: string }) {
  const st = useStore();
  const [open, setOpen] = useState(false), [pick, setPick] = useState(false);
  const items = Object.values(kind === "site" ? st.lb.sites : st.lb.buddies);
  const mineName = v.mine ? items.find((i) => i.id === v.mine)?.name : null;
  const guess = !v.mine ? aliasGuess(kind, v.name) : null;
  const run = async (f: () => Promise<unknown>) => { setOpen(false); setPick(false); await f(); };
  return (
    <div className="fr">
      <div className="fr-h">
        <span className="fr-n">{kind === "site" ? "📍 " : ""}<b>{v.name}</b>{mineName && mineName !== v.name ? <small className="muted"> → {mineName}</small> : null}</span>
        <button className={"btn small act" + (open ? " on" : "")} onClick={() => { setOpen(!open); setPick(false); }}>Akce ▾</button>
      </div>
      {open && <div className="actmenu">
        {guess && <button onClick={() => run(() => adoptForeign(kind, v.name, guess.id, undefined, who))}>To je {guess.name}?</button>}
        {!v.mine && <button onClick={() => { setOpen(false); setPick(true); }}>To je…</button>}
        <button onClick={() => run(() => applySuggestion(diveId, kind, v.name, who))}>{mineName ? `Přidat ${mineName} k ponoru` : "Přidat k ponoru"}</button>
        {!v.mine && <button onClick={() => run(() => adoptForeign(kind, v.name, null, undefined, who))}>{kind === "site" ? "Založit jako novou lokalitu" : "Založit jako nového parťáka"}</button>}
        {!v.mine && kind === "buddy" && <button onClick={() => run(() => adoptForeign(kind, v.name, ME, undefined, who))}>To jsem já</button>}
      </div>}
      {pick && <Picker items={items.map((i) => ({ id: i.id, name: i.name }))} placeholder={kind === "site" ? "Vyber mou lokalitu" : "Vyber mého parťáka"}
        onPick={(id) => run(() => adoptForeign(kind, v.name, id, undefined, who))} onCreate={() => run(() => adoptForeign(kind, v.name, null, undefined, who))} />}
    </div>
  );
}

/** Lokalita, buddy a poznámka cizího logu – jen k přečtení (ze Shearwater Cloud). */
function GuestNote({ note }: { note: DiveNote }) {
  const lb = useStore().lb;
  const site = note.siteId ? lb.sites[note.siteId]?.name : null;
  const buddies = note.buddyIds.map((b) => lb.buddies[b]?.name).filter(Boolean);
  return (
    <Card title="Logbook (ze Shearwater Cloud)">
      <p>📍 {site || <span className="muted">lokalita nezadaná</span>}</p>
      {buddies.length > 0 && <p>S kým: {buddies.join(", ")}</p>}
      {note.note && <p className="pre">{note.note}</p>}
      <p className="note">Cizí log je jen k prohlížení.</p>
    </Card>
  );
}

/** Zátěž (rychlost spotřeby O₂ ve smyčce) s CO₂ a hustota plynu. */
function EffortCard({ d }: { d: Dive }) {
  const s = d.s;
  const w = useMemo(() => workloadIndex(d), [d]);
  const dens = useMemo(() => gasDensity(d), [d]);
  const ef = useMemo(() => effortOf(d), [d]);
  const vents = useMemo(() => dilVents(d), [d]);
  const hasCo2 = s.co2.some((v) => v != null && v > 0);
  return (
    <Card title="Zátěž a dechová práce">
      <LineChart t={s.t} marks={vents.map((t) => ({ t, color: "#cfd8dc" }))} series={[
        { label: "Zátěž (1 = obvyklá)", color: "#ffb74d", values: w, unit: "×", width: 2 },
        ...(hasCo2 ? [{ label: "CO₂", color: "#ef5350", values: s.co2, unit: "mbar", right: true }] : []),
      ]} extra={[{ label: "Hloubka", values: s.depth, unit: "m" }]} />
      <p className="note">Zátěž = rychlost poklesu pO₂ mezi dávkami O₂ při stálé hloubce (okno 3 min), úměrná spotřebě O₂, tedy námaze. Je relativní: 1 = obvyklá úroveň v tomto ponoru, normalizovaná zvlášť pro nízký a vysoký setpoint (regulace se liší). {ef.wHighMin >= 1 ? `Nad 1,3× obvyklé úrovně ${Math.round(ef.wHighMin)} min.` : ""} Šedé čárky dole = upouštění smyčky / vyfukování masky ({vents.length}×).</p>
      <LineChart t={s.t} height={150} series={[
        { label: "Hustota plynu", color: "#4fc3f7", values: dens, unit: "g/l", width: 2 },
        { label: "5,2 g/l", color: "#ffb74d", values: s.t.map(() => 5.2), unit: "g/l", dash: "4 3" },
        { label: "6,2 g/l", color: "#ef5350", values: s.t.map(() => 6.2), unit: "g/l", dash: "4 3" },
      ]} />
      <p className="note">Hustota plynu ve smyčce. Nad 5,2 g/l roste dechová práce a riziko hromadění CO₂, nad 6,2 g/l výrazně. Max. {num(ef.densMax, 1)} g/l, nad 5,2 g/l {Math.round(ef.densOver52)} min.</p>
      {ef.co2Notes.map((c, i) => <p key={i} className={"small c-" + c.level}>• {c.text}</p>)}
    </Card>
  );
}

function SpTile({ meta }: { meta: Meta }) {
  const up = meta.sum.sp.find((c) => c.to >= 1);
  const man = meta.sum.sp.filter((c) => c.manual).length;
  return <span className="use">{up ? `${fmtSp(up.to)} v ${Math.round(up.t / 60)}. min` : "beze změny"}<small>{up ? `${num(up.depth)} m · ` : ""}{meta.sum.sp.length}× přepnuto{man ? `, ${man}× ručně` : ""}</small></span>;
}

/** Dvě hodnoty v jedné dlaždici: vlevo a vpravo, každá s malým popiskem. */
function Pair({ l, ll, r, rl }: { l: React.ReactNode; ll: string; r: React.ReactNode; rl: string }) {
  return <span className="pair"><span>{l}<small>{ll}</small></span><span className="r">{r}<small>{rl}</small></span></span>;
}

export function GasChips({ mixes }: { mixes: string[] }) {
  return <span className="gas-chips">{mixes.map((m) => { const g = gasLabel(m); return <span key={m} className={"gchip " + g.cls}>{g.label}</span>; })}</span>;
}

const EXT_KINDS: Record<string, number> = { S80: 11.1, S40: 5.7 };
const fmtL = (l: number) => `${Math.round(l)} l`;

/** Osobní rychlost spotřeby O₂ (l/min) z ponorů se známou spotřebou: měřený tlak vlastní lahve nebo zadaná externí lahev. */
export function personalO2Rate(metas: Meta[], notes: Record<string, DiveNote>, cylO2: number): { lo: number; hi: number; n: number } | null {
  const rates: number[] = [];
  for (const m of metas) {
    const min = m.h.diveTimeS / 60;
    if (min < 15) continue;
    const n = notes[m.id];
    if (n?.useManual?.o2 != null) { rates.push(n.useManual.o2 / min); continue; }
    const own = m.sum.o2Use.ok && !m.sum.o2Use.noisy ? m.sum.o2Use.bar * cylO2 : 0;
    const ext = (n?.ext || []).filter((e) => e.gas === "o2" && e.start != null && e.end != null).reduce((a, e) => a + Math.max(0, e.start! - e.end!) * e.vol, 0);
    // vlastní lahev musí být měřená celý ponor (bez externího plynu), nebo musí být zadaná externí lahev
    if ((own && !m.sum.o2Use.ext.length) || ext) rates.push((own + ext) / min);
  }
  const ok = rates.filter((r) => r > 0.4 && r < 3);
  if (ok.length < 2) return null;
  return { lo: Math.min(...ok) * 0.95, hi: Math.max(...ok) * 1.05, n: ok.length };
}

/** Spotřeba plynu ponoru: vlastní lahev (z průběhu tlaku) + externí lahve, nebo ruční údaj. */
function gasUseOf(gas: "dil" | "o2", meta: Meta, note: DiveNote | undefined, vol: number, rate?: { lo: number; hi: number; n: number } | null) {
  const u = gas === "dil" ? meta.sum.dilUse : meta.sum.o2Use;
  const manual = note?.useManual?.[gas];
  const ext = (note?.ext || []).filter((e) => e.gas === gas);
  const extL = ext.reduce((a, e) => a + (e.start != null && e.end != null ? Math.max(0, e.start - e.end) * e.vol : 0), 0);
  const ownL = u.ok && !u.noisy ? u.bar * vol : null;
  const min = meta.h.diveTimeS / 60;
  const metab = rate ? [rate.lo * min, rate.hi * min] as const : [0.8 * min, 1.5 * min] as const;
  return { u, manual, ext, extL, ownL, total: manual ?? (ownL != null || extL ? (ownL || 0) + extL : null), min, metab, personal: !!rate };
}

/** Externí plyn: snímač ukazuje mezitlak, tlak během ponoru výrazně vzrostl, nebo je zadaná externí lahev. */
const extDetected = (u: Meta["sum"]["dilUse"]) => !u.ok || u.ext.length > 0;
export const hasExt = (meta: Meta, note: DiveNote | undefined, gas: "dil" | "o2") =>
  extDetected(gas === "dil" ? meta.sum.dilUse : meta.sum.o2Use) || (note?.ext || []).some((e) => e.gas === gas);

function UseTile(props: { gas: "dil" | "o2"; meta: Meta; note?: DiveNote }) {
  const g0 = gasUseOf(props.gas, props.meta, props.note, 3);
  const ext = extDetected(g0.u) || g0.ext.length > 0;
  return <>{ext && <span className="extflag">EXT</span>}<UseVal {...props} /></>;
}

function UseVal({ gas, meta, note }: { gas: "dil" | "o2"; meta: Meta; note?: DiveNote }) {
  const st = useStore();
  const vol = st.lb.settings.cyl?.[gas] ?? 3;
  const rate = gas === "o2" ? personalO2Rate(st.metas, st.lb.notes, st.lb.settings.cyl?.o2 ?? 3) : null;
  const g = gasUseOf(gas, meta, note, vol, rate);
  if (g.manual != null) return <span className="use">{fmtL(g.manual)}<small>zadáno ručně</small></span>;
  if (g.total != null) return (
    <span className="use">{fmtL(g.total)}<small>{g.u.ok && !g.u.noisy ? `${g.u.bar} bar · ` : ""}{num(g.total / g.min, 1)} l/min{g.extL ? ` · ext. ${fmtL(g.extL)}` : ""}</small></span>
  );
  if (gas === "o2") return <span className="use">~{Math.round(g.metab[0])}–{Math.round(g.metab[1])} l<small>{g.u.noisy ? "tlak nespolehlivý · " : ""}{g.personal ? "osobní odhad" : "odhad z doby"}</small></span>;
  return <span className="use">–<small>{g.u.noisy ? "tlak nespolehlivý" : "zadej tlak externí lahve"}</small></span>;
}

function GasUseCard({ id, meta, note }: { id: string; meta: Meta; note?: DiveNote }) {
  const st = useStore();
  const cyl = st.lb.settings.cyl || { dil: 3, o2: 3 };
  const ext = note?.ext || [];
  const save = (p: Partial<DiveNote>) => setNote(id, p);
  const setExt = (eid: string, p: Partial<ExtGas>, virt?: ExtGas) => save({ ext: virt && !ext.some((e) => e.id === eid) ? [...ext, { ...virt, ...p, id: uid() }] : ext.map((e) => (e.id === eid ? { ...e, ...p } : e)) });
  const n = (v: string) => { const x = parseFloat(v.replace(",", ".")); return Number.isNaN(x) ? undefined : x; };
  const rate = personalO2Rate(st.metas, st.lb.notes, cyl.o2);
  const row = (gas: "dil" | "o2", name: string) => {
    const g = gasUseOf(gas, meta, note, cyl[gas], gas === "o2" ? rate : null);
    const u = g.u;
    return (
      <div className="pcell ptile">
        <div className="pcell-h"><b>{name}</b><span className="muted">vlastní lahev {num(cyl[gas], 1)} l</span></div>
        <small>{u.ok ? <>Tlak {num(u.start ?? 0, 0)} → {num(u.end ?? 0, 0)} bar · spotřeba {u.noisy ? "nespolehlivá (rozkmitaný tlak)" : `${u.bar} bar = ${fmtL(u.bar * cyl[gas])}`}</>
          : <>Plyn z externí lahve ({gas === "o2" ? "S40" : "S80"}) – snímač ukazuje jen mezitlak. Zadej tlak start/end externí lahve.{gas === "o2" ? (rate
            ? ` Do té doby osobní odhad ${Math.round(g.metab[0])}–${Math.round(g.metab[1])} l (tvoje spotřeba ${num(rate.lo, 2)}–${num(rate.hi, 2)} l/min z ${rate.n} ponorů se známou spotřebou).`
            : ` Do té doby obecný metabolický odhad ${Math.round(g.metab[0])}–${Math.round(g.metab[1])} l (0,8–1,5 l/min; osobní odhad bude po 2 ponorech se známou spotřebou O₂).`) : ""}</>}</small>
        {u.ext.length > 0 && <small className="c-warn">Externí plyn nebo zavřená lahev nejspíš: {u.ext.map(([a, b]) => (a === b ? `${a}. min` : `${a}.–${b}. min`)).join(", ")}</small>}
        {(() => {
          const mine = ext.filter((e) => e.gas === gas);
          const kind = gas === "dil" ? "S80" : "S40";
          const virt: ExtGas | null = !mine.length && extDetected(u) ? { id: "auto-" + gas, gas, kind, vol: EXT_KINDS[kind] } : null;
          return st.guest ? [] : virt ? [virt] : mine;
        })().map((e) => (
          <div key={e.id} className="ext-row">
            <select value={e.kind} onChange={(ev) => setExt(e.id, { kind: ev.target.value, vol: EXT_KINDS[ev.target.value] ?? e.vol }, e)}>
              {["S80", "S40", "jiná"].map((k) => <option key={k}>{k}</option>)}
            </select>
            <input inputMode="decimal" defaultValue={e.vol} title="Objem (l)" onBlur={(ev) => n(ev.target.value) !== e.vol && setExt(e.id, { vol: n(ev.target.value) ?? e.vol }, e)} /><span>l</span>
            <input inputMode="decimal" defaultValue={e.start ?? ""} placeholder="start bar" onBlur={(ev) => n(ev.target.value) !== e.start && setExt(e.id, { start: n(ev.target.value) }, e)} />
            <input inputMode="decimal" defaultValue={e.end ?? ""} placeholder="end bar" onBlur={(ev) => n(ev.target.value) !== e.end && setExt(e.id, { end: n(ev.target.value) }, e)} />
            <button className="btn small" onClick={() => save({ ext: ext.filter((x) => x.id !== e.id) })}>✕</button>
          </div>
        ))}
        {!st.guest && <div className="row">
          <button className="btn" onClick={() => { const kind = gas === "dil" ? "S80" : "S40"; save({ ext: [...ext, { id: uid(), gas, kind, vol: EXT_KINDS[kind] }] }); }}>+ Externí lahev</button>
          <label className="inline">Ručně (l)<input inputMode="decimal" defaultValue={note?.useManual?.[gas] ?? ""} placeholder="–"
            onBlur={(ev) => save({ useManual: { ...note?.useManual, [gas]: n(ev.target.value) } })} /></label>
        </div>}
      </div>
    );
  };
  return (
    <Card title="Spotřeba plynu">
      {row("dil", "Diluent")}
      {row("o2", "O₂")}
      <p className="note">Spotřeba z vlastní lahve = součet poklesů tlaku (malé nárůsty z ohřátí se odečtou, větší nárůst nebo mezitlak = externí plyn). Externí lahev Petrel neměří – zadej typ a tlak start/end. Ruční údaj má přednost. Objemy vlastních lahví nastavíš v Nastavení.</p>
    </Card>
  );
}

function DiveTitle({ id }: { id: string }) {
  const st = useStore();
  const lb = st.lb;
  const meta = st.metas.find((m) => m.id === id);
  const note = lb.notes[id];
  const site = note?.siteId ? lb.sites[note.siteId] : null;
  const buddies = (note?.buddyIds || []).map((b) => lb.buddies[b]?.name).filter(Boolean);
  const [sug, setSug] = useState<{ name: string; who: string } | null>(null);
  useEffect(() => {
    setSug(null);
    if (site || !meta || st.guest) return;
    suggestionsFor(meta).then((x) => { const g = x.find((y) => y.site); if (g?.site) setSug({ name: g.site.mine ? lb.sites[g.site.mine]?.name || g.site.name : g.site.name, who: g.who }); });
  }, [id, site?.id, st.guest, st.guestRev, lb.aliases]);
  if (!site && !sug) return null;
  return (
    <div className="dive-title">
      {site ? <h2 onClick={() => { if (!st.guest) go({ t: "site", id: site.id }); }}>{site.name}</h2> : <h2 className="sugg"><i>{sug!.name}</i> <small>· z logu {sug!.who}</small></h2>}
      <small>{meta ? fmtDate(meta.start) : ""}{buddies.length ? ` · ${buddies.join(", ")}` : ""}</small>
    </div>
  );
}

/** Části spojeného ponoru (víc záznamů počítače) a ruční spojení / rozdělení. */
function PartsCard({ meta }: { meta: Meta }) {
  const gapMin = useStore().lb.settings.segGap ?? 30;
  const vm = viewMetas(), i = vm.findIndex((m) => m.id === meta.id), next = vm[i + 1];
  const ps = meta.parts;
  const mm = (s: number) => `${Math.round(s / 60)} min`;
  const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
  const canJoin = next && (next.h.serial || 0) === (meta.h.serial || 0) && next.start - (meta.parts ? meta.parts[meta.parts.length - 1] : meta).start < 6 * 3600;
  if (!ps && !canJoin) return null;
  return (
    <Card title={ps ? `Ponor z ${ps.length} částí` : "Části ponoru"}>
      {ps && ps.map((p, k) => (
        <div key={p.id} className="row between">
          <span className="small">{k + 1}. část {hhmm(p.start)} · {mm(p.h.diveTimeS)} · max {num(p.h.maxDepth)} m{k > 0 ? ` · po ${mm(p.start - (ps[k - 1].start + ps[k - 1].h.diveTimeS))} na hladině` : ""}</span>
          {k > 0 && <button className="btn small" onClick={() => setSegOverride(p.id, false)}>Oddělit</button>}
        </div>
      ))}
      {canJoin && <button className="btn small" onClick={() => setSegOverride(next.id, true)}>Spojit s následujícím ponorem ({hhmm(next.start)})</button>}
      <p className="note">Záznamy se stejným číslem ponoru z Cloudu nebo s povrchovým intervalem do {gapMin} min se spojují automaticky (Nastavení → Výbava).</p>
    </Card>
  );
}

function LogTab({ id, d }: { id: string; d: Dive | null }) {
  const st = useStore();
  const lb = st.lb;
  const meta = viewMetas().find((m) => m.id === id) || st.metas.find((m) => m.id === id)!;
  const note = lb.notes[id] || { buddyIds: [], note: "", updated: 0 };
  const idx = st.metas.findIndex((m) => m.id === id);
  const warns = mergeCellAlerts([...(d ? diveWarnings(d, summarize(d), lb.settings.th) : []), ...cellDiveWarnings(st.metas, idx, lb.settings.th)]);
  return (
    <>
      {meta.comp && <div className="comp-line small muted">Z počítače {compModel(meta.comp)}{meta.alt && <> · <span className="pill">2 počítače</span> <a onClick={() => go({ t: "cmp", id: meta.id, other: meta.alt! })}>Srovnání počítačů ›</a></>}</div>}
      {groupAlerts(warns.filter((a) => a.level !== "info")).map((a, i) => <AlertBox key={i} a={a} fold />)}
      <PartsCard meta={meta} />
      <Card title="V kostce" right={<GasChips mixes={meta.sum.gases.map((g) => g.mix)} />}>
        <Tiles cols={2} cls={{ "Max. pO₂": meta.sum.ppo2Max > (lb.settings.th.po2HiBad ?? 1.6) ? "bad" : po2HiLevel(meta.sum, lb.settings.th) === "warn" ? "hot" : "", "Max. pN₂": meta.sum.pn2Max > (lb.settings.th.pn2Hot ?? 3.16) ? "hot" : "", "Hustota plynu": meta.sum.densMax > 5.2 ? "hot" : "" }} items={[
          ["Hloubka", <Pair l={`${num(meta.h.maxDepth)} m`} ll="max" r={`${num(meta.sum.avgDepth)} m`} rl="průměr" />],
          ["Doba", <Pair l={`${Math.round(meta.h.diveTimeS / 60)} min`} ll="ponor" r={meta.sum.decoMin ? `${meta.sum.decoMin} min` : "–"} rl="deko" />],
          ["Plyny", <span className="gas-list">{meta.sum.gases.map((g) => <span key={g.mix}><b>{gasLabel(g.mix).label}</b><small>{Math.round(g.s / 60)} min</small></span>)}</span>],
          ["Teplota", <Pair l={`${meta.sum.tempMin} °C`} ll="min" r={`${meta.sum.tempMax} °C`} rl="max" />],
          ["Max. pO₂", `${num(meta.sum.ppo2Max, 2)} bar`],
          ["Max. pN₂", `${num(meta.sum.pn2Max, 2)} bar`],
          ["Max. CO₂", meta.sum.co2Max != null ? `${num(meta.sum.co2Max, 2)} mbar` : "–"],
          ["GF / CNS", <Pair l={`${meta.h.gfLo}/${meta.h.gfHi}`} ll="GF" r={`${meta.h.cnsEnd} %`} rl="CNS" />],
          ["Diluent", <UseTile gas="dil" meta={meta} note={note} />], ["O₂", <UseTile gas="o2" meta={meta} note={note} />],
          ["Baterie", <Pair l={`${meta.h.batVStart.toFixed(2).replace(".", ",")} V`} ll="start" r={`${meta.h.batVEnd.toFixed(2).replace(".", ",")} V`} rl="end" />],
          ["Scrubber zbývá", hm(meta.h.scrubLeftEndMin)],
          ["Dávkování O₂", <Pair l={meta.sum.dose.sol} ll="solenoid" r={meta.sum.dose.man} rl="ručně" />],
          ["Setpoint", <SpTile meta={meta} />],
          ["Hustota plynu", <span className="use">{num(meta.sum.densMax, 1)} g/l<small>max · hranice 5,2 / 6,2</small></span>],
          ["Upouštění smyčky", <span className="use">{meta.sum.vents}×<small>diluent bez klesání</small></span>],
        ]} />
      </Card>
      {d ? <ProfileCard d={d} /> : <p className="muted center">Dekóduji…</p>}
      {!st.guest && <SuggestCard meta={meta} />}
      {st.guest ? <GuestNote note={note} /> : <NoteEditor note={note} onChange={(p) => setNote(id, p)} />}
      <GasUseCard id={id} meta={meta} note={note} />
      <BuddyDivesCard meta={meta} />
      {st.guest && <button className="btn danger guest-del" onClick={async () => {
        if (!await ask("Smazat tento ponor z cizího logu? Při dalším importu stejného souboru se znovu přidá.", { danger: true, ok: "Smazat" })) return;
        const n = await deleteGuestDives(partIds(meta)); toast(`Smazáno ponorů: ${n}`); back();
      }}>Smazat ponor z cizího logu</button>}
    </>
  );
}

function ProfileCard({ d }: { d: Dive }) {
  const s = d.s;
  const [btns, setBtns] = useState(false);
  const stops = useMemo(() => realStops(d), [d]);
  const first = stops.findIndex((v) => v != null);
  const lastStop = stops.length - 1 - [...stops].reverse().findIndex((v) => v != null);
  // tenká spojnice mezi úseky skutečných zastávek (hloubka zastávky podle počítače)
  const link = useMemo(() => s.stop.map((v, i) => (first >= 0 && i >= first && i <= lastStop && v > 0 ? v : null)), [d]);
  const segs = useMemo(() => gasSegments(d).map((g) => ({ ...g, color: GAS_COLOR[gasLabel(g.mix).cls], label: gasLabel(g.mix).label })), [d]);
  const gasAt = useMemo(() => s.o2.map((o, i) => gasLabel(`${o}/${s.he[i]}`).label), [d]);
  return (
    <Card title="Profil a dekompresní strop">
      <LineChart t={s.t} invert height={220} bands={((d as Dive & { surf?: { from: number; to: number }[] }).surf || []).map((b) => ({ ...b, color: "#90a4ae" }))} series={[
        { label: "Hloubka", color: C[0], values: s.depth, unit: "m", width: 2 }, { label: "Strop", color: C[5], values: s.ceil, unit: "m", fillUp: true },
        { label: "", color: C[1], values: link, width: 1 },
        { label: "Zastávka", color: C[1], values: stops, unit: "m", width: 3 },
      ]} vlines={first >= 0 ? [{ t: s.t[first], to: stops[first]!, color: C[1] }] : undefined} strip={segs} pins={spPins(d)} marks={btns ? d.buttons.filter((b) => b.t >= 0 && b.t <= d.h.diveTimeS).map((b) => ({ t: b.t, color: b.btn === 2 ? "#ffb74d" : "#b0bec5" })) : undefined} extra={[{ label: "Plyn", values: gasAt }, { label: "Teplota", values: s.temp, unit: "°C" }, { label: "pO₂", values: s.ppo2, unit: "bar" }, { label: "TTS", values: s.tts, unit: "min" }]} />
      <p className="note">Zastávka = úseky, kdy jsi byl na dekompresní zastávce (nejvýš 3 m pod její hloubkou). Vyplněná plocha nad stropem je zakázaná zóna. Barevný pruh dole = použitý plyn. Svislé čárkované značky SP = přepnutí setpointu (? = bez potvrzené obsluhy Petrelu).
        {d.buttons.length > 0 && <> <label className="inline"><input type="checkbox" checked={btns} onChange={(e) => setBtns(e.target.checked)} /> stisky tlačítek</label></>}</p>
    </Card>
  );
}

function ChartsTab({ d }: { d: Dive }) {
  const s = d.s;
  const [cellMode, setCellMode] = useState<"cal" | "mv">("cal");
  const cal = useMemo(() => cellCalibration(d), [d]);
  const doses = useMemo(() => o2Doses(d), [d]);
  const vrate = useMemo(() => s.depth.map((_, i) => {
    const a = Math.max(0, i - 3), b = Math.min(s.t.length - 1, i + 3);
    return s.t[b] === s.t[a] ? 0 : +(-(s.depth[b] - s.depth[a]) / (s.t[b] - s.t[a]) * 60).toFixed(1);
  }), [d]);
  const cells = [s.mv1, s.mv2, s.mv3].map((mv, k) => cellMode === "mv" ? mv : mv.map((v) => (cal[k] ? +(v * cal[k]!).toFixed(2) : null)));
  const hasHe = d.tissues.some((x) => x.he.some((v) => v > 0.02));
  const depthExtra: { label: string; values: (number | null)[]; unit: string }[] = []; // hloubku ukazuje linka profilu
  const st = useStore(), th = st.lb.settings.th;
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  // typ čidla z Výbavy (čidlo na dané pozici v den ponoru)
  const day = new Date(d.h.start * 1000).toISOString().slice(0, 10);
  const cellName = (k: number) => { const c = Object.values(st.lb.cells).find((x) => x.pos === k && x.installed <= day && (!x.removed || x.removed >= day)); const n = c ? (c.type || c.maker || "").trim() : ""; return `Čidlo ${k}${n ? ` (${n})` : ""}`; };
  const hz = useMemo(() => po2HighZones(d, th), [d, th]);
  const spread = cellSpread(d);
  const po2Bands = [
    ...d.alarms.filter((a) => a.kind === "po2high" || a.kind === "po2low").map((a) => ({ from: a.start, to: a.end, color: a.kind === "po2high" ? "#ef5350" : "#ffb74d", label: `Alarm z počítače: ${a.kind === "po2high" ? "vysoké" : "nízké"} pO₂` })),
    ...hz.map((z) => ({ from: z.from, to: z.to, color: z.level === "bad" ? "#ff1744" : "#ffee58", label: z.level === "bad" ? `pO₂ nad ${fmtSp(th.po2HiBad ?? 1.6)} bar (max ${fmtSp(+z.max.toFixed(2))})` : `pO₂ nad ${fmtSp(th.po2HiWarn ?? 1.4)} bar mimo deko (max ${fmtSp(+z.max.toFixed(2))})` })),
    ...(spread?.bands || []).map((b) => ({ ...b, to: b.to + 5, color: "#26a69a", label: "Čidla se rozcházejí (nad 0,3 bar)" })),
    ...((d as Dive & { surf?: { from: number; to: number }[] }).surf || []).map((b) => ({ ...b, color: "#90a4ae", label: "Hladina" })),
  ];
  const usedBands = [
    ...(d.alarms.some((a) => a.kind === "po2high") ? [{ color: "#ef5350", label: "alarm vysokého pO₂" }] : []),
    ...(d.alarms.some((a) => a.kind === "po2low") ? [{ color: "#ffb74d", label: "alarm nízkého pO₂" }] : []),
    ...(hz.some((z) => z.level === "warn") ? [{ color: "#ffee58", label: `nad ${fmtSp(th.po2HiWarn ?? 1.4)} bar mimo deko` }] : []),
    ...(hz.some((z) => z.level === "bad") ? [{ color: "#ff1744", label: `nad ${fmtSp(th.po2HiBad ?? 1.6)} bar` }] : []),
    ...(spread?.bands?.length ? [{ color: "#26a69a", label: "rozjetá čidla" }] : []),
    ...((d as Dive & { surf?: unknown[] }).surf?.length ? [{ color: "#90a4ae", label: "hladina" }] : []),
  ];
  return (
    <ZoomCtx.Provider value={{ z: zoom, setZ: setZoom }}>
    <ChartDefs.Provider value={{ profile: s.depth, zoom: true }}>
      <p className="note chart-hint">Grafy: posuvník jedním prstem, přiblížení roztažením dvou prstů (všechny grafy najednou), zpět dvojklepnutím nebo 1:1. Položky legendy jde zapínat a vypínat.</p>
      <ProfileCard d={d} />
      <Card title="pO₂ a čidla" right={
        <div className="seg"><button className={cellMode === "cal" ? "on" : ""} onClick={() => setCellMode("cal")}>pO₂</button><button className={cellMode === "mv" ? "on" : ""} onClick={() => setCellMode("mv")}>mV</button></div>}>
        {cellMode === "cal" ? (
          <LineChart t={s.t} toggle bandLegend={usedBands} marks={doses.map((x) => ({ t: x.t, color: DOSE_COLOR[x.kind] }))} pins={spPins(d)} bands={po2Bands} series={[
            { label: "Průměr pO₂", color: C[0], values: s.ppo2, unit: "bar", width: 2 }, { label: cellName(1), color: C[1], values: cells[0], unit: "bar", width: 1 },
            { label: cellName(2), color: C[2], values: cells[1], unit: "bar", width: 1 }, { label: cellName(3), color: C[3], values: cells[2], unit: "bar", width: 1 }, { label: "Setpoint", color: C[4], values: s.sp, unit: "bar", dash: "4 3", width: 1 },
          ]} extra={depthExtra} />
        ) : (
          <LineChart t={s.t} toggle bandLegend={usedBands} bands={po2Bands} series={[
            { label: cellName(1), color: C[1], values: cells[0], unit: "mV", width: 1 }, { label: cellName(2), color: C[2], values: cells[1], unit: "mV", width: 1 }, { label: cellName(3), color: C[3], values: cells[2], unit: "mV", width: 1 },
          ]} extra={[{ label: "Průměr pO₂", values: s.ppo2, unit: "bar" }, ...depthExtra]} />
        )}
        <p className="note">
          {cellMode === "cal" ? <>Čidla přepočtená společnou kalibrací odvozenou z průměrného pO₂ tohoto ponoru (rozdíl = jiná citlivost čidla): {cal.map((c, k) => `č. ${k + 1} ${c ? (c * 1000).toFixed(1) + " mbar/mV" : "–"}`).join(", ")}. </> : "Surové hodnoty čidel v mV. "}
          Čárky dole = nárůsty O₂ podle druhu: <span style={{ color: DOSE_COLOR.sol }}>■ solenoid (pravděpodobně) {doses.filter((x) => x.kind === "sol").length}×</span>, <span style={{ color: DOSE_COLOR.man }}>■ ručně O₂ {doses.filter((x) => x.kind === "man").length}×</span>, <span style={{ color: DOSE_COLOR.amb }}>■ ručně O₂, nebo diluent {doses.filter((x) => x.kind === "amb").length}×</span>, <span style={{ color: DOSE_COLOR.dil }}>■ diluent {doses.filter((x) => x.kind === "dil").length}×</span>. Solenoid dávkuje jen pod setpointem – nárůst nad ním je ruční. Pásma: červené = alarm vysokého pO₂ z počítače, oranžové = alarm nízkého pO₂, žluté / sytě červené = vlastní detekce vysokého pO₂, tyrkysové = čidla se rozcházejí o víc než 0,3 bar.
        </p>
      </Card>
      <EffortCard d={d} />
      <Card title="CO₂ v dýchací smyčce">
        {s.co2.some((v) => v != null && v > 0)
          ? <LineChart t={s.t} bandLegend={d.alarms.some((a) => a.kind === "co2") ? [{ color: "#ef5350", label: "alarm CO₂" }] : undefined} bands={d.alarms.filter((a) => a.kind === "co2").map((a) => ({ from: a.start, to: a.end, color: "#ef5350", label: "Alarm CO₂ z počítače" }))} series={[{ label: "ppCO₂", color: C[5], values: s.co2, unit: "mbar", width: 2 }, { label: "Hloubka", color: C[0], values: s.depth, unit: "m", right: true }]} rightInvert extra={[{ label: "Surová hodnota", values: s.co2raw }]} />
          : <p className="muted">V tomto ponoru CO₂ čidlo nic nezaznamenalo.</p>}
      </Card>
      <Card title="Dekomprese">
        <LineChart t={s.t} series={[
          { label: "NDL / zastávka", color: C[0], values: s.stopt, unit: "min" }, { label: "TTS", color: C[1], values: s.tts, unit: "min" }, { label: "@+5", color: C[2], values: s.at5, unit: "min" },
          { label: "GF99", color: C[3], values: s.gf99, unit: "%" }, { label: "CNS", color: C[4], values: s.cns, unit: "%" },
        ]} extra={depthExtra} />
      </Card>
      <Card title="Tlak v láhvích">
        <LineChart t={s.t} series={[{ label: "Diluent", color: C[0], values: s.dil, unit: "bar" }, { label: "O₂", color: C[2], values: s.o2p, unit: "bar" }]} extra={depthExtra} />
        <p className="note">Hodnota kolem 8–11 bar u O₂ odpovídá mezitlaku prvního stupně, ne tlaku v láhvi.</p>
      </Card>
      <Card title="Teplota a baterie">
        <LineChart t={s.t} series={[{ label: "Teplota", color: C[1], values: s.temp, unit: "°C" }, { label: "Baterie", color: C[4], values: s.bv, unit: "V", right: true }]} extra={depthExtra} />
      </Card>
      <Card title="Rychlost (+ = výstup)">
        <LineChart t={s.t} zero series={[{ label: "Rychlost", color: C[0], values: vrate, unit: "m/min" }]} extra={depthExtra} />
      </Card>
      <Card title="Nasycení tkání N₂">
        <TissueMap snaps={d.tissues.map((x) => ({ t: x.t, v: x.n2 }))} end={s.t[s.t.length - 1]} />
      </Card>
      {hasHe && <Card title="Nasycení tkání He"><TissueMap snaps={d.tissues.map((x) => ({ t: x.t, v: x.he }))} end={s.t[s.t.length - 1]} /></Card>}
    </ChartDefs.Provider>
    </ZoomCtx.Provider>
  );
}

function ValuesTab({ d }: { d: Dive }) {
  const h = d.h, sm = summarize(d);
  const cal = cellCalibration(d);
  return (
    <Card title="Všechny hodnoty z hlavičky a patičky">
      <p className="note">J = jisté, P = pravděpodobné, H = hypotéza.</p>
      <KV rows={[
        ["Začátek", fmtDateTime(h.start), "J"], ["Konec", fmtDateTime(h.end), "J"], ["Režim", h.mode, "J"],
        ["Povrchový interval", h.siMin == null ? ">45 dní" : `${Math.floor(h.siMin / 60)} h ${h.siMin % 60} min`, "J"],
        ["GF", `${h.gfLo}/${h.gfHi}`, "J"], ["CNS začátek / konec", `${h.cnsStart} / ${h.cnsEnd} %`, "J"],
        ["Max. strop / TTS", `${sm.ceilMax} m / ${sm.ttsMax} min`, "J"],
        ["Deko na zastávkách / v deko režimu", `${sm.decoMin} / ${sm.decoModeMin} min`, "J"], ["GF99 na konci", sm.gf99End ?? "–", "J"],
        ["Max. klesání / výstup", `${sm.descMax} / ${sm.ascMax} m/min`, "J"],
        ["Setpointy", `${h.spLo} / ${h.spHi} bar`, "P"], ["OC plyny", h.ocGases.join(", ") || "–", "J"], ["Diluenty", h.ccGases.join(", ") || "–", "P"],
        ["pO₂ min / max", `${sm.ppo2Min} / ${sm.ppo2Max} bar`, "J"],
        ["Citlivost čidel (odvozená)", cal.map((c) => (c ? (c * 1000).toFixed(1) : "–")).join(" / ") + " mbar/mV", "P"],
        ["Max. ppCO₂", sm.co2Max != null ? `${sm.co2Max} mbar` : "–", "P"],
        ["Teplota min / max", `${sm.tempMin} / ${sm.tempMax} °C`, "J"],
        ["Atmosférický tlak", `${h.surfP} → ${h.surfPEnd} mbar`, "J"], ["Salinita", `${h.salinity} kg/m³`, "J"],
        ["Baterie", h.batType, "P"], ["Napětí začátek / min / konec", `${h.batVStart.toFixed(2)} / ${sm.batVMin.toFixed(2)} / ${h.batVEnd.toFixed(2)} V`, "P"],
        ["Baterie %", `${h.batPctStart} → ${h.batPctEnd} %`, "P"], ["Prahy varování / kritický", `${h.batWarn} / ${h.batCrit} V`, "H"],
        ["Scrubber celkem", hm(h.scrubTotalMin), "P"], ["Scrubber zbývá na začátku / na konci", `${hm(h.scrubLeftStartMin)} / ${hm(h.scrubLeftEndMin)}`, "P"],
        ["Diluent začátek / konec", `${num(sm.dilStart, 0)} / ${num(sm.dilEnd, 0)} bar`, "J"], ["O₂ začátek / konec", `${num(sm.o2Start, 0)} / ${num(sm.o2End, 0)} bar`, "J"],
        ["Doba zapnutí počítače", `${h.onTimeH} h`, "P"], ["Verze logu", h.logVersion, "P"], ["Vzorkování", `${h.rateS} s`, "J"],
        ["Sériové číslo", h.serial.toString(16).toUpperCase(), "J"], ["Vzorků / snímků tkání", `${d.s.t.length} / ${d.tissues.length}`],
      ]} />
    </Card>
  );
}

/** Varování zobrazená na počítači a jak byla potvrzena. */
function CompWarnCard({ d }: { d: Dive }) {
  const ws = computerWarnings(d);
  const mmss = tpt;
  const valve = [...pressureAnalysis(d.s.t, d.s.o2p, d.h.diveTimeS).valve.map((v) => ({ ...v, g: "O₂" })), ...pressureAnalysis(d.s.t, d.s.dil, d.h.diveTimeS).valve.map((v) => ({ ...v, g: "diluent" }))].sort((a, b) => a.t - b.t);
  return (
    <Card title="Varování na počítači">
      {ws.length ? (
        <table className="kv"><thead><tr><th>Varování</th><th>Zobrazeno</th><th>Konec</th></tr></thead>
          <tbody>{ws.map((w, i) => <tr key={i}><td>{w.label}{w.c !== "✓" ? ` (${w.c})` : ""}</td><td>{mmss(w.start)}</td>
            <td>{w.how === "open" ? <span className="muted">nepotvrzeno</span> : `${w.how === "ack" ? "potvrzeno" : "zmizelo"} ${mmss(w.end!)} (${dur(w.end! - w.start)})`}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">Počítač v tomto ponoru nezapsal žádné varování.</p>}
      {valve.length > 0 && <div className="valve-list">{valve.map((v, i) => <div key={i} className="small">Onboard {v.g} {v.kind === "close" ? "zavřena (přechod na externí)" : "otevřena"} v {mmss(v.t)} ({v.from} → {v.to} bar)</div>)}</div>}
      <p className="note">Z událostí 0 (zobrazeno), 1 a 2 (potvrzeno / zmizelo). „Potvrzeno“ = pravé tlačítko na hlavní obrazovce. (P) pravděpodobný význam, (?) hypotéza.</p>
    </Card>
  );
}

function EventsTab({ d }: { d: Dive }) {
  const st = useStore(), th = st.lb.settings.th;
  const prevH = st.metas.filter((m) => m.h.serial === d.h.serial && m.h.start < d.h.start).pop()?.h;
  const bsw = batSwapInfo(prevH, d.h);
  const infos = groupAlerts([...(bsw ? [bsw] : []), ...diveWarnings(d, summarize(d), th).filter((a) => a.level === "info")]);
  return (
    <>
    {infos.length > 0 && <Card title="Informace">{infos.map((a, i) => <AlertBox key={i} a={a} fold />)}</Card>}
    <Card title="Setpoint">
      {(() => { const sp = setpointChanges(d); return sp.length ? (
        <table className="kv"><thead><tr><th>Čas</th><th>Hloubka</th><th>Setpoint</th><th>Obsluha</th></tr></thead>
          <tbody>{sp.map((c, i) => <tr key={i}><td>{Math.round(c.t / 60)}′</td><td>{num(c.depth)} m</td><td>{fmtSp(c.from)} → {fmtSp(c.to)}{c.to < 0.3 && c.depth <= 6 ? " (před výstupem)" : ""}</td><td>{c.manual ? "ručně (menu Petrelu)" : "bez potvrzené obsluhy"}</td></tr>)}</tbody>
        </table>) : <p className="muted">Setpoint se během ponoru neměnil.</p>; })()}
      <p className="note">Ruční přepnutí = levé tlačítko (menu) a pravé (potvrzení první položky) 0–25 s před změnou ve vzorcích. Ruční dávky O₂ před přepnutím na vysoký setpoint: {o2Doses(d).filter((x) => x.preSw && x.kind === "man").length}×.</p>
    </Card>
    <Card title="Ovládání počítače">
      {d.buttons.length ? <>
        <p>{d.buttons.length} stisků · menu otevřeno {d.buttons.filter((b) => b.from === 0xb3 && b.to === 0x06).length}× · mimo hlavní obrazovku {Math.round(summarize(d).offMainS / 60)} min</p>
        <table className="kv"><thead><tr><th>Čas</th><th>Tlačítko</th><th>Obrazovka</th></tr></thead>
          <tbody>{d.buttons.map((b, i) => <tr key={i}><td>{b.clock}<br /><small className="muted">{b.t < 0 ? "před ponorem" : `${Math.floor(b.t / 60)}′${String(Math.round(b.t % 60)).padStart(2, "0")}″`}</small></td><td>{BTN_NAMES[b.btn] ?? `tlačítko ${b.btn}`}</td><td>{scrName(b.from)} → {scrName(b.to)}</td></tr>)}</tbody>
        </table>
      </> : <p className="muted">Bez záznamu o ovládání.</p>}
      <p className="note">Ze záznamů 0x51. Čas = minuta:sekunda na hodinách počítače. Petrel je zapisuje v dávkách, pořadí se řadí podle času.</p>
    </Card>
    <Card title="Alarmy z počítače">
      {d.alarms.length ? (
        <table className="kv"><thead><tr><th>Alarm</th><th>Od</th><th>Do</th><th>Délka</th></tr></thead>
          <tbody>{d.alarms.map((a, i) => <tr key={i}><td>{a.label}</td><td>{Math.round(a.start / 60)}′</td><td>{Math.round(a.end / 60)}′</td><td>{dur(a.end - a.start)}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">Počítač v tomto ponoru nehlásil alarm CO₂ ani pO₂.</p>}
      <p className="note">Z událostí 9 (spuštění) a 10 (ukončení). V grafech CO₂ a pO₂ jsou alarmy vyznačené podbarvením.</p>
    </Card>
    <CompWarnCard d={d} />
    <Card title="Události v záznamu">
      <p className="note">Bez CO₂ (to je v grafu) a bez stisků tlačítek (výše). Značka (P) = pravděpodobný význam, (?) = hypotéza.</p>
      <table className="kv"><thead><tr><th>Čas</th><th>Typ</th><th>Význam / data</th></tr></thead>
        <tbody>{d.events.map((e, i) => <tr key={i}><td>{Math.round(e.t / 60)}′</td><td>{e.kind}</td><td>{e.label}<br /><code>{e.payload}</code></td></tr>)}</tbody>
      </table>
    </Card>
    </>
  );
}
