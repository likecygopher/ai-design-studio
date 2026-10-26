import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { describeWeather } from "@/src/domain/weather";

const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=22.8057&longitude=113.2934&current=temperature_2m,weather_code&timezone=Asia%2FShanghai";

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
};

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "public", rateLimit: { name: "weather", key: "ip", limit: 30, windowMs: 60_000 } },
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);

      try {
        const response = await fetch(WEATHER_URL, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error("Open-Meteo HTTP " + response.status);
        }

        const payload = (await response.json()) as OpenMeteoResponse;
        const temperature = payload.current?.temperature_2m;
        const weatherCode = payload.current?.weather_code;
        if (!Number.isFinite(temperature) || !Number.isFinite(weatherCode)) {
          throw new Error("Open-Meteo response is missing current weather");
        }

        return NextResponse.json({
          condition: describeWeather(weatherCode as number),
          location: "Shunde",
          temperature,
          weatherCode
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Weather request failed";
        return NextResponse.json({ error: message }, { status: 502 });
      } finally {
        clearTimeout(timer);
      }
    }
  );
}
