import { HelpScreen } from "./ui/Help";
import { LOGO_SVG } from "./ui/logo";
import { IS_DEV } from "./app/db";
import { DialogHost } from "./ui/Dialog";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { init, locate, scheduleSync, syncNow, takeShared, toast } from "./app/store";
import { back, go, tab, useBackLayer, useScreen, useStore, type Screen } from "./ui/common";
import { OverviewScreen } from "./ui/Overview";
import { DiveScreen, DivesScreen } from "./ui/Dives";
import { BuddiesScreen, BuddyScreen, SiteScreen, SitesScreen } from "./ui/Sites";
import { AboutScreen, SettingsScreen } from "./ui/Settings";
import { DraftScreen } from "./ui/Draft";
import { CellsScreen } from "./ui/Cells";
import { BatteriesScreen } from "./ui/Batteries";
import { closeGuest, closeTempOwn, openTempOwn, createDraft, localNow, moveDraft, guestIndexLoad, logName, myDisplayName, openGuest, ownerName, type GuestLog } from "./app/store";
import { WarningsScreen, useWarnings } from "./ui/Warnings";
import { Co2Screen } from "./ui/Cells";
import { CompareHub, CompareScreen } from "./ui/Compare";
import { OwnerPicker } from "./ui/Owner";
import { APP_VERSION } from "./app/version";
import "./ui/app.css";

/** Pád obrazovky nesmí nechat prázdnou zaseknutou stránku. */
class Guard extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    const e = this.state.err;
    if (!e) return this.props.children;
    return (
      <div className="screen"><div className="alert bad"><b>Něco se pokazilo</b><div className="small">{e.message}</div></div>
        <div className="row"><button className="btn" onClick={() => { this.setState({ err: null }); back(); }}>Zpět</button><button className="btn" onClick={() => location.reload()}>Znovu načíst</button></div>
      </div>
    );
  }
}

const TABS: [Screen, string, string][] = [
  [{ t: "home" }, "Přehled", "◉"], [{ t: "dives" }, "Ponory", "≋"], [{ t: "buddies" }, "B&L", "☺"],
  [{ t: "hub" }, "DB", "⇄"], [{ t: "settings" }, "Nastavení", "⚙"],
];

/** Titulek Přehledu: jméno aktivního logu ›, klepnutím výběr mezi mým logem a uloženými cizími (jen čtení). */
function LogSwitch({ label }: { label: string }) {
  const st = useStore();
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => setOpen(false));
  const [list, setList] = useState<{ log: GuestLog; n: number }[]>([]);
  useEffect(() => { if (open) guestIndexLoad().then((ix) => setList(ix.map((g) => ({ log: g.log, n: g.metas.length })))); }, [open, st.guestRev]);
  const myName = myDisplayName() || "Můj log";
  const cur = st.guest ? logName(st.guest) : st.temp ? `${logName(st.temp)} (jako můj)` : myName;
  const isCur = (l: GuestLog) => !!st.guest && (st.guest.id === l.id || (l.logs || [l]).some((x) => x.id === st.guest!.id));
  return (
    <div className="logsw">
      <h1 className="logsw-t" onClick={() => setOpen(!open)}>{label} · <span className="logsw-n">{cur}</span> <span className="logsw-a">{open ? "⌄" : "›"}</span></h1>
      {open && <>
        <div className="logsw-bg" onClick={() => setOpen(false)} />
        <div className="logsw-m">
          <button className={!st.guest && !st.temp ? "on" : ""} onClick={() => { setOpen(false); if (st.guest) closeGuest(); if (st.temp) closeTempOwn(); }}>{!st.guest && !st.temp ? "✓ " : ""}{myName}{myDisplayName() ? <small>můj log</small> : null}</button>
          {list.map((g) => <button key={g.log.id} className={isCur(g.log) ? "on" : ""} onClick={async () => { setOpen(false); if (!isCur(g.log)) await openGuest(g.log); }}>{isCur(g.log) ? "✓ " : ""}{logName(g.log)} <small>{g.n} ponorů · jen čtení</small></button>)}
          {IS_DEV && list.length > 0 && <small className="muted logsw-e">Dev – otevřít jako můj (změny jen do restartu):</small>}
          {IS_DEV && list.map((g) => <button key={"t" + g.log.id} className={st.temp?.id === g.log.id ? "on" : ""} onClick={async () => { setOpen(false); await openTempOwn(g.log); }}>{st.temp?.id === g.log.id ? "✓ " : ""}{logName(g.log)}<small>jako můj · dočasně</small></button>)}
          {!list.length && <small className="muted logsw-e">Žádné uložené cizí logy (DB → Logy ostatních).</small>}
        </div>
      </>}
    </div>
  );
}

function title(s: Screen, st: ReturnType<typeof useStore>): string {
  return screenName(s, st);
}
function screenName(s: Screen, st: ReturnType<typeof useStore>): string {
  switch (s.t) {
    case "home": return "Přehled";
    case "dives": return "Ponory";
    case "dive": { const n = st.metas.findIndex((m) => m.id === s.id) + 1; return n ? `Ponor ${n}` : "Ponor"; }
    case "sites": return "B&L";
    case "site": return st.lb.sites[s.id]?.name || "Lokalita";
    case "buddies": return "B&L";
    case "buddy": return st.lb.buddies[s.id]?.name || "Buddy";
    case "settings": return "Nastavení";
    case "about": return "Co je nového";
    case "draft": return "Nový ponor";
    case "cells": return "O₂ čidla";
    case "bats": return "Baterie";
    case "warn": return "Varování";
    case "help": return "Nápověda";
    case "co2": return "Čidlo CO₂";
    case "cmp": return "Porovnání";
    case "hub": return s.sub === "db" ? "Databáze" : "Srovnání";
  }
}

function Body({ s }: { s: Screen }) {
  switch (s.t) {
    case "home": return <OverviewScreen />;
    case "dives": return <DivesScreen site={s.site} buddy={s.buddy} />;
    case "dive": return <DiveScreen id={s.id} />;
    case "sites": return <SitesScreen />;
    case "site": return <SiteScreen id={s.id} />;
    case "buddies": return <BuddiesScreen />;
    case "buddy": return <BuddyScreen id={s.id} />;
    case "settings": return <SettingsScreen />;
    case "about": return <AboutScreen />;
    case "draft": return <DraftScreen id={s.id} />;
    case "cells": return <CellsScreen pos={s.pos} install={s.install} />;
    case "bats": return <BatteriesScreen pos={s.pos} />;
    case "warn": return <WarningsScreen />;
    case "help": return <HelpScreen />;
    case "co2": return <Co2Screen />;
    case "cmp": return <CompareScreen id={s.id} other={s.other} />;
    case "hub": return <CompareHub sub={s.sub} who={s.who} />;
  }
}

const isTab = (s: Screen) => s.t !== "warn" && (s.t === "sites" || TABS.some(([t]) => t.t === s.t && !("site" in s && s.site) && !("buddy" in s && s.buddy)));

function App() {
  const s = useScreen();
  const st = useStore();
  // DB a Nastavení vždy s mými daty – otevřený cizí log se při vstupu zavře
  useEffect(() => { if ((s.t === "settings" || s.t === "hub") && st.guest) closeGuest(); }, [s.t]);
  useEffect(() => {
    init().then(async () => {
      if (!new URLSearchParams(location.search).has("shared")) return;
      history.replaceState(null, "", location.pathname);
      let msg = "";
      const r = await takeShared().catch((e: Error) => { msg = e?.message || ""; return null; });
      if (!r) { toast(`Sdílený soubor se nepodařilo načíst${msg ? `: ${msg}` : ""}`); return; }
      if (!r.log) { if (r.last) go({ t: "dive", id: r.last.id }); toast(r.own ? `Načten tvůj log: ${r.own} nových ponorů` : "Tvůj log je aktuální – žádné nové ponory"); return; }
      const who = logName(r.log);
      if (r.mine && r.last) { closeGuest(); go({ t: "cmp", id: r.mine.id, other: r.last.id }); toast(`Načten log: ${who} – porovnání s tvým ponorem`); }
      else if (r.last) { go({ t: "dive", id: r.last.id }); toast(`Načten log: ${who}. Porovnání nabídnu, až stáhneš svůj ponor.`); }
    });
  }, []);
  const [busy, setBusy] = useState(false);
  const [movedAt, setMovedAt] = useState<Record<string, number>>({});
  const w = useWarnings();
  const [anim, setAnim] = useState("");
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const st0 = touch.current; touch.current = null;
    if (!st0) return;
    const t = e.changedTouches[0], dx = t.clientX - st0.x, dy = t.clientY - st0.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    // Varování leží „před“ Přehledem: přejetí doprava na Přehledu je otevře, doleva na Varování vrátí zpět
    if (dx > 0 && s.t === "home") { setAnim("from-left"); go({ t: "warn" }); }
    else if (dx < 0 && s.t === "warn") { setAnim("from-right"); back(); }
  };
  // horní ＋: bez rozpracovaného ponoru založí nový; jinak 1. stisk aktualizuje polohu posledního rozpracovaného (📍), další ho otevře (E)
  const active = Object.values(st.lb.drafts).filter((d) => !d.diveId && localNow() - d.created <= 48 * 3600).sort((a, b) => b.created - a.created)[0];
  const moved = active && movedAt[active.id] && Date.now() - movedAt[active.id] < 30 * 60000;
  const newDive = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!active) { const id = await createDraft(); go({ t: "draft", id }); }
      else if (!moved) { const p = await locate(true); if (p) { await moveDraft(active.id, p, true); toast("Poloha a počasí rozpracovaného ponoru aktualizovány"); } else toast("Polohu se nepodařilo zjistit"); setMovedAt({ ...movedAt, [active.id]: Date.now() }); }
      else go({ t: "draft", id: active.id });
    } finally { setBusy(false); }
  };
  return (
    <div className="app">
      <DialogHost />
      <header className="top">
        {!isTab(s) ? <button className="back" onClick={back} aria-label="Zpět">‹</button> : <span className="logo" role="img" aria-label="myX" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />}
        {IS_DEV && <span className="dev-badge" title="Dev verze – testovací, vlastní kopie dat, bez synchronizace">DEV</span>}
        {s.t === "home" || s.t === "dives" && !s.site && !s.buddy || s.t === "sites" || s.t === "buddies" ? <LogSwitch label={screenName(s, st)} /> : <h1>{title(s, st)}</h1>}
        <button className="warnbtn none helpbtn" onClick={() => (s.t === "help" ? back() : go({ t: "help" }))} aria-label="Nápověda">?</button>
        <button className={"warnbtn " + (w.worst || "none")} onClick={() => (s.t === "warn" ? back() : (setAnim("from-left"), go({ t: "warn" })))} aria-label="Varování">
          ⚠{w.count > 0 && <span>{w.count}</span>}
        </button>
        {!st.guest && <button className={"plus" + (busy ? " busy" : "")} onClick={newDive} aria-label={!active ? "Nový ponor" : moved ? "Upravit rozpracovaný ponor" : "Aktualizovat polohu rozpracovaného ponoru"}>
          ＋{active && <span className="plus-badge">{moved ? "E" : "📍"}</span>}
        </button>}
      </header>
      {st.temp && !st.guest && (
        <div className="guestbar tempbar">
          <span>Log <b>{logName(st.temp)}</b> označený jako tvůj – jakékoli změny jsou jen dočasné, po restartu aplikace zmizí.</span>
          <button className="btn small" onClick={() => { closeTempOwn(); tab({ t: "home" }); }}>Zpět na můj log</button>
        </div>
      )}
      {st.guest && (
        <div className="guestbar">
          <span>Prohlížíš log: <b>{logName(st.guest)}</b> · {st.guest.count} ponorů</span>
          <button className="btn small" onClick={() => { closeGuest(); tab({ t: "home" }); }}>Zavřít</button>
        </div>
      )}
      {st.guest && !ownerName(st.guest) && st.guest.serial && <OwnerPicker log={st.guest} />}
      <main onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className={anim} key={s.t + ("id" in s ? s.id : "")} onAnimationEnd={() => setAnim("")}>
        {st.ready ? <Guard><Body s={s} /></Guard> : <p className="muted center">Načítám…</p>}
      </main>
      <nav className="tabs-bottom">
        {TABS.map(([t, l, ic]) => (
          <button key={l} className={s.t === t.t || (t.t === "dives" && s.t === "dive") || (t.t === "buddies" && ["buddy", "sites", "site"].includes(s.t)) || (t.t === "hub" && s.t === "cmp") ? "on" : ""} onClick={() => tab(t)}>
            <span>{ic}</span>{l}
          </button>
        ))}
      </nav>
      {st.toast && <div className="toast">{st.toast}</div>}
      <span hidden>{APP_VERSION}</span>
    </div>
  );
}

// žádné pole v aplikaci nemá nabízet automatické vyplnění (platební karty, adresy)
const noAutofill = (root: ParentNode) => root.querySelectorAll?.("input:not([type=file]):not([type=checkbox]):not([type=radio]):not([type=range]):not([data-af]), textarea:not([data-af])").forEach((el) => {
  el.setAttribute("autocomplete", (el as HTMLInputElement).type === "password" ? "new-password" : "off");
  el.setAttribute("data-af", "1");
  el.setAttribute("data-form-type", "other"); el.setAttribute("data-lpignore", "true");
});
new MutationObserver(() => noAutofill(document)).observe(document.body, { childList: true, subtree: true });
createRoot(document.getElementById("root")!).render(<App />);

// automatická aktualizace: nový service worker převezme stránku a ta se znovu načte
if ("serviceWorker" in navigator && location.protocol === "https:") {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
  locate();
  syncNow();
});
window.addEventListener("online", () => scheduleSync());
