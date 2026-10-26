import { afterEach, describe, expect, it, vi } from "vitest";
import { describeWeather } from "@/src/domain/weather";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("weather route", () => {
  it("maps WMO weather codes to compact labels", () => {
    expect(describeWeather(0)).toBe("Clear");
    expect(describeWeather(2)).toBe("Partly cloudy");
    expect(describeWeather(45)).toBe("Fog");
    expect(describeWeather(61)).toBe("Rain");
    expect(describeWeather(95)).toBe("Thunderstorm");
  });

  it("returns current Shunde weather from Open-Meteo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          current: {
            temperature_2m: 28.6,
            weather_code: 2
          }
        }),
        ok: true
      })
    );

    const response = await GET(new Request("http://localhost/api/weather"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      condition: "Partly cloudy",
      location: "Shunde",
      temperature: 28.6,
      weatherCode: 2
    });
  });
});