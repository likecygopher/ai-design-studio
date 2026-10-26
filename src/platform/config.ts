import { z } from "zod";

/**
 * Central, validated runtime configuration.
 *
 * Design notes:
 * - Parsing never throws at import time: `next build` and unit tests import modules
 *   that read config, and must not require a live database/secret.
 * - `assertRuntimeConfig()` is called from `instrumentation.ts` at server start and
 *   fails fast in production when required secrets are missing or too weak.
 */

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().optional(),

  STORAGE_ROOT: z.string().min(1).default("public"),
  /** Storage backend: local filesystem (default) or S3-compatible object storage. */
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  S3_PREFIX: z.string().min(1).default("midea-ai"),

  // Job queue
  JOB_CONCURRENCY: positiveInt(3),
  MAX_USER_ACTIVE_JOBS: positiveInt(2),
  JOB_LOCK_MS: positiveInt(15 * 60 * 1000),
  JOB_POLL_INTERVAL_MS: positiveInt(1500),
  JOB_MAX_ATTEMPTS: positiveInt(3),
  JOB_REQUIRE_APPROVAL: z.enum(["true", "false"]).optional(),
  JOB_RETRY_BASE_MS: positiveInt(5000),
  JOB_RETRY_MAX_MS: positiveInt(5 * 60 * 1000),
  WORKER_HEARTBEAT_MS: positiveInt(10 * 1000),
  WORKER_HEARTBEAT_STALE_MS: positiveInt(60 * 1000),

  // Usage budget (estimated AI units per user per month); unset = unlimited.
  DEFAULT_MONTHLY_BUDGET_UNITS: z.coerce.number().int().min(0).optional(),

  // Redis (optional): distributed rate limiting
  REDIS_URL: z.string().url().optional(),

  // Observability
  METRICS_TOKEN: z.string().min(16).optional(),
  ALERT_QUEUE_DEPTH: positiveInt(100),
  ALERT_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.2),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ALERT_COOLDOWN_MS: positiveInt(15 * 60 * 1000),

  // Uploads / storage
  MAX_UPLOAD_BYTES: positiveInt(30 * 1024 * 1024),
  MAX_FILES_PER_REQUEST: positiveInt(10),
  USER_STORAGE_QUOTA_BYTES: positiveInt(2 * 1024 * 1024 * 1024),

  // Auth
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
  AUTH_SESSION_MAX_AGE_S: positiveInt(7 * 24 * 60 * 60),
  AUTH_SESSION_UPDATE_AGE_S: positiveInt(24 * 60 * 60),
  LOGIN_MAX_ATTEMPTS: positiveInt(5),
  LOGIN_WINDOW_MS: positiveInt(15 * 60 * 1000),

  // API rate limiting
  RATE_LIMIT_LIMIT: positiveInt(30),
  RATE_LIMIT_WINDOW_MS: positiveInt(60 * 1000),

  // Seed only
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional()
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) {
    return parsed.data;
  }
  // Invalid explicit values are a hard error: silently falling back to defaults
  // would hide misconfiguration (e.g. JOB_CONCURRENCY=abc).
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env: Env = parseEnv(process.env);

export const PLATFORM_CONFIG = {
  /** Whole-platform image/video jobs that may run at once. */
  jobConcurrency: env.JOB_CONCURRENCY,
  /** Platform-default monthly AI budget in estimated units; null = unlimited. */
  defaultMonthlyBudgetUnits: env.DEFAULT_MONTHLY_BUDGET_UNITS ?? null,
  /** Optional Redis URL; when set, API/login rate limits are shared across replicas. */
  redisUrl: env.REDIS_URL ?? null,
  /** Optional bearer token for unauthenticated Prometheus scrapes. */
  metricsToken: env.METRICS_TOKEN ?? null,
  /** Queue depth that raises a warning alert. */
  alertQueueDepth: env.ALERT_QUEUE_DEPTH,
  /** 24h job failure rate that raises a warning alert (0..1). */
  alertFailureRate: env.ALERT_FAILURE_RATE,
  /** Optional Slack-compatible webhook that receives platform alerts. */
  alertWebhookUrl: env.ALERT_WEBHOOK_URL ?? null,
  /** Minimum interval between identical alert notifications. */
  alertCooldownMs: env.ALERT_COOLDOWN_MS,
  /** Per-user active jobs (queued+running) before new submissions are rejected. */
  maxUserActiveJobs: env.MAX_USER_ACTIVE_JOBS,
  /** Worker claim lease, milliseconds. */
  jobLockMs: env.JOB_LOCK_MS,
  /** Frontend/API poll interval suggestion. */
  jobPollIntervalMs: env.JOB_POLL_INTERVAL_MS,
  /** Retry policy for failed jobs. */
  jobMaxAttempts: env.JOB_MAX_ATTEMPTS,
  /** Global approval gate for new jobs (per-user flag can also enable it). */
  jobRequireApproval: env.JOB_REQUIRE_APPROVAL === "true",
  jobRetryBaseMs: env.JOB_RETRY_BASE_MS,
  jobRetryMaxMs: env.JOB_RETRY_MAX_MS,
  /** Worker liveness. */
  workerHeartbeatMs: env.WORKER_HEARTBEAT_MS,
  workerHeartbeatStaleMs: env.WORKER_HEARTBEAT_STALE_MS,
  /** Storage & upload limits. */
  storageRoot: env.STORAGE_ROOT,
  storageDriver: env.STORAGE_DRIVER,
  s3Endpoint: env.S3_ENDPOINT ?? null,
  s3Region: env.S3_REGION,
  s3Bucket: env.S3_BUCKET ?? null,
  s3AccessKeyId: env.S3_ACCESS_KEY_ID ?? null,
  s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY ?? null,
  s3ForcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  s3Prefix: env.S3_PREFIX,
  maxUploadBytes: env.MAX_UPLOAD_BYTES,
  maxFilesPerRequest: env.MAX_FILES_PER_REQUEST,
  userStorageQuotaBytes: env.USER_STORAGE_QUOTA_BYTES,
  /** Auth. */
  bcryptCost: env.BCRYPT_COST,
  authSessionMaxAgeSec: env.AUTH_SESSION_MAX_AGE_S,
  authSessionUpdateAgeSec: env.AUTH_SESSION_UPDATE_AGE_S,
  loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
  loginWindowMs: env.LOGIN_WINDOW_MS,
  /** API rate limit defaults. */
  rateLimitLimit: env.RATE_LIMIT_LIMIT,
  rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS
} as const;

export function isProduction(): boolean {
  return env.NODE_ENV === "production";
}

export function isTest(): boolean {
  return env.NODE_ENV === "test";
}

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is required for multi-user auth. Generate one with `openssl rand -base64 32`."
    );
  }
  return secret;
}

const MIN_SECRET_LENGTH = 32;

/**
 * Fail-fast validation for server start. Safe to call repeatedly.
 * Build phase is skipped by the caller (`instrumentation.ts`).
 */
export function assertRuntimeConfig(): void {
  const problems: string[] = [];

  if (!process.env.DATABASE_URL) {
    problems.push("DATABASE_URL is required to run the platform.");
  }

  const secret = process.env.AUTH_SECRET;
  const ssoVars = [
    process.env.SSO_ISSUER,
    process.env.SSO_CLIENT_ID,
    process.env.SSO_CLIENT_SECRET
  ];
  if (ssoVars.some(Boolean) && !ssoVars.every(Boolean)) {
    problems.push(
      "SSO_ISSUER, SSO_CLIENT_ID and SSO_CLIENT_SECRET must be set together."
    );
  }

  if (PLATFORM_CONFIG.storageDriver === "s3") {
    if (!PLATFORM_CONFIG.s3Bucket) {
      problems.push("STORAGE_DRIVER=s3 requires S3_BUCKET.");
    }
    const hasKey = Boolean(process.env.S3_ACCESS_KEY_ID);
    const hasSecret = Boolean(process.env.S3_SECRET_ACCESS_KEY);
    if (hasKey !== hasSecret) {
      problems.push("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together.");
    }
  }

  if (!secret) {
    problems.push("AUTH_SECRET is required. Generate one with `openssl rand -base64 32`.");
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length}).`
    );
  }

  if (problems.length > 0) {
    if (isProduction()) {
      throw new Error(`Platform configuration is invalid:\n- ${problems.join("\n- ")}`);
    }
    // Development/test: warn but stay usable so unit tests and `next build` work.
    console.warn(`[config] ${problems.join(" ")} (allowed outside production)`);
  }
}

/** Redacted config summary for startup logs. Never includes secrets. */
export function describeRuntimeConfig(): Record<string, unknown> {
  return {
    nodeEnv: env.NODE_ENV,
    jobConcurrency: PLATFORM_CONFIG.jobConcurrency,
    maxUserActiveJobs: PLATFORM_CONFIG.maxUserActiveJobs,
    maxUploadBytes: PLATFORM_CONFIG.maxUploadBytes,
    userStorageQuotaBytes: PLATFORM_CONFIG.userStorageQuotaBytes,
    rateLimit: `${PLATFORM_CONFIG.rateLimitLimit}/${PLATFORM_CONFIG.rateLimitWindowMs}ms`
  };
}
