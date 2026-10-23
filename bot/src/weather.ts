import { toLocalInputs } from "../../src/lib/time";

// Practice weather for Gemini ("@bot how's the weather Monday?"), from
// Open-Meteo: free, no key, hourly forecasts up to 16 days ahead. Only the
// field's coordinates are sent, nothing about members.

export const RIVERSIDE_PARK = { lat: 40.7995, lon: -73.969 }; // 103rd St entrance
const CACHE_MS = 30 * 60_000;

type Hourly = { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[]; wind_speed_10m: number[] };

/** WMO weather codes in words. */
function describe(code: number) {
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "cloudy";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorms";
}

export class Weather {
  private cache: { at: number; hourly: Hourly } | null = null;

  constructor(
    private place = RIVERSIDE_PARK,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  /** The forecast at a time ("57°F (14°C), cloudy, 10% chance of rain, wind 5 mph"), or null if it's out of range. */
  async at(iso: string): Promise<string | null> {
    const h = await this.hourly();
    const { date, time } = toLocalInputs(iso);
    const i = h.time.indexOf(`${date}T${time.slice(0, 2)}:00`);
    if (i < 0) return null;
    const c = h.temperature_2m[i];
    const f = Math.round((c * 9) / 5 + 32);
    const mph = Math.round(h.wind_speed_10m[i] / 1.609);
    return `${f}°F (${Math.round(c)}°C), ${describe(h.weather_code[i])}, ${h.precipitation_probability[i]}% chance of rain, wind ${mph} mph`;
  }

  private async hourly(): Promise<Hourly> {
    if (this.cache && this.now() - this.cache.at < CACHE_MS) return this.cache.hourly;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${this.place.lat}&longitude=${this.place.lon}` +
      "&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&timezone=America%2FNew_York&forecast_days=16";
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
    const hourly = ((await res.json()) as { hourly: Hourly }).hourly;
    this.cache = { at: this.now(), hourly };
    return hourly;
  }
}
