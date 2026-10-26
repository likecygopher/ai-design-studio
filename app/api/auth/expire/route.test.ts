// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./route";

function request(headers: Record<string, string> = {}) {
  return new Request("http://internal:3000/api/auth/expire", { headers });
}

describe("GET /api/auth/expire", () => {
  it("redirects to /login?expired=1 and clears every session cookie", () => {
    const response = GET(request({ host: "studio.example.com" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://studio.example.com/login?expired=1");

    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("authjs.session-token=;"))).toBe(true);
    expect(
      cookies.some((cookie) => cookie.startsWith("__Secure-authjs.session-token=;"))
    ).toBe(true);
    expect(cookies.every((cookie) => cookie.includes("Max-Age=0"))).toBe(true);
  });

  it("honours forwarded host and protocol from a reverse proxy", () => {
    const response = GET(
      request({
        "x-forwarded-host": "content.midea.example",
        "x-forwarded-proto": "https"
      })
    );

    expect(response.headers.get("location")).toBe(
      "https://content.midea.example/login?expired=1"
    );
  });

  it("falls back to the request host when headers are absent", () => {
    const response = GET(request({ host: "127.0.0.1:3212" }));
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3212/login?expired=1");
  });
});
