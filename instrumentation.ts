/**
 * Next.js server startup hook: validate critical configuration and emit a
 * redacted startup summary. Runs only in the Node.js server runtime, never
 * during the production build phase.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const { assertRuntimeConfig, describeRuntimeConfig } = await import("@/src/platform/config");
  assertRuntimeConfig();

  // AI provider settings are hydrated lazily from provider entry points
  // (see src/platform/ai-config.ts). Importing node:crypto here would break the
  // Edge instrumentation bundle.
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "platform.startup",
      ...describeRuntimeConfig()
    })
  );
}
