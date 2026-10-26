/**
 * Dependency-free Prometheus metrics registry.
 *
 * Counters/histograms are intentionally small and label sets are bounded:
 * routes are normalized (ids → :id) so scrapes never explode cardinality.
 */

type Labels = Record<string, string>;

type CounterSeries = { labels: Labels; value: number };
type CounterDef = { help: string; series: Map<string, CounterSeries> };
type HistogramDef = {
  help: string;
  buckets: number[];
  series: Map<string, { labels: Labels; buckets: number[]; sum: number; count: number }>;
};

const counters = new Map<string, CounterDef>();
const histograms = new Map<string, HistogramDef>();

export const HTTP_DURATION_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
export const JOB_DURATION_BUCKETS_MS = [1000, 5000, 15000, 30000, 60000, 120000, 300000, 600000];

function labelsKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  if (entries.length === 0) {
    return "";
  }
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

export function incrementCounter(name: string, help: string, labels: Labels = {}, amount = 1): void {
  let def = counters.get(name);
  if (!def) {
    def = { help, series: new Map() };
    counters.set(name, def);
  }
  const key = labelsKey(labels);
  const series = def.series.get(key) ?? { labels, value: 0 };
  series.value += amount;
  def.series.set(key, series);
}

export function observeHistogram(
  name: string,
  help: string,
  buckets: number[],
  value: number,
  labels: Labels = {}
): void {
  let def = histograms.get(name);
  if (!def) {
    def = { help, buckets: [...buckets].sort((a, b) => a - b), series: new Map() };
    histograms.set(name, def);
  }
  const key = labelsKey(labels);
  const series =
    def.series.get(key) ??
    { labels, buckets: new Array(def.buckets.length + 1).fill(0), sum: 0, count: 0 };
  let index = def.buckets.findIndex((bucket) => value <= bucket);
  if (index === -1) {
    index = def.buckets.length;
  }
  series.buckets[index] += 1;
  series.sum += value;
  series.count += 1;
  def.series.set(key, series);
}

/** Replace high-cardinality path ids with `:id` (cuid/uuid/numeric/hex). */
export function normalizeRoute(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
        return ":id";
      }
      if (/^[a-z0-9]{16,}$/i.test(segment) && /\d/.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const labels = {
    method: input.method.toUpperCase(),
    route: normalizeRoute(input.route),
    status: String(input.status)
  };
  incrementCounter("studio_http_requests_total", "HTTP requests handled by the API wrapper.", labels);
  observeHistogram(
    "studio_http_request_duration_ms",
    "API request duration in milliseconds.",
    HTTP_DURATION_BUCKETS_MS,
    input.durationMs,
    { method: labels.method, route: labels.route }
  );
}

export function recordRateLimitRejection(route: string): void {
  incrementCounter("studio_rate_limit_rejections_total", "Requests rejected by rate limiting.", {
    route: normalizeRoute(route)
  });
}

export function recordJobEnqueued(type: string): void {
  incrementCounter("studio_jobs_enqueued_total", "Jobs enqueued.", { type });
}

export function recordJobOutcome(input: { ok: boolean; durationMs: number; type?: string }): void {
  incrementCounter(
    input.ok ? "studio_jobs_completed_total" : "studio_jobs_failed_total",
    "Job attempts by outcome.",
    input.type ? { type: input.type } : {}
  );
  observeHistogram(
    "studio_job_duration_ms",
    "Job execution duration in milliseconds.",
    JOB_DURATION_BUCKETS_MS,
    input.durationMs,
    input.ok ? { outcome: "success" } : { outcome: "failure" }
  );
}

export function recordBudgetBlocked(): void {
  incrementCounter("studio_jobs_blocked_budget_total", "Jobs blocked by the monthly budget.");
}

export function recordProviderOutcome(input: { ok: boolean; channel: string }): void {
  incrementCounter(
    input.ok ? "studio_provider_calls_total" : "studio_provider_failures_total",
    "Provider call outcomes by channel.",
    { channel: input.channel, outcome: input.ok ? "success" : "failure" }
  );
}

export function renderMetrics(): string {
  const lines: string[] = [];

  for (const [name, def] of counters) {
    lines.push(`# HELP ${name} ${def.help}`);
    lines.push(`# TYPE ${name} counter`);
    for (const series of def.series.values()) {
      lines.push(`${name}${formatLabels(series.labels)} ${series.value}`);
    }
  }

  for (const [name, def] of histograms) {
    lines.push(`# HELP ${name} ${def.help}`);
    lines.push(`# TYPE ${name} histogram`);
    for (const series of def.series.values()) {
      let cumulative = 0;
      for (let index = 0; index < def.buckets.length; index += 1) {
        cumulative += series.buckets[index];
        lines.push(
          `${name}_bucket${formatLabels({ ...series.labels, le: String(def.buckets[index]) })} ${cumulative}`
        );
      }
      cumulative += series.buckets[def.buckets.length];
      lines.push(`${name}_bucket${formatLabels({ ...series.labels, le: "+Inf" })} ${cumulative}`);
      lines.push(`${name}_sum${formatLabels(series.labels)} ${series.sum}`);
      lines.push(`${name}_count${formatLabels(series.labels)} ${series.count}`);
    }
  }

  const memory = process.memoryUsage();
  lines.push("# HELP process_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(`process_uptime_seconds ${process.uptime()}`);
  lines.push("# HELP process_resident_memory_bytes Resident memory size in bytes.");
  lines.push("# TYPE process_resident_memory_bytes gauge");
  lines.push(`process_resident_memory_bytes ${memory.rss}`);
  lines.push("# HELP nodejs_heap_used_bytes Node.js heap used in bytes.");
  lines.push("# TYPE nodejs_heap_used_bytes gauge");
  lines.push(`nodejs_heap_used_bytes ${memory.heapUsed}`);

  return `${lines.join("\n")}\n`;
}

/** Tests only: reset the in-process registry. */
export function resetMetricsForTests(): void {
  counters.clear();
  histograms.clear();
}
