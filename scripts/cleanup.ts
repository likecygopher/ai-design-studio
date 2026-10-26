/**
 * `pnpm cleanup` — remove orphan / expired files under the storage root.
 *
 * Usage:
 *   tsx scripts/cleanup.ts --dry-run   # report only, never touches files
 *   tsx scripts/cleanup.ts             # delete orphans
 *
 * Environment:
 *   STORAGE_ROOT              storage root that contains uploads/ + generated/ (default: public)
 *   CLEANUP_RETENTION_DAYS    grace window for generated orphans, days (default: 30)
 *
 * Requires `DATABASE_URL` (Prisma). Like `scripts/worker.ts`, this CLI reads
 * `process.env` directly, so run it with the environment loaded (docker compose
 * or `set -a; . ./.env; set +a`).
 */
import { PLATFORM_CONFIG } from "../src/platform/config";
import { prisma } from "../src/platform/db";
import { parseCleanupArgs, runCleanupCli } from "../src/platform/storage/cleanup-cli";

async function main(): Promise<void> {
  const options = parseCleanupArgs(process.argv.slice(2), process.env, {
    defaultStorageRoot: PLATFORM_CONFIG.storageRoot
  });
  console.log(
    `[cleanup] start storageRoot=${options.storageRoot} retentionDays=${options.retentionDays} dryRun=${options.dryRun}`
  );

  const { exitCode } = await runCleanupCli(options, {
    listStorageKeys: async () => {
      // Operator CLI: intentionally scans every tenant's assets. No user data is
      // read (only storage keys) and nothing is returned to a client.
      const rows = await prisma.asset.findMany({ select: { storageKey: true } });
      return rows.map((row) => row.storageKey);
    }
  });

  const cutoff = new Date(Date.now() - options.retentionDays * 24 * 60 * 60 * 1000);
  const removed = await prisma.authSession.deleteMany({
    where: {
      OR: [{ revokedAt: { not: null, lt: cutoff } }, { lastSeenAt: { lt: cutoff } }]
    }
  });
  console.log(`[cleanup] stale auth sessions removed=${removed.count}`);

  process.exitCode = exitCode;
}

main()
  .catch((error: unknown) => {
    console.error(
      `[cleanup] failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
