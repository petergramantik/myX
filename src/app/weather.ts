// Aktuální počasí a předpověď z Open-Meteo (zdarma, bez klíče).
export interface Weather {
  fetched: number;
  now: { temp: number; wind: number; gust: number; precip: number; cloud: number; pressure: number; code: number };
  days: { date: string; tmin: number; tmax: number; precip: number; wind: number; code: number }[];
}

const cache = new Map<string, Weather>();

export async function loadWeather(lat: number, lon: number): Promise<Weather> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const c = cache.get(key);
  if (c && Date.now() - c.fetched < 15 * 60000) return c;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,cloud_cover,surface_pressure,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code&timezone=auto&forecast_days=3&wind_speed_unit=ms`;
  const r = await fetch(u);
  if (!r.ok) throw new Error("Počasí se nepodařilo načíst");
  const j = await r.json();
  const w: Weather = {
    fetched: Date.now(),
    now: {
      temp: j.current.temperature_2m, wind: j.current.wind_speed_10m, gust: j.current.wind_gusts_10m, precip: j.current.precipitation,
      cloud: j.current.cloud_cover, pressure: j.current.surface_pressure, code: j.current.weather_code,
    },
    days: j.daily.time.map((d: string, i: number) => ({
      date: d, tmin: j.daily.temperature_2m_min[i], tmax: j.daily.temperature_2m_max[i], precip: j.daily.precipitation_sum[i],
      wind: j.daily.wind_speed_10m_max[i], code: j.daily.weather_code[i],
    })),
  };
  cache.set(key, w);
  return w;
}

export function weatherText(code: number): string {
  if (code === 0) return "jasno";
  if (code <= 2) return "polojasno";
  if (code === 3) return "zataženo";
  if (code <= 48) return "mlha";
  if (code <= 57) return "mrholení";
  if (code <= 67) return "déšť";
  if (code <= 77) return "sněžení";
  if (code <= 82) return "přeháňky";
  if (code <= 86) return "sněhové přeháňky";
  return "bouřky";
}

/** Počasí v daném čase (hodinová data Open-Meteo, i zpětně do ~3 měsíců). localSec = místní čas v sekundách (jako začátek ponoru v logu). */
export async function weatherAt(lat: number, lon: number, localSec: number): Promise<{ at: number; temp: number; wind: number; gust: number; cloud: number; pressure: number; precip: number; code: number } | null> {
  const d = new Date(localSec * 1000), day = d.toISOString().slice(0, 10), hour = `${day}T${String(d.getUTCHours()).padStart(2, "0")}:00`;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,cloud_cover,surface_pressure,weather_code&start_date=${day}&end_date=${day}&timezone=auto&wind_speed_unit=ms`;
  const r = await fetch(u);
  if (!r.ok) return null;
  const h = (await r.json()).hourly;
  const i = h?.time?.indexOf(hour) ?? -1;
  if (i < 0 || h.temperature_2m[i] == null) return null;
  return { at: localSec * 1000, temp: h.temperature_2m[i], wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i], cloud: h.cloud_cover[i], pressure: h.surface_pressure[i], precip: h.precipitation[i], code: h.weather_code[i] };
}
