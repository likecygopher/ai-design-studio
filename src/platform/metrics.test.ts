// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  incrementCounter,
  normalizeRoute,
  recordHttpRequest,
  observeHistogram,
  renderMetrics,
  resetMetricsForTests
} from "./metrics";

beforeEach(() => {
  resetMetricsForTests();
});

describe("normalizeRoute", () => {
  it("replaces ids but keeps static segments", () => {
    expect(normalizeRoute("/api/jobs/cmvotw2jw0005mxij1glpy4ns/retry")).toBe(
      "/api/jobs/:id/retry"
    );
    expect(normalizeRoute("/api/users/123")).toBe("/api/users/:id");
    expect(
      normalizeRoute("/api/sessions/3f2504e0-4f89-11d3-9a0c-0305e82c3301")
    ).toBe("/api/sessions/:id");
    expect(normalizeRoute("/api/admin/ai/providers")).toBe("/api/admin/ai/providers");
  });
});

describe("metrics rendering", () => {
  it("renders counters and histogram buckets in Prometheus text format", () => {
    incrementCounter("test_requests_total", "test counter", { route: "/api/x", status: "200" });
    incrementCounter("test_requests_total", "test counter", { route: "/api/x", status: "200" });
    observeHistogram("test_latency_ms", "test histogram", [10, 100], 42, { route: "/api/x" });

    const text = renderMetrics();
    expect(text).toContain("# TYPE test_requests_total counter");
    expect(text).toContain('test_requests_total{route="/api/x",status="200"} 2');
    expect(text).toContain('test_latency_ms_bucket{le="10",route="/api/x"} 0');
    expect(text).toContain('test_latency_ms_bucket{le="100",route="/api/x"} 1');
    expect(text).toContain('test_latency_ms_bucket{le="+Inf",route="/api/x"} 1');
    expect(text).toContain('test_latency_ms_sum{route="/api/x"} 42');
    expect(text).toContain('test_latency_ms_count{route="/api/x"} 1');
    expect(text).toContain("process_uptime_seconds");
  });

  it("records HTTP requests with normalized routes", () => {
    recordHttpRequest({
      method: "get",
      route: "/api/jobs/abc123def456ghi789/retry",
      status: 200,
      durationMs: 12
    });
    const text = renderMetrics();
    expect(text).toContain('studio_http_requests_total{method="GET",route="/api/jobs/:id/retry",status="200"} 1');
    expect(text).toContain("studio_http_request_duration_ms_count");
  });

  it("escapes labels", () => {
    incrementCounter("test_escape_total", "escape", { value: 'a"b\\c' });
    expect(renderMetrics()).toContain('test_escape_total{value="a\\"b\\\\c"} 1');
  });
});
