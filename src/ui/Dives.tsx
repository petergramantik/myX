import { useEffect, useMemo, useRef, useState } from "react";
import type { Dive } from "../core/shearwater";
import { BTN_NAMES, pressGaps, GAS_COLOR, dur, tpt, scrubberFill, po2HighZones, po2DilZones, po2HiLevel, cellCalibration, pressureAnalysis, cellSpread, diveWarnings, batSwapInfo, gasLabel, gasSegments, o2Doses, realStops, scrName, setpointChanges, summarize, type Alert } from "../core/analysis";
import { ME, adoptForeign, aliasGuess, compModel, deleteGuestDives, toast, nearestPair, applySuggestion, diveHeads, loadDive, myNum, ownMetas, segInfo, setNote, setSegOverride, suggestionsFor, viewMetas, type Suggest } from "../app/store";
import { cellDiveWarnings, mergeCellAlerts } from "../core/cells";
import { computerWarnings } from "../core/compwarn";
import { TAG_ORDER, diveTagsOf, isHiddenW, tagCat, withEmptiedCats, type DiveTag, type TagCat } from "../core/tags";
import { CO2_SUSPECT, norm, tankMix, tankVol, uid, type DiveNote, type ExtGas, type Meta } from "../app/model";
import { partIds, shareDives } from "./share";
import { ask, askText, choose } from "../app/dialog";
import { RIGS, hasDeco, isCC, pscrLoopPo2, supplyPo2, type Rig } from "../core/rig";
import { compName, getState, rigChoices, rigInfo, setDiveRig, typeBreakdown } from "../app/store";
import { AlertBox, Card, ClearInput, KV, Picker, RATING, Tiles, back, fmtDate, fmtDateTime, go, hm, leaveY, num, tab, useBackLayer, useStore } from "./common";
import { NoteEditor } from "./NoteEditor";
import { PrepCard } from "./Prep";
import { bailoutOf, boOpts, boTanks, noteWarns, surfGfOf, BO_SAC } from "../app/noteWarns";
import { NO_GAS, bailoutPlan, boProfile, gasLabelOf } from "../core/bailout";
import { co2BadRanges, co2Valid, dilVents, effortOf, gasDensity, workloadIndex, workloadSkip, type EffortBase } from "../core/effort";
import { BuddyDivesCard, commonDives, type Common } from "./Compare";
import { ChartDefs, LineChart, TissueMap, ZoomCtx } from "./Chart";

const C = ["#4fc3f7", "#ffb74d", "#81c784", "#ce93d8", "#fff176", "#ef5350"];

const DL0 = { q: "", rate: "", tagF: [] as TagCat[], gasF: [] as string[], onlyCommon: true, bsel: [] as string[], noBuddy: false, pickMode: false, picked: [] as string[], sort: "date" as "date" | "depth-" | "depth+" | "dur-" | "dur+" | "site" };
const dlMemo: typeof DL0 & { ctx: string | null; y: number } = { ...DL0, ctx: null, y: 0 };

/** Seznam mých ponorů rovnou ve výběru ke sdílení (z DB → Můj log). */
export function openDivesPick() { Object.assign(dlMemo, { ...DL0, ctx: "||", pickMode: true, picked: [] }); tab({ t: "dives" }); }

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
  const [sort, setSort0] = useState<typeof DL0.sort>(() => { try { return (localStorage.getItem("myx-sort") as typeof DL0.sort) || "date"; } catch { return "date"; } });
  const setSort = (v: typeof DL0.sort) => { setSort0(v); try { localStorage.setItem("myx-sort", v); } catch { /* */ } };
  const [picked, setPicked] = mem("picked");
  const endPick = () => { setPickMode(false); setPicked([]); };
  useBackLayer(pickMode, endPick);
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
  const rows0 = vm.map((m, i) => ({ m, no: i + 1, note: lb.notes[m.id] })).reverse()
    .filter(({ m, note }) => match(note, m.start) && (!st.guest || !onlyCommon || common(m)) && (!noBuddy || (!note?.buddyIds.length && !cmp.has(m.id))) && (!tagF.length || diveTagsOfMeta(st.metas, m, lb.settings.th).some((t) => tagF.includes(t.cat)))
      && (!gasF.length || gasCats(m).some((g) => gasF.includes(g))));
  // řazení v plném zobrazení: hloubka a doba v obou směrech, lokalita abecedně (uvnitř od nejnovějších), bez lokality na konec
  const siteName = (r: (typeof rows0)[number]) => (r.note?.siteId ? lb.sites[r.note.siteId]?.name : sugSite.get(r.m.id)?.name) || "";
  const rows = compact || sort === "date" ? rows0 : [...rows0].sort((a, b) => {
    switch (sort) {
      case "depth-": return b.m.h.maxDepth - a.m.h.maxDepth;
      case "depth+": return a.m.h.maxDepth - b.m.h.maxDepth;
      case "dur-": return b.m.h.diveTimeS - a.m.h.diveTimeS;
      case "dur+": return a.m.h.diveTimeS - b.m.h.diveTimeS;
      default: { const x = siteName(a), y = siteName(b); if (!x !== !y) return x ? -1 : 1; return x.localeCompare(y, "cs") || b.m.start - a.m.start; }
    }
  });
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
      {!compact && <div className="seg filter sort-row">
        <button className={sort === "date" ? "on" : ""} onClick={() => setSort("date")}>Datum</button>
        <button className={sort.startsWith("depth") ? "on" : ""} onClick={() => setSort(sort === "depth-" ? "depth+" : "depth-")}>Hloubka {sort === "depth+" ? "↑" : "↓"}</button>
        <button className={sort.startsWith("dur") ? "on" : ""} onClick={() => setSort(sort === "dur-" ? "dur+" : "dur-")}>Doba {sort === "dur+" ? "↑" : "↓"}</button>
        <button className={sort === "site" ? "on" : ""} onClick={() => setSort("site")}>Lokalita</button>
      </div>}
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
      {st.hidden.length > 0 && <p className="muted small center hidden-info">Skryto: {typeBreakdown(st.hidden).text.replace(/ – skryté, zatím nepodporováno/g, "")} – typ ponoru zatím nepodporujeme (zůstávají uložené).</p>}
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
// přechod na sousední ponor (swipe, ‹ ›) zachová otevřenou záložku
let carryTab: Tab | null = null;

export function DiveScreen({ id }: { id: string }) {
  const st = useStore();
  const [d, setD] = useState<Dive | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => { const t = carryTab ?? "log"; carryTab = null; return t; });
  const [focus, setFocus] = useState<ChartFocus | null>(null);
  useBackLayer(tab !== "log", () => { setTab("log"); window.scrollTo(0, 0); }); // Zpět ze záložky vede na začátek Logbooku
  useEffect(() => { const on = (e: Event) => { setFocus({ ...(e as CustomEvent<ChartFocus>).detail }); setTab("charts"); }; focusBus.addEventListener("focus", on); return () => focusBus.removeEventListener("focus", on); }, []);
  const [slide, setSlide] = useState("");
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { carryTab = null; setD(null); loadDive(id).then(setD).catch((e) => setErr(e.message)); }, [id]);
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
    if (dx < 0 && next) { carryTab = tab; setSlide("from-right"); go({ t: "dive", id: next.id }); }
    else if (dx > 0 && prev) { carryTab = tab; setSlide("from-left"); go({ t: "dive", id: prev.id }); }
  };
  return (
    <div className={"screen " + slide} key={id} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onAnimationEnd={() => setSlide("")}>
      <div className="dive-head">
        <button className="btn small" disabled={!prev} onClick={() => { if (prev) { carryTab = tab; setSlide("from-left"); go({ t: "dive", id: prev.id }); } }}>‹</button>
        <div><b>Ponor {myNum(id)}</b><small>{fmtDateTime(meta.start)} · v počítači #{meta.num}</small></div>
        <button className="btn small share-btn" title="Sdílet ponor" onClick={() => shareDives([meta])}>⤴</button>
        <button className="btn small" disabled={!next} onClick={() => { if (next) { carryTab = tab; setSlide("from-right"); go({ t: "dive", id: next.id }); } }}>›</button>
      </div>
      <div className="tabs">
        {([["log", "Logbook"], ["charts", "Grafy"], ["values", "Hodnoty"], ["events", "Události"]] as [Tab, string][]).map(([k, l]) =>
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <DiveTitle id={id} />
      {err && <p className="alert bad">{err}</p>}
      {tab === "log" && <LogTab id={id} d={d} />}
      {tab !== "log" && !d && !err && <p className="muted center">Dekóduji…</p>}
      {tab === "charts" && d && <ChartsTab d={d} focus={focus} />}
      {tab === "values" && d && <ValuesTab d={d} />}
      {tab === "events" && d && <EventsTab d={d} />}
    </div>
  );
}

const DOSE_COLOR = { sol: "#4fc3f7", man: "#ffb74d", amb: "#b39ddb", dil: "#cfd8dc" } as const;
const DOSE_LABEL = { sol: "solenoid (P)", man: "ručně O₂", amb: "ručně O₂ nebo diluent", dil: "diluent" } as const;
const fmtSp = (v: number) => v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
/** Značky přepnutí setpointu do grafů. */
function spPins(d: Dive) {
  return setpointChanges(d).map((c) => ({ t: c.t, label: `SP ${fmtSp(c.to)}${c.manual ? "" : "?"}`, color: c.to >= 1 ? "#ffb74d" : c.to < 0.3 ? "#b0bec5" : "#81c784" }));
}

/** Sloučí upozornění se stejným nadpisem do jednoho („Nadpis – N×“), popisy pod sebe; úroveň podle nejzávažnějšího. */
/** Osobní základ potápěče z jeho ponorů v aktuálním logu (medián): zátěž, spotřeba O₂, doplňování diluentu. */
function useEffortBase(): EffortBase | null {
  const st = useStore();
  return useMemo(() => {
    const md = (a: (number | null | undefined)[]) => { const b = a.filter((x): x is number => x != null && x > 0).sort((p, q) => p - q); return b.length >= 3 ? b[b.length >> 1] : null; };
    const ms = st.metas;
    if (ms.length < 3) return null;
    return { lo: md(ms.map((m) => m.sum.wLo)), hi: md(ms.map((m) => m.sum.wHi)), o2: md(ms.map((m) => m.sum.o2Rate)), vents: (() => { const v = ms.map((m) => m.sum.vents).sort((p, q) => p - q); return v[v.length >> 1]; })() };
  }, [st.metas]);
}

/** Odkaz z varování do grafu: přepnout na Grafy, přiblížit a ukázat místo. */
const focusBus = new EventTarget();
type ChartFocus = { chart: string; from: number; to: number };
const showInChart = (b: ChartFocus) => focusBus.dispatchEvent(new CustomEvent("focus", { detail: b }));
type GBlock = { head: string; steps: string[]; from: number; to: number; chart: string };
function groupAlerts<T extends { level: string; title: string; text: string; parts?: string[]; blocks?: GBlock[] }>(as: T[]): { level: string; title: string; text: string; parts?: string[]; blocks?: GBlock[] }[] {
  const rank: Record<string, number> = { bad: 3, warn: 2, info: 1 };
  const m = new Map<string, { level: string; title: string; text: string; parts: string[]; own?: string[]; blocks?: GBlock[] }>();
  for (const a of as) {
    const g = m.get(a.title);
    if (!g) { m.set(a.title, { level: a.level, title: a.title, text: a.text, parts: [a.text], own: a.parts, blocks: a.blocks }); continue; }
    g.parts.push(a.text);
    if ((rank[a.level] || 0) > (rank[g.level] || 0)) g.level = a.level;
  }
  return [...m.values()].map((g) => g.parts.length > 1 ? { level: g.level, title: `${g.title} – ${g.parts.length}×`, text: g.text, parts: g.parts } : { level: g.level, title: g.title, text: g.text, parts: g.own, blocks: g.blocks });
}

/** Skrýt upozornění u ponoru: jen toto, nebo celou kategorii (tag v seznamu). */
async function hideWarn(id: string, note: DiveNote, title: string, all: string[]) {
  const base = title.replace(/ – \d+×$/, ""), cat = tagCat(base);
  const k = await choose(`Skrýt u tohoto ponoru „${base}“? Nebude se počítat do hodnocení ponoru (barva a tagy v seznamu), v událostech pod grafy zůstane.`, [
    { key: "t", label: "Jen toto upozornění", primary: true },
    ...(cat ? [{ key: "c", label: `Celou kategorii ${cat}` }] : []),
  ]);
  if (!k) return;
  setNote(id, { hideW: withEmptiedCats([...new Set([...(note.hideW || []), k === "c" ? "c:" + cat : "t:" + base])], all) });
}

/** Skrytá upozornění ponoru – sbalený seznam s možností vrátit. */
function HiddenWarns({ id, note, all }: { id: string; note: DiveNote; all: string[] }) {
  const [open, setOpen] = useState(false);
  const keys = (note.hideW || []).filter((k) => !k.startsWith("x:"));
  const titles = [...new Set(all.filter((t) => isHiddenW(t, keys)))];
  if (!keys.length) return null;
  return (
    <div className="hidden-w small muted">
      <a onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} Skrytá upozornění ({titles.length || keys.length})</a>
      {open && keys.map((k) => (
        <div key={k} className="hw-row">{k.startsWith("c:") ? `kategorie ${k.slice(2)}` : k.slice(2)}{k.startsWith("t:") && !titles.some((t) => t.replace(/ – \d+×$/, "") === k.slice(2)) ? " (v ponoru teď není)" : ""}
          <button className="btn small" onClick={() => setNote(id, { hideW: withEmptiedCats(keys.filter((x) => x !== k), all) })}>Vrátit</button></div>
      ))}
    </div>
  );
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
  const cw = idx >= 0 && isCC(m.h) ? cellDiveWarnings(metas, idx, th) : []; // čidla jen u CC ponorů
  const hi = po2HiLevel(m.sum, th);
  const late = th.spLateWarn && m.sum.spLate != null && m.sum.spLate > (th.spLateMin ?? 2);
  const gs = getState(), hide = gs.lb.notes[m.id]?.hideW;
  const nw = gs.guest ? [] : noteWarns(m, gs.lb.notes[m.id], gs.lb.settings);
  return diveTagsOf([...(m.warns || []), ...cw, ...nw, ...(hi ? [{ level: hi, title: "Vysoké pO₂ (vlastní detekce)" }] : []), ...(late ? [{ level: "warn", title: "Pozdní přepnutí na vysoký setpoint" }] : [])].filter((w) => !isHiddenW(w.title, hide)));
}

/** Nejzávažnější úroveň tagů pro rámeček kompaktního řádku. */
function rowLevel(tags: DiveTag[]): string {
  return tags.some((t) => t.level === "bad") ? "lvl-bad" : tags.length ? "lvl-warn" : "lvl-ok";
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
  useBackLayer(open || pick, () => { setOpen(false); setPick(false); });
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

/** Popis grafu ve sbalovacím řádku (výchozí sbaleno, stav se pamatuje pro každý graf). */
function Desc({ k, children }: { k: string; children: React.ReactNode }) {
  const sk = "myx.desc." + k;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(sk) === "1"; } catch { return false; } });
  const set = (v: boolean) => { setOpen(v); try { localStorage.setItem(sk, v ? "1" : "0"); } catch { /* bez úložiště */ } };
  return <div className="chart-desc"><button className="ev-head" onClick={() => set(!open)}>{open ? "▾" : "▸"} Popis grafu</button>{open && children}</div>;
}

/** Barevné události pod grafem (varování a informace s odkazem do tohoto grafu), chronologicky, ve sbalovacím řádku.
 *  Klepnutí na událost nastaví posuvník; odkaz z detailu ponoru seznam rozbalí a událost zvýrazní. */
function ChartEvents({ warns, keys, focus }: { warns: Alert[]; keys: string[]; focus?: ChartFocus | null }) {
  const sk = "myx.ev." + keys[0];
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(sk) === "1"; } catch { return false; } });
  const set = (v: boolean) => { setOpen(v); try { localStorage.setItem(sk, v ? "1" : "0"); } catch { /* bez úložiště */ } };
  const mine = !!focus && (keys.includes(focus.chart));
  useEffect(() => { if (mine) setOpen(true); }, [focus]);
  const rows = warns.flatMap((a) => (a.blocks || []).filter((b) => keys.includes(b.chart)).map((b) => ({ a, b, txt: (b.head || a.text.split("\n")[0]).replace(/^\d+\. /, "") })))
    .sort((x, y) => x.b.from - y.b.from);
  if (!rows.length) return null;
  return (
    <div className="chart-ev">
      <button className="ev-head" onClick={() => set(!open)}>{open ? "▾" : "▸"} Události ({rows.length})</button>
      {open && rows.map(({ a, b, txt }, i) => (
        <p key={i} className={"small c-" + a.level + (mine && focus!.from === b.from ? " ev-on" : "")} onClick={() => showInChart(b)}><span className="ev-dot">•</span>{/^\d+′\d+″/.test(txt) ? "" : tpt(b.from) + " "}{a.title.replace(/ – \d+×$/, "")}: {txt}</p>
      ))}
    </div>
  );
}

/** CO₂ ve smyčce (hlavní údaj) se zátěží a hustotou plynu (doplňkově, pravá osa). */
/** Ruční posouzení CO₂ ponoru: porucha čidla (ze statistik ven, upozornění CO₂ skrytá) / skutečné CO₂ (i nad 20 mbar). */
function Co2Verdict({ d }: { d: Dive }) {
  const st = useStore();
  if (st.guest) return null;
  const note = st.lb.notes[d.id] || { buddyIds: [], note: "", updated: 0 };
  const max = Math.max(0, ...d.s.co2.filter((v): v is number => v != null));
  const set = (v: "fault" | "real" | undefined) => {
    const had = (note.hideW || []).includes("c:CO₂");
    if (v === "fault") {
      // skrýt upozornění CO₂ – a zapamatovat si, jestli skrytí přidala tato volba
      setNote(d.id, { co2: v, hideW: had ? note.hideW : [...(note.hideW || []), "c:CO₂"], co2Hid: had ? !!note.co2Hid : true });
    } else {
      // zrušení poruchy vrátí jen skrytí, které přidala sama (ruční skrytí zůstane)
      const hideW = note.co2Hid ? (note.hideW || []).filter((k) => k !== "c:CO₂") : note.hideW;
      setNote(d.id, { co2: v, hideW, co2Hid: undefined });
    }
  };
  return (
    <div className="co2v">
      {max > CO2_SUSPECT && !note.co2 && <small className="c-warn">Maximum {num(max, 1)} mbar je nad {CO2_SUSPECT} mbar – nejspíš porucha čidla (?).</small>}
      <div className="co2v-btns">
        <button className={"btn small" + (note.co2 === "fault" ? " on" : "")} onClick={() => set(note.co2 === "fault" ? undefined : "fault")}>Porucha čidla{note.co2 === "fault" ? " ✓" : ""}</button>
        <button className={"btn small" + (note.co2 === "real" ? " on" : "")} onClick={() => set(note.co2 === "real" ? undefined : "real")}>Skutečné CO₂{note.co2 === "real" ? " ✓" : ""}</button>
      </div>
      <p className="note">Porucha čidla: ponor se nezapočítá do statistik CO₂ a jeho upozornění CO₂ se skryjí. Skutečné CO₂: potvrdí hodnotu nad {CO2_SUSPECT} mbar jako skutečnou, aby se započítala (běžné hodnoty se počítají vždy). Opětovné klepnutí volbu zruší.</p>
    </div>
  );
}

function Co2Card({ d, focusT, warns, focus }: { d: Dive; focusT?: number; warns: Alert[]; focus?: ChartFocus | null }) {
  const s = d.s, cc = isCC(d.h); // bez čidel O₂ se zátěž z poklesu pO₂ spočítat nedá
  const base = useEffortBase();
  const w = useMemo(() => workloadIndex(d, base).map((x) => (x == null ? null : Math.min(4, x))), [d, base]);
  const skip = useMemo(() => workloadSkip(d), [d]);
  // zobrazení: posuvný průměr 2 min (bez skoků na 0 mezi dávkami); bez údaje = mezera v čáře, důvod v pruhu pod grafem
  const wSm = useMemo(() => w.map((_, i) => { if (w[i] == null) return null; let a = 0, n = 0; for (let k = i; k >= 0 && s.t[i] - s.t[k] <= 60; k--) if (w[k] != null) { a += w[k]!; n++; } for (let k = i + 1; k < w.length && s.t[k] - s.t[i] <= 60; k++) if (w[k] != null) { a += w[k]!; n++; } return n ? Math.round((a / n) * 100) / 100 : null; }), [w]);
  // mezery do 3 min přemostit (jen zobrazení, tečkovaně)
  const wBr = useMemo(() => {
    const out: (number | null)[] = Array(wSm.length).fill(null);
    let a = -1;
    for (let i = 0; i < wSm.length; i++) {
      if (wSm[i] == null) continue;
      if (a >= 0 && i - a > 1 && s.t[i] - s.t[a] <= 180) for (let k = a; k <= i; k++) out[k] = Math.round((wSm[a]! + ((wSm[i]! - wSm[a]!) * (s.t[k] - s.t[a])) / (s.t[i] - s.t[a])) * 100) / 100;
      a = i;
    }
    return out;
  }, [wSm]);
  const wTxt = useMemo(() => wSm.map((v, i) => (s.t[i] > d.h.diveTimeS ? "–" : v != null ? `${v.toLocaleString("cs-CZ")} ×` : wBr[i] != null ? `≈ ${wBr[i]!.toLocaleString("cs-CZ")} × (dopočteno)` : `– (${skip[i] || (s.depth[i] < 3 ? "u hladiny" : "klesání")})`)), [wSm, wBr, skip]);
  const ef2 = useMemo(() => effortOf(d, 5, base), [d, base]);
  const co2V = useMemo(() => co2Valid(d), [d]);
  const dens = useMemo(() => gasDensity(d), [d]);
  const ef = useMemo(() => effortOf(d), [d]);
  const vents = useMemo(() => dilVents(d), [d]);
  const hasCo2 = s.co2.some((v) => v != null && v > 0);
  const bad = co2BadRanges(d);
  return (
    <Card title={hasCo2 ? "CO₂ a dechová práce" : cc ? "Dechová práce" : "Hustota plynu"}>
      <LineChart t={s.t} focusT={focusT}
        bands={[...d.alarms.filter((a) => a.kind === "co2").map((a) => ({ from: a.start, to: a.end, color: "#ef5350", label: "Alarm CO₂ z počítače" })), ...bad.map((r) => ({ ...r, color: "#90a4ae", label: "Čidlo CO₂ nejspíš chybné" })), ...(cc ? ef2.high : []).map((h) => ({ from: h.from, to: h.to, color: "#ffb74d", label: `Zvýšená zátěž až ${h.max}×${h.co2 ? ", nárůst CO₂" : ""}` }))]}
        bandLegend={[...(d.alarms.some((a) => a.kind === "co2") ? [{ color: "#ef5350", label: "alarm CO₂" }] : []), ...(bad.length ? [{ color: "#90a4ae", label: "čidlo nejspíš chybné" }] : []), ...(cc && ef2.high.length ? [{ color: "#ffb74d", label: "zvýšená zátěž" }] : []), ]}
        marks={vents.map((t) => ({ t, color: "#ce93d8", h: 18, label: "doplnění diluentu" }))}
        series={[
          ...(hasCo2 ? [{ label: "CO₂", color: "#ef5350", values: co2V, unit: "mbar", width: 2.5 }] : []),
          ...(cc ? [{ label: "Zátěž (×)", color: "#ffb74d", values: wSm, unit: "×", width: 1.5, right: true, noTip: true },
          { label: "zátěž dopočtená", color: "#ffb74d", values: wBr, unit: "×", width: 1.5, dash: "1 3", right: true, noTip: true }] : []),
          { label: "Hustota (g/l)", color: "#4fc3f7", values: dens, unit: "g/l", width: hasCo2 || cc ? 1.2 : 2, dash: hasCo2 || cc ? "4 3" : undefined, right: hasCo2 || cc },
        ]}
        extra={[...(cc ? [{ label: "Zátěž", values: wTxt }] : []), ...(hasCo2 ? [{ label: "Surová hodnota CO₂", values: s.co2raw }] : [])]} />
      <ChartEvents warns={warns} keys={["co2", "effort"]} focus={focus} />
      <Desc k="co2"><p className="note">{hasCo2 ? <><b>CO₂</b> ve smyčce (levá osa, mbar) je hlavní údaj. </> : null}{cc ? <><b>Zátěž</b> (pravá osa) = rychlost poklesu pO₂ opravená o změnu tlaku, úměrná spotřebě O₂, tedy námaze; 1 = tvoje obvyklá úroveň (medián z tvých ponorů, zvlášť pro nízký a vysoký setpoint). Počítá se z 3min okna bez rušených vzorků (klesání, hladina, přepnutí SP a ruční dávka O₂ do ustálení pO₂, 90 s po doplnění diluentu). Při úvodním sestupu chybí vždy – ADV přidává diluent. Mezery do 3 min jsou přemostěné tečkovaně (dopočteno), delší zůstávají prázdné; důvod v pruhu pod grafem. Oranžově = zvýšená zátěž (nad 2× aspoň 3 min{ef2.high.some((h) => h.o2 != null) ? ", potvrzená spotřebou O₂ z lahve" : ""}). </> : null} <b>Hustota plynu</b> (pravá osa, g/l, čárkovaně): nad 5,2 g/l roste dechová práce a riziko hromadění CO₂, nad 6,2 g/l výrazně; max. {num(ef.densMax, 1)} g/l, nad 5,2 g/l {Math.round(ef.densOver52)} min. Fialové čárky dole = doplnění diluentu – ADV, proplach smyčky nebo masky ({vents.length}×).</p></Desc>
      {hasCo2 && <Co2Verdict d={d} />}
    </Card>
  );
}

function SpTile({ meta }: { meta: Meta }) {
  const up = meta.sum.sp.find((c) => c.to >= 1);
  const man = meta.sum.sp.filter((c) => c.manual).length;
  return <span className="use">{up ? `${fmtSp(up.to)} v ${tpt(up.t)}` : "beze změny"}<small>{up ? `${num(up.depth)} m · ` : ""}{meta.sum.sp.length}× přepnuto{man ? `, ${man}× ručně` : ""}</small></span>;
}

/** Dvě hodnoty v jedné dlaždici: vlevo a vpravo, každá s malým popiskem. */
function Pair({ l, ll, r, rl }: { l: React.ReactNode; ll: string; r: React.ReactNode; rl: string }) {
  return <span className="pair"><span>{l}<small>{ll}</small></span><span className="r">{r}<small>{rl}</small></span></span>;
}

export function GasChips({ mixes }: { mixes: string[] }) {
  return <span className="gas-chips">{mixes.map((m) => { const g = gasLabel(m); return <span key={m} className={"gchip " + g.cls}>{g.label}</span>; })}</span>;
}

const fmtL = (l: number) => `${Math.round(l)} l`;

/** Osobní rychlost spotřeby O₂ (l/min) z ponorů se známou spotřebou: měřený tlak on-board lahve nebo zadaná externí lahev. */
export function personalO2Rate(metas: Meta[], notes: Record<string, DiveNote>, cylO2: number): { lo: number; hi: number; n: number } | null {
  const rates: number[] = [];
  for (const m of metas) {
    const min = m.h.diveTimeS / 60;
    if (min < 15) continue;
    const n = notes[m.id];
    const own = m.sum.o2Use.ok && !m.sum.o2Use.noisy ? m.sum.o2Use.bar * cylO2 : 0;
    const ext = prepExt("o2", m, n).reduce((a, e) => a + Math.max(0, e.start! - e.end!) * e.vol, 0);
    // on-board lahev musí být měřená celý ponor (bez externího plynu), nebo musí být zadaná externí lahev
    if ((own && !m.sum.o2Use.ext.length) || ext) rates.push((own + ext) / min);
  }
  const ok = rates.filter((r) => r > 0.4 && r < 3);
  if (ok.length < 2) return null;
  return { lo: Math.min(...ok) * 0.95, hi: Math.max(...ok) * 1.05, n: ok.length };
}

/** Spotřeba plynu ponoru: on-board lahev (z průběhu tlaku) + externí lahve, nebo ruční údaj. */
export function gasUseOf(gas: "dil" | "o2", meta: Meta, note: DiveNote | undefined, vol: number, rate?: { lo: number; hi: number; n: number } | null) {
  const u = gas === "dil" ? meta.sum.dilUse : meta.sum.o2Use;
  // externí (off-board) lahve se zadávají jen v sekci Před a po ponoru
  const ext = prepExt(gas, meta, note);
  const extL = ext.reduce((a, e) => a + (e.start != null && e.end != null ? Math.max(0, e.start - e.end) * e.vol : 0), 0);
  const ownL = u.ok && !u.noisy ? u.bar * vol : null;
  const min = meta.h.diveTimeS / 60;
  const metab = rate ? [rate.lo * min, rate.hi * min] as const : [0.8 * min, 1.5 * min] as const;
  return { u, ext, extL, ownL, total: ownL != null || extL ? (ownL || 0) + extL : null, min, metab, personal: !!rate };
}

/**
 * Off-board lahve z předponorové přípravy jako externí plyn: O₂ lahve → O₂, Dil → diluent;
 * bailouty se stejným plynem jako diluent se počítají do diluentu jen při zjištěném externím diluentu.
 */
function prepExt(gas: "dil" | "o2", meta: Meta, note: DiveNote | undefined): ExtGas[] {
  const tanks = (note?.prep?.tanks || []).map((t) => (t.same ? { ...t, end: t.bar } : t)).filter((t) => t.bar != null && t.end != null && tankVol(t));
  const dilMix = meta.sum.gases.map((g) => g.mix).find((m) => m !== "100/0");
  const pick = tanks.filter((t) => gas === "o2" ? t.role === "o2" : t.role === "dil" || (t.role === "bo" && extDetected(meta.sum.dilUse) && (tankMix(t.gas) ?? dilMix) === dilMix));
  return pick.map((t) => ({ id: t.id, gas, kind: t.name, vol: tankVol(t)!, start: t.bar, end: t.end }));
}

/** Externí plyn: snímač ukazuje mezitlak, tlak během ponoru výrazně vzrostl, nebo je zadaná externí lahev. */
const extDetected = (u: Meta["sum"]["dilUse"]) => !u.ok || u.ext.length > 0;
export const hasExt = (meta: Meta, note: DiveNote | undefined, gas: "dil" | "o2") =>
  extDetected(gas === "dil" ? meta.sum.dilUse : meta.sum.o2Use) || prepExt(gas, meta, note).length > 0;

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
  if (g.total != null) {
    // velkým písmem bary (on-board lahev + off-board), malým spotřeba v litrech
    const bars = [g.u.ok && !g.u.noisy && g.ownL ? `${g.u.bar} bar` : "", ...g.ext.filter((e) => e.start != null && e.end != null).map((e) => `${Math.max(0, e.start! - e.end!)} bar ${e.kind}`)].filter(Boolean);
    const tk = note?.prep?.tanks || [], full = tk.length > 0 && tk.every((t) => t.bar != null && (t.same || t.end != null) && tankVol(t));
    return <span className="use">{bars.length ? bars.join(" + ") : fmtL(g.total)}<small>{full ? "skutečná · " : ""}{fmtL(g.total)} · {num(g.total / g.min, 1)} l/min</small></span>;
  }
  if (gas === "o2") return <span className="use">~{Math.round(g.metab[0])}–{Math.round(g.metab[1])} l<small>{g.u.noisy ? "tlak nespolehlivý · " : ""}{g.personal ? "osobní odhad" : "odhad z doby"}</small></span>;
  return <span className="use">–<small>{g.u.noisy ? "tlak nespolehlivý" : "zadej lahev v Před a po ponoru"}</small></span>;
}

function GasUseCard({ meta, note }: { id: string; meta: Meta; note?: DiveNote }) {
  const st = useStore();
  const cyl = st.lb.settings.cyl || { dil: 3, o2: 3 };
  const rate = personalO2Rate(st.metas, st.lb.notes, cyl.o2);
  const row = (gas: "dil" | "o2", name: string) => {
    const g = gasUseOf(gas, meta, note, cyl[gas], gas === "o2" ? rate : null);
    const u = g.u;
    // hlavní údaj: úbytek tlaku (on-board lahev + off-board) větším písmem, litry menším pod ním
    const bars = [u.ok && !u.noisy ? `${u.bar} bar` : "", ...g.ext.map((e) => `${Math.max(0, e.start! - e.end!)} bar ${e.kind}`)].filter(Boolean);
    return (
      <div className="pcell ptile">
        <div className="pcell-h"><b>{name}</b><span className="muted">on-board lahev {num(cyl[gas], 1)} l</span></div>
        <div className="use-big">{bars.length ? bars.join(" + ") : "–"}</div>
        <small>{g.total != null ? `${fmtL(g.total)} · ${num(g.total / g.min, 1)} l/min` : gas === "o2" ? `odhad ${Math.round(g.metab[0])}–${Math.round(g.metab[1])} l (${g.personal ? "osobní" : "z doby ponoru"})` : "litry spočítám po zadání lahve"}</small>
        {u.ok ? <small className="muted">On-board lahev {num(u.start ?? 0, 0)} → {num(u.end ?? 0, 0)} bar{u.noisy ? " · rozkmitaný tlak, spotřeba nespolehlivá" : ""}</small>
          : <small className="muted">On-board lahev off – snímač ukazuje jen mezitlak (plyn z externí lahve).{!g.ext.length ? " Externí lahev zadej v sekci Před a po ponoru." : ""}</small>}
        {u.ext.length > 0 && <small className="c-warn">Externí plyn nebo zavřená lahev nejspíš: {u.ext.map(([a, b]) => (a === b ? tpt(a * 60) : `${tpt(a * 60)}–${tpt(b * 60)}`)).join(", ")}</small>}
      </div>
    );
  };
  return (
    <Card title="Spotřeba plynu">
      <AllTanks meta={meta} note={note} cyl={cyl} rate={rate} />
      {row("dil", "Diluent")}
      {row("o2", "O₂")}
      <p className="note">Spotřeba z on-board lahve = součet poklesů tlaku (malé nárůsty z ohřátí se odečtou, větší nárůst nebo mezitlak = externí plyn). Externí a doplňkové lahve zadáváš v sekci Před a po ponoru. Objemy on-board lahví nastavíš ve Výstroji.</p>
    </Card>
  );
}

/** Všechny lahve ponoru (on-board + off-board z „Před a po ponoru“) a skutečná spotřeba O₂ a diluentu, když jsou všechny vyplněné. */
function AllTanks({ meta, note, cyl, rate }: { meta: Meta; note?: DiveNote; cyl: { dil: number; o2: number }; rate: { lo: number; hi: number; n: number } | null }) {
  const tanks = note?.prep?.tanks || [];
  if (!tanks.length && !note?.prep) return null;
  const dilIds = new Set(prepExt("dil", meta, note).map((e) => e.id)), o2Ids = new Set(prepExt("o2", meta, note).map((e) => e.id));
  const onb = (gas: "dil" | "o2", name: string) => {
    const u = gas === "dil" ? meta.sum.dilUse : meta.sum.o2Use;
    return <tr key={gas}><td>{name} on-board</td><td>{num(cyl[gas], 1)} l</td><td>{u.ok ? `${num(u.start ?? 0, 0)} → ${num(u.end ?? 0, 0)}` : "off"}</td><td>{u.ok && !u.noisy ? `${u.bar} bar · ${fmtL(u.bar * cyl[gas])}` : "–"}</td></tr>;
  };
  const missing = tanks.filter((t) => t.bar == null || (!t.same && t.end == null) || !tankVol(t));
  const g = (gas: "dil" | "o2") => gasUseOf(gas, meta, note, cyl[gas], gas === "o2" ? rate : null);
  const role: Record<string, string> = { bo: "BO", o2: "O₂", dil: "Dil", deco: "Deko", suit: "Oblek", other: "Jiná" };
  return (
    <div className="all-tanks">
      <table className="small">
        <thead><tr><th>Lahev</th><th>Objem</th><th>Tlak</th><th>Úbytek</th></tr></thead>
        <tbody>
          {onb("o2", "O₂")}{onb("dil", "Diluent")}
          {tanks.map((t) => { const v = tankVol(t), end = t.same ? t.bar : t.end, used = t.bar != null && end != null ? Math.max(0, t.bar - end) : null;
            return <tr key={t.id} className={o2Ids.has(t.id) || dilIds.has(t.id) ? "" : "muted"} title={o2Ids.has(t.id) ? "počítá se do O₂" : dilIds.has(t.id) ? "počítá se do diluentu" : "jen informativně"}><td>{role[t.role]} {t.name} <span className="muted">{t.gas}</span></td><td>{v ? `${num(v, 1)} l` : "?"}</td><td>{t.bar ?? "–"} → {t.same ? "beze změny" : end ?? "–"}</td>
              <td>{used != null ? `${used} bar${v ? ` · ${fmtL(used * v)}` : ""}` : "–"}</td></tr>; })}
        </tbody>
      </table>
      {missing.length ? <p className="note c-warn">Skutečnou spotřebu spočítám po vyplnění všech lahví – chybí {missing.map((t) => `${role[t.role]} ${t.name}: ${t.bar == null ? "tlak před" : !tankVol(t) ? "objem" : "tlak po ponoru (nebo beze změny)"}`).join(", ")}.</p>
        : <p className="real-use"><b>Skutečná spotřeba:</b> O₂ {g("o2").total != null ? fmtL(g("o2").total!) : "–"} · diluent {g("dil").total != null ? fmtL(g("dil").total!) : "–"}</p>}
    </div>
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
  const lbS = useStore().lb.settings, gapMin = lbS.segGap ?? 30;
  const vm = viewMetas(), i = vm.findIndex((m) => m.id === meta.id), next = vm[i + 1];
  const ps = meta.parts;
  const mm = (s: number) => `${Math.round(s / 60)} min`;
  const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
  // spojit zpět jen ručně oddělenou část (automatické spojení do segGap min, jinak se nenabízí)
  const canJoin = next && lbS.segOv?.[next.id] === false && (next.h.serial || 0) === (meta.h.serial || 0);
  if (!ps && !canJoin) return null;
  return (
    <Card title={ps ? `Ponor z ${ps.length} částí` : "Části ponoru"}>
      {ps && ps.map((p, k) => (
        <div key={p.id} className="row between">
          <span className="small">{k + 1}. část {hhmm(p.start)} · {mm(p.h.diveTimeS)} · max {num(p.h.maxDepth)} m{k > 0 ? ` · po ${mm(p.start - (ps[k - 1].start + ps[k - 1].h.diveTimeS))} na hladině` : ""}</span>
          {k > 0 && <button className="btn small" onClick={() => setSegOverride(p.id, false)}>Oddělit</button>}
        </div>
      ))}
      {canJoin && <button className="btn small" onClick={() => setSegOverride(next.id, null)}>Spojit zpět s ručně oddělenou částí ({hhmm(next.start)})</button>}
      <p className="note">Záznamy se stejným číslem ponoru z Cloudu nebo s povrchovým intervalem do {gapMin} min se spojují automaticky (Nastavení → Výbava). Část jde oddělit a oddělenou zase spojit zpět.</p>
    </Card>
  );
}

/** Potřeba bailoutu v čase podle plynů (odhad P) proti plynu v BO a deko lahvích. */
const BO_COL = ["#4fc3f7", "#ffb74d", "#81c784", "#ce93d8", "#e57373", "#fff176"];
function BailoutCard({ d, bo, extra, focusT }: { d: Dive; bo: NonNullable<ReturnType<typeof bailoutOf>>; extra?: Parameters<typeof LineChart>[0]["extra"]; focusT?: number }) {
  const st = useStore();
  const m = st.metas.find((x) => x.id === d.id);
  const o = m ? boOpts(m, st.lb.settings) : { sac: BO_SAC, airMax: 40, ttsMul: 1.5 };
  const tk = boTanks(st.lb.notes[d.id]) || [];
  const plan = bailoutPlan(boProfile(d), tk, o);
  // profil končí s ponorem – doplnit prázdné hodnoty do délky všech vzorků (graf sdílí osu s profilem)
  const pad = (a: (number | null)[]) => [...a, ...d.s.t.slice(a.length).map(() => null)];
  const col = (k: number, g: string) => (g === NO_GAS ? "#ef5350" : BO_COL[k % BO_COL.length]);
  const series = !tk.length ? [] : plan.gases.flatMap((g, k) => [
    { label: gasLabelOf(g), color: col(k, g), values: pad(plan.need[g]), unit: "l", width: 2 },
    ...(g !== NO_GAS && plan.have[g] != null ? [{ label: `${gasLabelOf(g)} s sebou`, color: col(k, g), values: d.s.t.map(() => plan.have[g]), unit: "l", dash: "4 3", width: 1 }] : []),
  ]);
  const w = plan.worst;
  return (
    <section className="card" id="bo-card">
      <h2>Bailout</h2>
      <LineChart t={d.s.t} focusT={focusT} extra={extra}
        series={series.length ? series : [{ label: "Potřeba", color: "#ffb74d", values: pad(plan.total), unit: "l", width: 2 }]} />
      {w && <p className="small">{bo.short ? <span className="c-warn">Nejhůř v {dur(w.t)}: {gasLabelOf(bo.short.gas)} – potřeba {bo.short.need} l, s sebou {bo.short.have} l, chybí {bo.short.short} l.</span>
        : <>Nejhůř v {dur(w.t)}: celkem {w.total} l{bo.have != null ? `, s sebou ${bo.have} l` : " – bailout lahve nezadány"}.</>}</p>}
      <Desc k="bailout"><p className="note">Odhad (P): kolik plynu by bylo potřeba při přechodu na otevřený okruh v každém okamžiku – 1 min řešení problému v hloubce, výstup 9 m/min a zbytek TTS z počítače × {o.ttsMul} (dekomprese na OC je delší než na CCR) na zastávkách, spotřeba {o.sac} l/min. Potřeba se dělí podle plynů: každý úsek výstupu dostane dostupný plyn s nejvyšším podílem O₂ – vzduch do {o.airMax} m, EAN a O₂ podle MOD při pO₂ 1,6, trimix v celé hloubce; červeně úseky, kde žádný zadaný plyn dýchat nejde. Plnou čarou potřeba, čárkovaně co máš s sebou (BO a deko lahve z „Před a po ponoru“, tlak před × objem). Nastavení → Výbava: spotřeba, hloubka pro vzduch, násobek TTS.</p></Desc>
    </section>
  );
}

/** Pořadí dlaždic „V kostce“: nejdřív tyto, zbytek v původním pořadí. */
const TILE_FIRST = ["Hloubka", "Doba", "O₂", "Diluent", "Max. pO₂", "Max. pN₂", "Baterie", "Scrubber"];
function orderTiles<T extends [string, ...unknown[]]>(xs: T[]): T[] {
  const r = (k: string) => { const i = TILE_FIRST.indexOf(k); return i < 0 ? 100 : i; };
  return xs.map((x, i) => ({ x, i })).sort((a, b) => r(a.x[0]) - r(b.x[0]) || a.i - b.i).map((y) => y.x);
}

function LogTab({ id, d }: { id: string; d: Dive | null }) {
  const st = useStore();
  const lb = st.lb;
  const meta = viewMetas().find((m) => m.id === id) || st.metas.find((m) => m.id === id)!;
  const note = lb.notes[id] || { buddyIds: [], note: "", updated: 0 };
  const sg = surfGfOf(meta, lb.settings), bo = isCC(meta.h) ? bailoutOf(meta, note, lb.settings) : null;
  const idx = st.metas.findIndex((m) => m.id === id);
  const base = useEffortBase();
  const warns = mergeCellAlerts([...(d ? diveWarnings(d, summarize(d), lb.settings.th, base) : []).map((w) => {
    // chybné CO₂ čidlo: souvislost s předchozím / dalším ponorem téhož počítače
    if (w.title !== "Čidlo CO₂ nejspíš chybné") return w;
    const same = st.metas.filter((m) => m.h.serial === meta.h.serial), k = same.findIndex((m) => m.id === meta.id);
    const bad = (m?: Meta) => !!m?.warns?.some((x) => x.title === "Čidlo CO₂ nejspíš chybné");
    const prev = same[k - 1], next = same[k + 1];
    const extra = [prev && meta.h.start - prev.h.end < 36 * 3600 && !bad(prev) ? "Předchozí ponor byl v pořádku – typicky orosení po předchozím ponoru, obvykle do druhého dne vyschne." : "", bad(next) ? "Opakuje se i v dalším ponoru – zvaž výměnu čidla." : ""].filter(Boolean).join(" ");
    return extra ? { ...w, text: w.text.replace(" Tyto úseky", ` ${extra} Tyto úseky`) } : w;
  }), ...(isCC(meta.h) ? cellDiveWarnings(st.metas, idx, lb.settings.th) : []), ...(d ? rigAlerts(d, lb.settings.th) : []), ...(st.guest ? [] : noteWarns(meta, note, lb.settings))]);
  // dlaždice Scrubber: před → po ponoru · stáří náplně; barva podle zbývajícího času, stáří a hlášení CO₂
  const scr = (() => {
    const th = lb.settings.th, lim = th.scrubLeftMin ?? 90;
    const c = (m: number) => (m < 30 ? "bad" : m < lim ? "hot" : "");
    const hs = st.metas.filter((m) => m.h.serial === meta.h.serial && m.h.start <= meta.h.start).map((m) => m.h);
    let fill = scrubberFill(hs)?.start ?? null;
    const mf = lb.settings.manualFill;
    if (!st.guest && mf != null && mf <= meta.h.start && (fill == null || mf > fill)) fill = mf;
    const days = fill != null ? Math.floor((meta.h.start - fill) / 86400) : null;
    const cd = days != null && days >= (th.scrubDays ?? 14) ? "hot" : "";
    const co2 = warns.some((w) => /^Alarm CO₂/.test(w.title)) ? "bad" : warns.some((w) => w.title.startsWith("Souvislost CO₂") && w.level !== "info") ? "hot" : "";
    const cb = c(meta.h.scrubLeftStartMin), ca = c(meta.h.scrubLeftEndMin);
    const all = [cb, ca, cd, co2];
    const cls = all.includes("bad") ? "bad" : all.includes("hot") ? "hot" : "";
    const open = () => { const als = [...document.querySelectorAll(".alert")] as HTMLElement[], tt = (x: HTMLElement) => x.querySelector("b")?.textContent || "";
      const el = als.find((x) => /^Alarm CO₂/.test(tt(x))) || als.find((x) => /^Souvislost CO₂/.test(tt(x))) || als.find((x) => /CO₂/.test(tt(x))); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); if (!el.classList.contains("open")) el.click(); } };
    return { cb, ca, cd, cls, days, open };
  })();
  return (
    <>
      <RigLine meta={meta} />
      {!st.guest && <PscrPrompt id={id} meta={meta} note={note} />}
      {meta.comp && <div className="comp-line small muted">Z počítače {compModel(meta.comp)}{meta.alt && <> · <span className="pill">2 počítače</span> <a onClick={() => go({ t: "cmp", id: meta.id, other: meta.alt! })}>Srovnání počítačů ›</a></>}</div>}
      {groupAlerts(warns.filter((a) => a.level !== "info" && !isHiddenW(a.title, note.hideW))).map((a, i) => <AlertBox key={i} a={a} fold onShow={d ? showInChart : undefined} onHide={st.guest ? undefined : () => hideWarn(id, note, a.title, warns.filter((w) => w.level !== "info").map((w) => w.title))} />)}
      <HiddenWarns id={id} note={note} all={warns.filter((a) => a.level !== "info").map((a) => a.title)} />
      <PartsCard meta={meta} />
      <Card title="V kostce" right={<GasChips mixes={meta.sum.gases.map((g) => g.mix)} />}>
        <Tiles cols={2} hide={meta.h ? tilesHidden(meta, lb.settings.th) : []} cls={{ "Scrubber": scr.cls, "Max. pO₂": meta.sum.ppo2Max > (lb.settings.th.po2HiBad ?? 1.6) ? "bad" : po2HiLevel(meta.sum, lb.settings.th) === "warn" ? "hot" : "", "Max. pN₂": meta.sum.pn2Max > (lb.settings.th.pn2Hot ?? 3.16) ? "hot" : "", "Hustota plynu": meta.sum.densMax > 5.2 ? "hot" : "" }} items={orderTiles([
          ["Hloubka", <Pair l={`${num(meta.h.maxDepth)} m`} ll="max" r={`${num(meta.sum.avgDepth)} m`} rl="průměr" />],
          ["Doba", <Pair l={`${Math.round(meta.h.diveTimeS / 60)} min`} ll="ponor" r={meta.sum.decoMin ? `${meta.sum.decoMin} min` : "–"} rl="deko" />],
          ["Plyny", <span className="gas-list">{meta.sum.gases.map((g) => <span key={g.mix}><b>{gasLabel(g.mix).label}</b><small>{Math.round(g.s / 60)} min</small></span>)}</span>],
          ["Teplota", <Pair l={`${meta.sum.tempMin} °C`} ll="min" r={`${meta.sum.tempMax} °C`} rl="max" />],
          ["Max. pO₂", isCC(meta.h) ? `${num(meta.sum.ppo2Max, 2)} bar` : (() => { const ri = rigInfo(meta.h.serial, meta.id, meta.h), f = ri.supplyO2 ?? +(meta.sum.gases[0]?.mix.split("/")[0] || 21); const p = (f / 100) * ((meta.h.surfP || 1013) / 1000 + meta.h.maxDepth * (meta.h.salinity || 1000) / 1000 * 0.0981);
            return <span className="use">{num(Math.round(p * 100) / 100, 2)} bar<small>zásobní plyn{ri.rig === "pSCR" || ri.rig === "aSCR" ? ", smyčka nižší" : " (vypočteno)"}</small></span>; })()],
          ["Max. pN₂", `${num(meta.sum.pn2Max, 2)} bar`],
          ["Max. CO₂", meta.sum.co2Max != null ? <span className="use">{num(meta.sum.co2Max, 2)} mbar{d && co2BadRanges(d).length ? <small>čidlo?</small> : null}</span> : "–"],
          ["GF / CNS", <Pair l={`${meta.h.gfLo}/${meta.h.gfHi}`} ll="GF" r={`${meta.h.cnsEnd} %`} rl="CNS" />],
          ["Diluent", <UseTile gas="dil" meta={meta} note={note} />], ["O₂", <UseTile gas="o2" meta={meta} note={note} />],
          ["Baterie", <Pair l={`${meta.h.batVStart.toFixed(2).replace(".", ",")} V`} ll="start" r={`${meta.h.batVEnd.toFixed(2).replace(".", ",")} V`} rl="end" />],
          ["Scrubber", <span className="use scr-v"><span><span className={scr.cb}>{hm(meta.h.scrubLeftStartMin).replace(" min", "")}</span> → <span className={scr.ca}>{hm(meta.h.scrubLeftEndMin).replace(" min", "")}</span></span><small>{scr.days != null ? <>stáří <span className={scr.cd}>{scr.days} d</span></> : "\u00a0"}</small></span>, scr.cls ? scr.open : undefined],
          ["Dávkování O₂", <Pair l={meta.sum.dose.sol} ll="solenoid" r={meta.sum.dose.man} rl="ručně" />],
          ["Setpoint", <SpTile meta={meta} />],
          ["Hustota plynu", <span className="use">{num(meta.sum.densMax, 1)} g/l<small>max · hranice 5,2 / 6,2</small></span>],
          ["Proplach", <span className="use">{meta.sum.vents}×<small>{meta.sum.dilDesc != null ? `sestup ${num(meta.sum.dilDesc, 0)} bar` : "sestup –"}</small></span>],
          ...(sg ? [["SurfGF", <span className="use"><span className={sg.over ? "c-warn" : ""}>{sg.gf} %</span><small>při vynoření · hranice {sg.lim} %{sg.shallowMin != null ? ` · mělko ${sg.shallowMin} min` : ""}</small></span>] as [string, React.ReactNode]] : []),
          ...(bo && !st.guest ? [["Bailout", bo.have == null ? <span className="use">–<small>{bo.tanks ? "doplň tlak a lahev v Před a po ponoru" : "bailout nezadán"}</small></span>
            : bo.short ? <span className="use"><span className="c-warn">chybí {bo.short.short} l</span><small>{gasLabelOf(bo.short.gas)} · potřeba {bo.short.need} l, s sebou {bo.short.have} l</small></span>
            : <span className="use"><span>{bo.reserve! >= 0 ? "+" : ""}{bo.reserve} %</span><small>potřeba {bo.need} l · s sebou {bo.have} l</small></span>, () => showInChart({ chart: "bailout", from: bo.t, to: bo.t })] as [string, React.ReactNode, () => void]] : []),
        ])} />
      </Card>
      {d ? <ProfileCard d={d} /> : <p className="muted center">Dekóduji…</p>}
      {!st.guest && <PrepCard prep={note.prep} real={{ dil: meta.sum.dilStart, o2: meta.sum.o2Start }} cc={isCC(meta.h)} diveId={id} onChange={(prep) => setNote(id, { prep })} />}
      {!st.guest && <SuggestCard meta={meta} />}
      {st.guest ? <GuestNote note={note} /> : <NoteEditor note={note} noPrep onChange={(p) => setNote(id, p)} />}
      {isCC(meta.h) ? <GasUseCard id={id} meta={meta} note={note} /> : <SupplyGasCard id={id} meta={meta} note={note} />}
      <BuddyDivesCard meta={meta} />
      {st.guest && <button className="btn danger guest-del" onClick={async () => {
        if (!await ask("Smazat tento ponor z cizího logu? Při dalším importu stejného souboru se znovu přidá.", { danger: true, ok: "Smazat" })) return;
        const n = await deleteGuestDives(partIds(meta)); toast(`Smazáno ponorů: ${n}`); back();
      }}>Smazat ponor z cizího logu</button>}
    </>
  );
}

const SUP_KINDS: Record<string, number> = { "7 l": 7, "10 l": 10, "12 l": 12, "15 l": 15, S80: 11.1, S40: 5.7, jiná: 0 };
const parseN = (v: string) => { const x = parseFloat(v.replace(",", ".")); return Number.isNaN(x) ? undefined : x; };

/** pSCR: výrazná výzva k zadání zásobního plynu a tlaku lahve před a po ponoru (bez nich není spotřeba ani odhad smyčky). */
function PscrPrompt({ id, meta, note }: { id: string; meta: Meta; note?: DiveNote }) {
  useStore();
  const ri = rigInfo(meta.h.serial, meta.id, meta.h);
  if (isCC(meta.h) || ri.rig !== "pSCR") return null;
  const sup = (note?.ext || []).find((e) => e.gas === "sup");
  const missing = [!ri.supplyO2 && "zásobní plyn (O₂ %)", !(sup?.start && sup?.end) && "tlak lahve před a po ponoru"].filter(Boolean) as string[];
  if (!missing.length) return null;
  return (
    <div className="alert warn pscr-prompt">
      <b>Zadej {missing.join(" a ")}</b>
      <small>U pSCR bez čidel z toho myX počítá spotřebu a odhad pO₂ ve smyčce. Plyn platí pro tento ponor (výchozí nastavíš u počítače).</small>
      <div className="ext-row">
        <input inputMode="decimal" defaultValue={ri.supplyO2 ?? ""} placeholder="O₂ %" onBlur={(ev) => { const v = parseN(ev.target.value); if (v !== ri.supplyO2) setDiveRig(meta.h.serial, meta.id, { supplyO2: v ? Math.min(100, Math.max(5, Math.round(v))) : null }); }} /><span>% O₂</span>
      </div>
      <SupplyRows id={id} note={note} />
    </div>
  );
}

/** Lahve se zásobním plynem u ponoru (ruční zadání: typ, objem, tlak před a po). */
function SupplyRows({ id, note, add }: { id: string; note?: DiveNote; add?: boolean }) {
  const st = useStore();
  const ext = note?.ext || [], mine = ext.filter((e) => e.gas === "sup");
  const save = (x: ExtGas[]) => setNote(id, { ext: x });
  const rows = mine.length ? mine : [{ id: "new-sup", gas: "sup" as const, kind: "7 l", vol: 7 }];
  const setRow = (e: ExtGas, p: Partial<ExtGas>) => save(mine.some((x) => x.id === e.id) ? ext.map((x) => (x.id === e.id ? { ...x, ...p } : x)) : [...ext, { ...e, ...p, id: uid() }]);
  if (st.guest) return null;
  return (
    <>
      {rows.map((e) => (
        <div key={e.id} className="ext-row">
          <select value={e.kind} onChange={(ev) => setRow(e, { kind: ev.target.value, vol: SUP_KINDS[ev.target.value] || e.vol })}>
            {Object.keys(SUP_KINDS).map((k) => <option key={k}>{k}</option>)}
          </select>
          <input inputMode="decimal" defaultValue={e.vol} title="Objem (l)" onBlur={(ev) => parseN(ev.target.value) !== e.vol && setRow(e, { vol: parseN(ev.target.value) ?? e.vol })} /><span>l</span>
          <input inputMode="decimal" defaultValue={e.start ?? ""} placeholder="před bar" onBlur={(ev) => parseN(ev.target.value) !== e.start && setRow(e, { start: parseN(ev.target.value) })} />
          <input inputMode="decimal" defaultValue={e.end ?? ""} placeholder="po bar" onBlur={(ev) => parseN(ev.target.value) !== e.end && setRow(e, { end: parseN(ev.target.value) })} />
          {mine.length > 0 && <button className="btn small" onClick={() => save(ext.filter((x) => x.id !== e.id))}>✕</button>}
        </div>
      ))}
      {add && mine.length > 0 && <button className="btn small" onClick={() => save([...ext, { id: uid(), gas: "sup", kind: "7 l", vol: 7 }])}>+ Další lahev</button>}
    </>
  );
}

/** Spotřeba plynu u ponoru bez vysílačů tlaku: ruční zadání lahví. */
function SupplyGasCard({ id, meta, note }: { id: string; meta: Meta; note?: DiveNote }) {
  const st = useStore();
  const ri = rigInfo(meta.h.serial, meta.id, meta.h);
  const mine = (note?.ext || []).filter((e) => e.gas === "sup");
  const litres = mine.reduce((a, e) => a + (e.start != null && e.end != null ? (e.start - e.end) * e.vol : 0), 0);
  const min = meta.h.diveTimeS / 60;
  return (
    <Card title="Spotřeba plynu">
      {mine.some((e) => e.start != null && e.end != null)
        ? <p>Spotřeba <b>{Math.round(litres)} l</b>{ri.supplyO2 ? ` (${ri.supplyO2} % O₂)` : ""} · {num(litres / Math.max(1, min), 1)} l/min za ponor</p>
        : <p className="muted">{st.guest ? "Tlaky lahví v cizím logu nejsou." : "Počítač tlak lahve neměří – zadej lahev a tlak před a po ponoru."}</p>}
      <SupplyRows id={id} note={note} add />
      <p className="note">Spotřeba = (tlak před − tlak po) × objem lahve. U pSCR vypouští přístroj část vydechovaného plynu, spotřeba proto roste s hloubkou.</p>
    </Card>
  );
}

/** Varování z odhadu pSCR (?): spodní okraj pásma pO₂ ve smyčce pod 0,16 bar. Jen se zadaným zásobním plynem. */
function rigAlerts(d: Dive, th: { po2HiWarn?: number; po2HiBad?: number }): Alert[] {
  if (isCC(d.h)) return [];
  const ri = rigInfo(d.h.serial, d.id, d.h), out: Alert[] = [], s = d.s;
  const fo2 = ri.supplyO2 ?? s.o2[0] ?? 21, sup = supplyPo2(d, fo2);
  // vysoké pO₂ zásobního plynu (smyčka víc mít nemůže)
  const bad = th.po2HiBad ?? 1.6, mx = Math.max(...sup.filter((_, i) => s.t[i] <= d.h.diveTimeS));
  if (mx > bad) { const i = sup.findIndex((v) => v > bad); out.push({ level: "bad", title: "Vysoké pO₂ zásobního plynu", text: `${fo2} % O₂ dává v ${num(s.depth[i])} m (${tpt(s.t[i])}) pO₂ ${num(mx, 2)} bar – nad ${num(bad, 1)} bar.`, blocks: [{ head: "", steps: [], from: s.t[i], to: s.t[i] + 60, chart: "po2" }] }); }
  if (ri.rig !== "pSCR" || !ri.supplyO2) return out;
  const lo = pscrLoopPo2(d, ri.supplyO2, ri.ratio, 20);
  const spans: { from: number; to: number; min: number }[] = [];
  let a = -1;
  for (let i = 0; i <= s.t.length; i++) {
    const on = i < s.t.length && s.t[i] <= d.h.diveTimeS && s.depth[i] > 1 && (lo[i] ?? 1) < 0.16;
    if (on && a < 0) a = i;
    if (!on && a >= 0) { spans.push({ from: s.t[a], to: s.t[i - 1], min: Math.min(...(lo.slice(a, i) as number[])) }); a = -1; }
  }
  if (spans.length) out.push({ level: "warn", title: "Možná hypoxie ve smyčce pSCR (odhad ?)", text: `Odhad pro ${ri.supplyO2} % O₂ a poměr 1:${ri.ratio} při úsporném dýchání: ${spans.map((x) => `${tpt(x.from)}–${tpt(x.to)} až ${num(x.min, 2)} bar`).join("; ")}. Bez čidla jen výpočet – skutečnost závisí na dýchání a přístroji.`, blocks: spans.map((x) => ({ head: `${tpt(x.from)}–${tpt(x.to)}, až ${num(x.min, 2)} bar`, steps: [], from: x.from, to: x.to, chart: "po2" as const })) });
  return out;
}

/** pO₂ bez čidel: zásobní plyn v hloubce (horní mez), u pSCR odhad smyčky jako pásmo. */
function SupplyPo2Card({ d, focusT, warns, focus }: { d: Dive; focusT?: number; warns: Alert[]; focus?: ChartFocus | null }) {
  useStore();
  const s = d.s, ri = rigInfo(d.h.serial, d.id, d.h), fo2 = ri.supplyO2 ?? s.o2[0] ?? 21;
  const sup = useMemo(() => supplyPo2(d, fo2), [d, fo2]);
  const est = ri.rig === "pSCR" && ri.supplyO2;
  const lo = useMemo(() => (est ? pscrLoopPo2(d, fo2, ri.ratio, 20) : []), [d, est, fo2, ri.ratio]);
  const hi = useMemo(() => (est ? pscrLoopPo2(d, fo2, ri.ratio, 30) : []), [d, est, fo2, ri.ratio]);
  const scr = ri.rig === "pSCR" || ri.rig === "aSCR";
  return (
    <Card title={scr ? "pO₂ (bez čidel)" : "pO₂ plynu"}>
      <LineChart t={s.t} focusT={focusT} yInclude={[0.16, 1.6]} hlines={[{ v: 1.6, color: "#ef5350" }, ...(est ? [{ v: 0.16, color: "#ffb74d" }] : [])]} series={[
        { label: scr ? "Zásobní plyn (horní mez)" : "pO₂ plynu (vypočteno)", color: C[0], values: sup, unit: "bar", width: 2, dash: scr ? "4 3" : undefined },
        ...(est ? [{ label: "Smyčka – odhad, úsporné dýchání", color: "#ffb74d", values: lo, unit: "bar", width: 1.5 }, { label: "Smyčka – odhad, běžné dýchání", color: "#81c784", values: hi, unit: "bar", width: 1.5 }] : []),
      ]} />
      <ChartEvents warns={warns} keys={["po2"]} focus={focus} />
      <Desc k="supply"><p className="note">Počítač v módu {d.h.mode} nemá čidla O₂ – pO₂ je jen vypočtené ze zásobního plynu ({fo2} % O₂{ri.supplyO2 ? "" : ", z nastavení počítače – v Gauge módu plyn nezná, zadej ho u ponoru nebo u počítače"}) a hloubky.
        {scr && <> U polouzavřeného okruhu je pO₂ ve smyčce vždy nižší (smyčka se ochuzuje o spotřebovaný kyslík), čárkovaná čára je horní mez.</>}
        {est ? <> Odhad smyčky (?) pro pSCR s poměrem 1:{ri.ratio}: oranžově úsporné dýchání (dechový ekvivalent 20 – nejnižší pO₂), zeleně běžné (30). Je to výpočet, ne měření – skutečnost závisí na přístroji a dýchání. Oranžová přerušovaná čára = 0,16 bar.</>
          : ri.rig === "pSCR" ? <> Odhad pO₂ ve smyčce se zobrazí po zadání zásobního plynu (u ponoru nebo u počítače).</> : null}</p></Desc>
    </Card>
  );
}

/** Počítač, mód a typ přístroje; klepnutím změna u tohoto ponoru. */
function RigLine({ meta }: { meta: Meta }) {
  useStore();
  const ri = rigInfo(meta.h.serial, meta.id, meta.h), cc = isCC(meta.h);
  const edit = async () => {
    const k = await choose(`Typ přístroje u tohoto ponoru (výchozí se nastavuje u počítače v Nastavení).`, [...rigChoices(ri.rig, meta.h.mode), ...(ri.byDive ? [{ key: "reset", label: "Podle počítače" }] : [])]);
    if (!k) return;
    if (k === "reset") { await setDiveRig(meta.h.serial, meta.id, { rig: null, supplyO2: null }); return; }
    await setDiveRig(meta.h.serial, meta.id, { rig: k as Rig });
    if (!cc && k !== "eCCR") {
      const v = await askText("Zásobní plyn – O₂ % (počítač v módu " + meta.h.mode + " plyn nezná; prázdné = podle počítače)", ri.supplyO2 ? String(ri.supplyO2) : "");
      if (v != null) await setDiveRig(meta.h.serial, meta.id, { supplyO2: v.trim() ? Math.min(100, Math.max(5, Math.round(+v.replace(",", ".")) || 0)) || null : null });
    }
  };
  return (
    <div className="comp-line small muted rig-line" onClick={edit}>
      {compName(meta.h.serial)} · mód {meta.h.mode} · přístroj <b>{ri.rig ?? "nezadán"}</b>
      {!cc && ri.supplyO2 ? <> · zásobní plyn {ri.supplyO2} % O₂</> : null}{ri.byDive ? " (u ponoru)" : ""} <a>Změnit ›</a>
    </div>
  );
}

/** Dlaždice V kostce, které pro daný ponor nedávají smysl (bez čidel, bez dekomprese, bez dat). */
function tilesHidden(meta: Meta, _th: unknown): string[] {
  const out: string[] = [];
  if (!isCC(meta.h)) out.push("Max. pN₂", "Diluent", "O₂", "Scrubber", "Dávkování O₂", "Setpoint", "Proplach");
  if (!hasDeco(meta.h)) out.push("GF / CNS");
  if (meta.sum.co2Max == null && !isCC(meta.h)) out.push("Max. CO₂");
  return out;
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
    <Card title={hasDeco(d.h) ? "Profil a strop" : "Profil"}>
      <LineChart t={s.t} invert height={220} bands={((d as Dive & { surf?: { from: number; to: number }[] }).surf || []).map((b) => ({ ...b, color: "#90a4ae" }))} series={[
        { label: "Hloubka", color: C[0], values: s.depth, unit: "m", width: 2 },
        ...(hasDeco(d.h) ? [{ label: "Strop", color: C[5], values: s.ceil, unit: "m", fillUp: true },
          { label: "", color: C[1], values: link, width: 1 },
          { label: "Zastávka", color: C[1], values: stops, unit: "m", width: 3 }] : []),
      ]} vlines={first >= 0 ? [{ t: s.t[first], to: stops[first]!, color: C[1] }] : undefined} strip={segs} pins={isCC(d.h) ? spPins(d) : undefined} marks={btns ? d.buttons.filter((b) => b.t >= 0 && b.t <= d.h.diveTimeS).map((b) => ({ t: b.t, color: b.btn === 2 ? "#ffb74d" : "#b0bec5", label: BTN_NAMES[b.btn] ?? "tlačítko" })) : undefined} extra={[{ label: "Plyn", values: gasAt }, { label: "Teplota", values: s.temp, unit: "°C" }, { label: "pO₂", values: s.ppo2, unit: "bar" }, { label: "TTS", values: s.tts, unit: "min" }]} />
      {d.buttons.length > 0 && <div className="chart-under"><label className="inline" style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "auto" }}><input type="checkbox" checked={btns} onChange={(e) => setBtns(e.target.checked)} /> stisky tlačítek</label></div>}
      <Desc k="profile"><p className="note">Zastávka = úseky, kdy jsi byl na dekompresní zastávce (nejvýš 3 m pod její hloubkou). Vyplněná plocha nad stropem je zakázaná zóna. Barevný pruh dole = použitý plyn. Svislé čárkované značky SP = přepnutí setpointu (? = bez potvrzené obsluhy Petrelu).</p></Desc>
    </Card>
  );
}

function ChartsTab({ d, focus }: { d: Dive; focus?: ChartFocus | null }) {
  const s = d.s;
  const stC = useStore();
  const mC = stC.metas.find((m) => m.id === d.id);
  const boC = mC && !stC.guest && isCC(mC.h) ? bailoutOf(mC, stC.lb.notes[d.id], stC.lb.settings) : null;
  const [cellMode, setCellMode] = useState<"cal" | "mv">("cal");
  const cal = useMemo(() => cellCalibration(d), [d]);
  const doses = useMemo(() => o2Doses(d), [d]);
  const vrate = useMemo(() => s.depth.map((_, i) => {
    const a = Math.max(0, i - 3), b = Math.min(s.t.length - 1, i + 3);
    return s.t[b] === s.t[a] ? 0 : +(-(s.depth[b] - s.depth[a]) / (s.t[b] - s.t[a]) * 60).toFixed(1);
  }), [d]);
  const cells = [s.mv1, s.mv2, s.mv3].map((mv, k) => cellMode === "mv" ? mv : mv.map((v) => (cal[k] ? +(v * cal[k]!).toFixed(2) : null)));
  const hasHe = d.tissues.some((x) => x.he.some((v) => v > 0.02));
  // úseky, kdy počítač GF99 neukládá (tkáně se nasycují, displej ukazuje „--“)
  const gfLoad: { from: number; to: number }[] = [];
  { let a = -1; for (let i = 0; i <= s.t.length; i++) { const nul = i < s.t.length && s.t[i] <= d.h.diveTimeS && s.gf99[i] == null; if (nul && a < 0) a = i; if (!nul && a >= 0) { gfLoad.push({ from: s.t[a], to: s.t[Math.min(i, s.t.length - 1)] }); a = -1; } } }
  const depthExtra: { label: string; values: (number | null)[]; unit: string }[] = []; // hloubku ukazuje linka profilu
  const st = useStore(), th = st.lb.settings.th;
  const evBase = useEffortBase();
  const warns = useMemo(() => [...diveWarnings(d, summarize(d), th, evBase), ...rigAlerts(d, th)], [d, th, evBase, rigInfo(d.h.serial, d.id, d.h).rig, rigInfo(d.h.serial, d.id, d.h).supplyO2]);
  const cc = isCC(d.h), deco = hasDeco(d.h), hasPress = s.dil.some((v) => v != null) || s.o2p.some((v) => v != null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  useBackLayer(zoom != null, () => setZoom(null)); // Zpět nejdřív zruší přiblížení
  // odkaz z varování: posunout na graf (s nadpisem), posuvník na začátek situace
  useEffect(() => {
    if (!focus) return;
    // jen posuvník (bez přiblížení); když je výřez mimo situaci, zruší se
    setZoom((z) => (z && (focus.from < z[0] || focus.from > z[1]) ? null : z));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector(`[data-chart="${focus.chart === "effort" ? "co2" : focus.chart}"]`);
      if (!el) return;
      const top = (document.querySelector(".top") as HTMLElement | null)?.getBoundingClientRect().bottom ?? 0;
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - top - 8, behavior: "smooth" }); // vidět i nadpis karty
    }));
  }, [focus]);
  const fT = (k: string) => (focus && focus.chart === k ? focus.from : undefined);
  // typ čidla z Výbavy (čidlo na dané pozici v den ponoru)
  const day = new Date(d.h.start * 1000).toISOString().slice(0, 10);
  const cellName = (k: number) => { const c = Object.values(st.lb.cells).find((x) => x.pos === k && x.installed <= day && (!x.removed || x.removed >= day)); const n = c ? (c.type || c.maker || "").trim() : ""; return `Čidlo ${k}${n ? ` (${n})` : ""}`; };
  const hz = useMemo(() => po2HighZones(d, th), [d, th]);
  const dz = useMemo(() => po2DilZones(d, th), [d, th]);
  const [dilOn, setDilOn] = useState(() => { try { return localStorage.getItem("myx.dilBand") !== "0"; } catch { return true; } });
  const flipDil = () => { const v = !dilOn; setDilOn(v); try { localStorage.setItem("myx.dilBand", v ? "1" : "0"); } catch { /* bez úložiště */ } };
  const spread = cellSpread(d);
  const po2Bands = [
    ...d.alarms.filter((a) => a.kind === "po2high" || a.kind === "po2low").map((a) => ({ from: a.start, to: a.end, color: a.kind === "po2high" ? "#ef5350" : "#ffb74d", label: `Alarm z počítače: ${a.kind === "po2high" ? "vysoké" : "nízké"} pO₂` })),
    ...hz.map((z) => ({ from: z.from, to: z.to, color: z.level === "bad" ? "#ff1744" : "#ffee58", label: z.level === "bad" ? `pO₂ nad ${fmtSp(th.po2HiBad ?? 1.6)} bar (max ${fmtSp(+z.max.toFixed(2))})` : `pO₂ nad ${fmtSp(th.po2HiWarn ?? 1.4)} bar mimo deko (max ${fmtSp(+z.max.toFixed(2))})` })),
    ...(dilOn ? dz.map((z) => ({ from: z.from, to: z.to, color: "#4fc3f7", label: `pO₂ z diluentu nad ${fmtSp(th.po2HiWarn ?? 1.4)} bar (max ${fmtSp(+z.max.toFixed(2))})` })) : []),
    ...(spread?.bands || []).map((b) => ({ ...b, to: b.to + 5, color: "#26a69a", label: "Čidla se rozcházejí (nad 0,3 bar)" })),
    ...((d as Dive & { surf?: { from: number; to: number }[] }).surf || []).map((b) => ({ ...b, color: "#90a4ae", label: "Hladina" })),
  ];
  const usedBands = [
    ...(d.alarms.some((a) => a.kind === "po2high") ? [{ color: "#ef5350", label: "alarm vysokého pO₂" }] : []),
    ...(d.alarms.some((a) => a.kind === "po2low") ? [{ color: "#ffb74d", label: "alarm nízkého pO₂" }] : []),
    ...(hz.some((z) => z.level === "warn") ? [{ color: "#ffee58", label: `nad ${fmtSp(th.po2HiWarn ?? 1.4)} bar mimo deko` }] : []),
    ...(hz.some((z) => z.level === "bad") ? [{ color: "#ff1744", label: `nad ${fmtSp(th.po2HiBad ?? 1.6)} bar` }] : []),
    ...(dz.length ? [{ color: "#4fc3f7", label: `pO₂ z diluentu > ${fmtSp(th.po2HiWarn ?? 1.4)}`, off: !dilOn, onClick: flipDil }] : []),
    ...(spread?.bands?.length ? [{ color: "#26a69a", label: "rozjetá čidla" }] : []),
    ...((d as Dive & { surf?: unknown[] }).surf?.length ? [{ color: "#90a4ae", label: "hladina" }] : []),
  ];
  const cellSeg = <div className="seg"><button className={cellMode === "cal" ? "on" : ""} onClick={() => setCellMode("cal")}>pO₂</button><button className={cellMode === "mv" ? "on" : ""} onClick={() => setCellMode("mv")}>mV</button></div>;
  return (
    <ZoomCtx.Provider value={{ z: zoom, setZ: setZoom }}>
    <ChartDefs.Provider value={{ profile: s.depth, zoom: true }}>
      <ProfileCard d={d} />
      {cc ? <>
      <div data-chart="po2"><Card title="pO₂ a čidla">
        {cellMode === "cal" ? (
          <LineChart t={s.t} focusT={fT("po2")} under={cellSeg} yInclude={[1.6]} hlines={[{ v: Math.max(...s.ppo2.filter((v, i) => s.t[i] <= d.h.diveTimeS)), color: "#b0bec5" }, { v: 1.6, color: "#ef5350" }]} toggle bandLegend={usedBands} marks={doses.map((x) => ({ t: x.t, color: DOSE_COLOR[x.kind], label: DOSE_LABEL[x.kind] }))} pins={spPins(d)} bands={po2Bands} series={[
            { label: "Průměr pO₂", color: C[0], values: s.ppo2, unit: "bar", width: 2 }, { label: cellName(1), color: C[1], values: cells[0], unit: "bar", width: 1 },
            { label: cellName(2), color: C[2], values: cells[1], unit: "bar", width: 1 }, { label: cellName(3), color: C[3], values: cells[2], unit: "bar", width: 1 }, { label: "Setpoint", color: C[4], values: s.sp, unit: "bar", dash: "4 3", width: 1 },
          ]} extra={depthExtra} />
        ) : (
          <LineChart t={s.t} under={cellSeg} toggle bandLegend={usedBands} bands={po2Bands} series={[
            { label: cellName(1), color: C[1], values: cells[0], unit: "mV", width: 1 }, { label: cellName(2), color: C[2], values: cells[1], unit: "mV", width: 1 }, { label: cellName(3), color: C[3], values: cells[2], unit: "mV", width: 1 },
          ]} extra={[{ label: "Průměr pO₂", values: s.ppo2, unit: "bar" }, ...depthExtra]} />
        )}
        <ChartEvents warns={warns} keys={["po2"]} focus={focus} />
        <Desc k="po2"><p className="note">
          {cellMode === "cal" ? <>Čidla přepočtená společnou kalibrací odvozenou z průměrného pO₂ tohoto ponoru (rozdíl = jiná citlivost čidla): {cal.map((c, k) => `č. ${k + 1} ${c ? (c * 1000).toFixed(1) + " mbar/mV" : "–"}`).join(", ")}. </> : "Surové hodnoty čidel v mV. "}
          {dz.length > 0 && <>Světle modře úseky, kdy pO₂ nad {fmtSp(th.po2HiWarn ?? 1.4)} bar dává sám diluent v dané hloubce (není to chyba, nevaruje se; klepnutím v legendě skryješ). </>}
          Čárky dole = nárůsty O₂ podle druhu: <span style={{ color: DOSE_COLOR.sol }}>■ solenoid (pravděpodobně) {doses.filter((x) => x.kind === "sol").length}×</span>, <span style={{ color: DOSE_COLOR.man }}>■ ručně O₂ {doses.filter((x) => x.kind === "man").length}×</span>, <span style={{ color: DOSE_COLOR.amb }}>■ ručně O₂, nebo diluent {doses.filter((x) => x.kind === "amb").length}×</span>, <span style={{ color: DOSE_COLOR.dil }}>■ diluent {doses.filter((x) => x.kind === "dil").length}×</span>. Solenoid dávkuje jen pod setpointem – nárůst nad ním je ruční. Pásma: červené = alarm vysokého pO₂ z počítače, oranžové = alarm nízkého pO₂, žluté / sytě červené = vlastní detekce vysokého pO₂, tyrkysové = čidla se rozcházejí o víc než 0,3 bar.
        </p></Desc>
      </Card></div>
      </> : <div data-chart="po2"><SupplyPo2Card d={d} focusT={fT("po2")} warns={warns} focus={focus} /></div>}
      <div data-chart="co2"><Co2Card d={d} focusT={fT("co2") ?? fT("effort")} warns={warns} focus={focus} /></div>
      {deco && <>
      <Card title="Dekomprese">
        <LineChart t={s.t} invertLeft axisUnits={{ l: "min ↓", r: "min" }} series={[
          // NDL doplňkově na pravé ose omezené na 30 min (vyšší hodnoty u horního okraje), aby deko údaje měly celé měřítko
          { label: "NDL", color: C[0], values: s.stopt.map((v, i) => (s.stop[i] > 0 || s.t[i] > d.h.diveTimeS ? null : Math.min(30, v))), unit: "min", right: true, noTip: true },
          { label: "Čas na zastávce", color: C[2], values: s.stopt.map((v, i) => (s.stop[i] > 0 && s.t[i] <= d.h.diveTimeS ? v : null)), unit: "min" },
          { label: "TTS", color: C[1], values: s.tts, unit: "min", width: 2 }, { label: "@+5", color: C[3], values: s.at5, unit: "min", dash: "4 3" },
          { label: "", color: "transparent", values: s.t.map((_, i) => (i === 0 ? 10 : null)), noTip: true }, // měřítko aspoň 0–10 min (krátké TTS nevypadá dramaticky)
        ]} extra={[{ label: "NDL", values: s.stopt.map((v, i) => (s.stop[i] > 0 || s.t[i] > d.h.diveTimeS ? "–" : v >= 99 ? "> 99 min" : `${v} min`)) }, { label: "Zastávka", values: s.stop.map((v) => (v > 0 ? `${v} m` : "–")) }]} />
        <Desc k="deco"><p className="note"><b>Deko údaje rostou dolů</b> (levá osa, 0 nahoře), NDL nahoru – dokud máš rezervu, je NDL nahoře a deko čáry leží u horního okraje; když NDL dojde k nule, deko čáry začnou klesat. <b>NDL</b> (tenká čára, pravá osa omezená na 30 min – vyšší hodnoty jsou u horního okraje, přesná hodnota v pruhu pod grafem) – kolik minut můžeš zůstat v aktuální hloubce bez povinné zastávky. <b>Čas na zastávce</b> – zbývající čas na aktuální deko zastávce (hloubka zastávky v popisku posuvníku). <b>TTS</b> – celkový čas výstupu na hladinu včetně zastávek, kdybys začal stoupat hned. <b>@+5</b> – jaké by bylo TTS, kdybys v aktuální hloubce zůstal ještě 5 min (rozdíl proti TTS = jak rychle deko roste).</p></Desc>
      </Card>
      <Card title="Tkáně a kyslík">
        <LineChart t={s.t} bands={gfLoad.map((r) => ({ ...r, color: "#90a4ae" }))} bandLegend={gfLoad.length ? [{ color: "#90a4ae", label: "nasycování (počítač ukazuje --)" }] : []} series={[
          { label: "GF99", color: C[5], values: s.gf99, unit: "%", width: 2, nullText: "--" }, { label: `GF High ${d.h.gfHi}`, color: "#b0bec5", values: s.t.map(() => d.h.gfHi), unit: "%", dash: "4 3", width: 1, noTip: true },
          { label: "CNS", color: C[4], values: s.cns, unit: "%" },
        ]} />
        <Desc k="tissue"><p className="note"><b>GF99</b> – jak blízko jsou tkáně povolenému přesycení (0 % = bez přesycení, 100 % = hranice modelu Bühlmann); při výstupu roste, na zastávkách klesá. Čárkovaně tvůj GF High – výš by se jít nemělo. Šedě úseky, kdy se tkáně teprve nasycují (sestup, dno, opětovné zanoření) – přesycení není, počítač ukazuje „--“. Skok na konci je <b>Surface GF</b> po vynoření – během povrchového intervalu pak klesá. <b>CNS</b> – kumulativní kyslíková zátěž centrální nervové soustavy, limit 100 %.</p></Desc>
      </Card>
      </>}
      {hasPress && <>
      <div data-chart="press"><Card title="Tlak v láhvích">
        <LineChart t={s.t} focusT={fT("press")} series={[{ label: "Diluent", color: C[0], values: pressGaps(s.dil), unit: "bar" }, { label: "O₂", color: C[2], values: pressGaps(s.o2p), unit: "bar" }]} extra={depthExtra} />
        <ChartEvents warns={warns} keys={["press"]} focus={focus} />
        <Desc k="press"><p className="note">Hodnota kolem 8–11 bar u O₂ odpovídá mezitlaku prvního stupně, ne tlaku v láhvi.</p></Desc>
      </Card></div>
      </>}
      {boC && <div data-chart="bailout"><BailoutCard d={d} bo={boC} extra={depthExtra} focusT={fT("bailout")} /></div>}
      <div data-chart="temp"><Card title="Teplota a baterie">
        <LineChart t={s.t} focusT={fT("temp")} series={[{ label: "Teplota", color: C[1], values: s.temp, unit: "°C" }, { label: "Baterie", color: C[4], values: s.bv, unit: "V", right: true }]} extra={depthExtra} />
        <ChartEvents warns={warns} keys={["temp"]} focus={focus} />
      </Card></div>
      <Card title="Rychlost">
        <LineChart t={s.t} zero series={[{ label: "Rychlost", color: C[0], values: vrate, unit: "m/min" }]} extra={depthExtra} />
        <Desc k="speed"><p className="note">Vertikální rychlost v m/min, průměr za 30 s. <b>Nad nulou výstup, pod nulou klesání</b> – čím dál od nuly, tím rychleji; zuby jsou střídání zrychlení a zpomalení. Max. výstup a klesání ve V kostce jsou z jednotlivých 5s vzorků, proto bývají vyšší než v grafu.</p></Desc>
      </Card>
      {deco && <>
      <Card title="Nasycení tkání N₂">
        <TissueMap snaps={d.tissues.map((x) => ({ t: x.t, v: x.n2 }))} end={s.t[s.t.length - 1]} />
      </Card>
      {hasHe && <Card title="Nasycení tkání He"><TissueMap snaps={d.tissues.map((x) => ({ t: x.t, v: x.he }))} end={s.t[s.t.length - 1]} /></Card>}
      </>}
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
      {valve.length > 0 && <div className="valve-list">{valve.map((v, i) => <div key={i} className="small">On-board {v.g} {v.kind === "close" ? "zavřena (přechod na externí)" : "otevřena"} v {mmss(v.t)} ({v.from} → {v.to} bar)</div>)}</div>}
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
    {infos.length > 0 && <Card title="Informace">{infos.map((a, i) => <AlertBox key={i} a={a} fold onShow={showInChart} />)}</Card>}
    {isCC(d.h) && <>
    <Card title="Setpoint">
      {(() => { const sp = setpointChanges(d); return sp.length ? (
        <table className="kv"><thead><tr><th>Čas</th><th>Hloubka</th><th>Setpoint</th><th>Obsluha</th></tr></thead>
          <tbody>{sp.map((c, i) => <tr key={i}><td>{tpt(c.t)}</td><td>{num(c.depth)} m</td><td>{fmtSp(c.from)} → {fmtSp(c.to)}{c.to < 0.3 && c.depth <= 6 ? " (před výstupem)" : ""}</td><td>{c.manual ? "ručně (menu Petrelu)" : "bez potvrzené obsluhy"}</td></tr>)}</tbody>
        </table>) : <p className="muted">Setpoint se během ponoru neměnil.</p>; })()}
      <p className="note">Ruční přepnutí = levé tlačítko (menu) a pravé (potvrzení první položky) 0–25 s před změnou ve vzorcích. Ruční dávky O₂ před přepnutím na vysoký setpoint: {o2Doses(d).filter((x) => x.preSw && x.kind === "man").length}×.</p>
    </Card>
    </>}
    <Card title="Ovládání počítače">
      {d.buttons.length ? <>
        <p>{d.buttons.length} stisků · menu otevřeno {d.buttons.filter((b) => b.from === 0xb3 && b.to === 0x06).length}× · mimo hlavní obrazovku {Math.round(summarize(d).offMainS / 60)} min</p>
        <table className="kv"><thead><tr><th>Čas</th><th>Tlačítko</th><th>Obrazovka</th></tr></thead>
          <tbody>{d.buttons.map((b, i) => <tr key={i}><td>{b.clock}<br /><small className="muted">{b.t < 0 ? "před ponorem" : tpt(b.t)}</small></td><td>{BTN_NAMES[b.btn] ?? `tlačítko ${b.btn}`}</td><td>{scrName(b.from)} → {scrName(b.to)}</td></tr>)}</tbody>
        </table>
      </> : <p className="muted">Bez záznamu o ovládání.</p>}
      <p className="note">Ze záznamů 0x51. Čas = minuta:sekunda na hodinách počítače. Petrel je zapisuje v dávkách, pořadí se řadí podle času.</p>
    </Card>
    <Card title="Alarmy z počítače">
      {d.alarms.length ? (
        <table className="kv"><thead><tr><th>Alarm</th><th>Od</th><th>Do</th><th>Délka</th></tr></thead>
          <tbody>{d.alarms.map((a, i) => <tr key={i}><td>{a.label}</td><td>{tpt(a.start)}</td><td>{tpt(a.end)}</td><td>{dur(a.end - a.start)}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">Počítač v tomto ponoru nehlásil alarm CO₂ ani pO₂.</p>}
      <p className="note">Z událostí 9 (spuštění) a 10 (ukončení). V grafech CO₂ a pO₂ jsou alarmy vyznačené podbarvením.</p>
    </Card>
    <CompWarnCard d={d} />
    <Card title="Události v záznamu">
      <p className="note">Bez CO₂ (to je v grafu) a bez stisků tlačítek (výše). Značka (P) = pravděpodobný význam, (?) = hypotéza.</p>
      <table className="kv"><thead><tr><th>Čas</th><th>Typ</th><th>Význam / data</th></tr></thead>
        <tbody>{d.events.map((e, i) => <tr key={i}><td>{tpt(e.t)}</td><td>{e.kind}</td><td>{e.label}<br /><code>{e.payload}</code></td></tr>)}</tbody>
      </table>
    </Card>
    </>
  );
}
