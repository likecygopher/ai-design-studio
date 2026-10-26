/**
 * Testable body of the `pnpm cleanup` CLI (spec R5.4 / task T53).
 *
 * `scripts/cleanup.ts` only wires argv + Prisma into this module, so the whole
 * decision/reporting path can be unit tested against a temporary directory.
 */
import { resolve } from "node:path";
import { executeCleanup, resolveRetentionDays, type CleanupExecutionResult } from "./cleanup";

export const DEFAULT_STORAGE_ROOT = "public";

export type CleanupCliOptions = {
  /** Absolute storage root that contains `uploads/` and `generated/`. */
  storageRoot: string;
  retentionDays: number;
  dryRun: boolean;
};

export type CleanupCliDeps = {
  /** Reads every `Asset.storageKey` (operator context: global scan on purpose). */
  listStorageKeys(): Promise<string[]>;
  /** Injectable for tests; defaults to `console.log`. */
  log?(line: string): void;
};

export type CleanupCliResult = {
  result: CleanupExecutionResult;
  exitCode: number;
};

export function parseCleanupArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  options: { cwd?: string; defaultStorageRoot?: string } = {}
): CleanupCliOptions {
  const cwd = options.cwd ?? process.cwd();
  const defaultStorageRoot = options.defaultStorageRoot ?? DEFAULT_STORAGE_ROOT;
  const dryRun = argv.includes("--dry-run") || argv.includes("-n");
  return {
    storageRoot: resolve(cwd, env.STORAGE_ROOT?.trim() || defaultStorageRoot),
    retentionDays: resolveRetentionDays(env.CLEANUP_RETENTION_DAYS),
    dryRun
  };
}

/**
 * Runs the cleanup and emits a human-readable log plus one machine-readable
 * summary line. Exit code 1 means at least one deletion failed (partial
 * success); configuration/database failures throw and are handled by the CLI.
 */
export async function runCleanupCli(
  options: CleanupCliOptions,
  deps: CleanupCliDeps
): Promise<CleanupCliResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const storageKeys = await deps.listStorageKeys();
  const result = await executeCleanup({
    storageRoot: options.storageRoot,
    knownStorageKeys: storageKeys,
    retentionDays: options.retentionDays,
    dryRun: options.dryRun
  });

  const action = options.dryRun ? "would-delete" : "delete";
  for (const deletion of result.deletions) {
    log(
      `[cleanup] ${action} ${deletion.storageKey} (${deletion.reason}, age=${deletion.ageDays}d, ${deletion.sizeBytes}B)`
    );
  }
  for (const kept of result.keptRecentOrphans) {
    log(
      `[cleanup] keep ${kept.storageKey} (orphan inside the ${result.retentionDays}d grace window)`
    );
  }
  for (const failure of result.failed) {
    log(`[cleanup] failed ${failure.storageKey}: ${failure.message}`);
  }
  for (const directory of result.prunedDirectories) {
    log(`[cleanup] pruned-empty-dir ${directory}`);
  }

  const deletedSet = new Set(result.deleted);
  const bytesReclaimed = result.deletions
    .filter((deletion) => deletedSet.has(deletion.storageKey))
    .reduce((sum, deletion) => sum + deletion.sizeBytes, 0);

  const summary = {
    event: "cleanup.finished",
    dryRun: result.dryRun,
    storageRoot: result.storageRoot,
    retentionDays: result.retentionDays,
    scannedFiles: result.scannedFiles,
    orphanFiles: result.orphanFiles,
    plannedDeletions: result.deletions.length,
    keptRecentOrphans: result.keptRecentOrphans.length,
    deleted: result.deleted.length,
    failed: result.failed.length,
    bytesReclaimable: result.bytesReclaimable,
    bytesReclaimed
  };
  log(JSON.stringify(summary));

  return { result, exitCode: result.failed.length > 0 ? 1 : 0 };
}
