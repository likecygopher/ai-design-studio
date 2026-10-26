// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/openapi", () => {
  it("serves an OpenAPI document without secrets", async () => {
    const response = GET();
    const spec = await response.json();
    expect(response.status).toBe(200);
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/api/jobs"]).toBeTruthy();
    expect(spec.paths["/api/account/api-tokens"]).toBeTruthy();
    expect(JSON.stringify(spec)).not.toMatch(/mcs_[A-Za-z0-9_-]{10,}/);
  });
});
