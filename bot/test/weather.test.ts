import { describe, expect, it } from "vitest";
import { Weather } from "../src/weather";

// Open-Meteo's hourly forecast, New York local times.
const hourly = {
  time: ["2026-10-26T12:00", "2026-10-26T13:00"],
  temperature_2m: [16.8, 17.4],
  precipitation_probability: [0, 40],
  weather_code: [0, 61],
  wind_speed_10m: [8.2, 16.1],
};

function fakeFetch() {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ hourly }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("practice weather (Open-Meteo)", () => {
  it("gives the forecast at the practice's start hour, °F first then °C", async () => {
    const { fn } = fakeFetch();
    const w = new Weather(undefined, fn);
    expect(await w.at("2026-10-26T16:40:00Z")).toBe("62°F (17°C), clear, 0% chance of rain, wind 5 mph"); // 12:40 PM New York
    expect(await w.at("2026-10-26T17:10:00Z")).toBe("63°F (17°C), rain, 40% chance of rain, wind 10 mph");
  });

  it("says nothing for a practice beyond the forecast, and asks Open-Meteo once per half hour", async () => {
    let t = 0;
    const { fn, calls } = fakeFetch();
    const w = new Weather(undefined, fn, () => t);
    expect(await w.at("2026-11-20T16:00:00Z")).toBeNull();
    await w.at("2026-10-26T16:40:00Z");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/latitude=40\.7995&longitude=-73\.969/);
    t += 31 * 60_000;
    await w.at("2026-10-26T16:40:00Z");
    expect(calls).toHaveLength(2);
  });
});
