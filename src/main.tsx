import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { init, locate, scheduleSync, syncNow } from "./app/store";
import { back, go, tab, useScreen, useStore, type Screen } from "./ui/common";
import { OverviewScreen } from "./ui/Overview";
import { DiveScreen, DivesScreen } from "./ui/Dives";
import { BuddiesScreen, BuddyScreen, SiteScreen, SitesScreen } from "./ui/Sites";
import { AboutScreen, SettingsScreen } from "./ui/Settings";
import { DraftScreen } from "./ui/Draft";
import { CellsScreen } from "./ui/Cells";
import { BatteriesScreen } from "./ui/Batteries";
import { createDraft } from "./app/store";
import { APP_VERSION } from "./app/version";
import "./ui/app.css";

const TABS: [Screen, string, string][] = [
  [{ t: "home" }, "Přehled", "◉"], [{ t: "dives" }, "Ponory", "≋"], [{ t: "sites" }, "Lokality", "⌖"],
  [{ t: "buddies" }, "Parťáci", "☺"], [{ t: "settings" }, "Nastavení", "⚙"],
];

function title(s: Screen, st: ReturnType<typeof useStore>): string {
  return "myX – " + screenName(s, st);
}
function screenName(s: Screen, st: ReturnType<typeof useStore>): string {
  switch (s.t) {
    case "home": return "Přehled";
    case "dives": return "Ponory";
    case "dive": { const n = st.metas.findIndex((m) => m.id === s.id) + 1; return n ? `Ponor ${n}` : "Ponor"; }
    case "sites": return "Lokality";
    case "site": return st.lb.sites[s.id]?.name || "Lokalita";
    case "buddies": return "Parťáci";
    case "buddy": return st.lb.buddies[s.id]?.name || "Parťák";
    case "settings": return "Nastavení";
    case "about": return "Co je nového";
    case "draft": return "Nový ponor";
    case "cells": return "O₂ čidla";
    case "bats": return "Baterie";
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
  }
}

const isTab = (s: Screen) => TABS.some(([t]) => t.t === s.t && !("site" in s && s.site) && !("buddy" in s && s.buddy));

function App() {
  const s = useScreen();
  const st = useStore();
  useEffect(() => { init(); }, []);
  const [busy, setBusy] = useState(false);
  const newDive = async () => { if (busy) return; setBusy(true); try { const id = await createDraft(); go({ t: "draft", id }); } finally { setBusy(false); } };
  return (
    <div className="app">
      <header className="top">
        {!isTab(s) ? <button className="back" onClick={back} aria-label="Zpět">‹</button> : <span className="logo">X</span>}
        <h1>{title(s, st)}</h1>
        <button className={"plus" + (busy ? " busy" : "")} onClick={newDive} aria-label="Nový ponor">＋</button>
      </header>
      <main>{st.ready ? <Body s={s} /> : <p className="muted center">Načítám…</p>}</main>
      <nav className="tabs-bottom">
        {TABS.map(([t, l, ic]) => (
          <button key={l} className={s.t === t.t || (t.t === "dives" && s.t === "dive") || (t.t === "sites" && s.t === "site") || (t.t === "buddies" && s.t === "buddy") ? "on" : ""} onClick={() => tab(t)}>
            <span>{ic}</span>{l}
          </button>
        ))}
      </nav>
      {st.toast && <div className="toast">{st.toast}</div>}
      <span hidden>{APP_VERSION}</span>
    </div>
  );
}

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
