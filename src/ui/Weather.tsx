import { useEffect, useState } from "react";
import { loadWeather, weatherText, type Weather } from "../app/weather";
import { Card, num } from "./common";

const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" });

export function WeatherCard({ lat, lon }: { lat: number; lon: number }) {
  const [w, setW] = useState<Weather | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadWeather(lat, lon).then((x) => live && setW(x)).catch(() => live && setErr(navigator.onLine ? "Počasí se nepodařilo načíst" : "Bez připojení – počasí není k dispozici"));
    return () => { live = false; };
  }, [lat.toFixed(3), lon.toFixed(3)]);
  return (
    <Card title="Počasí">
      {err ? <p className="muted">{err}</p> : !w ? <p className="muted">Načítám…</p> : (
        <>
          <p className="big">{num(w.now.temp, 1)} °C, {weatherText(w.now.code)}</p>
          <p className="muted">Vítr {num(w.now.wind, 1)} m/s (nárazy {num(w.now.gust, 0)}) · srážky {num(w.now.precip, 1)} mm · oblačnost {w.now.cloud} % · tlak {num(w.now.pressure, 0)} hPa</p>
          <div className="days">
            {w.days.map((d) => (
              <div key={d.date}><b>{day(d.date)}</b><span>{num(d.tmin, 0)}–{num(d.tmax, 0)} °C</span><span>{weatherText(d.code)}</span><span>{num(d.precip, 1)} mm · {num(d.wind, 0)} m/s</span></div>
            ))}
          </div>
          <p className="note">Zdroj: Open-Meteo</p>
        </>
      )}
    </Card>
  );
}
