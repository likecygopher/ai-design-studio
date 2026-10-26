/**
 * Storage cleanup core (spec R5.4 / task T53).
 *
 * Compares files on disk under the storage areas (`uploads/`, `generated/`)
 * against `Asset.storageKey` rows in the database:
 *
 * - `uploads/**` orphans (no DB row) are removed immediately — an upload only
 *   becomes visible through the DB, so a leftover file is either a failed write
 *   or a leftover from a deleted user.
 * - `generated/**` orphans are only removed once they are older than the
 *   retention window (default 30 days): generated images are written before the
 *   DB row and a running worker may hold a just-written file for a moment.
 *
 * The module is filesystem/db agnostic: callers pass the known keys list and,
 * for execution, the root directory. This keeps the CLI (`scripts/cleanup.ts`)
 * thin and makes the planning logic unit-testable without a database.
 */
import { readdir, rm, rmdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export const STORAGE_AREAS = ["uploads", "generated"] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

export const DEFAULT_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_RETENTION_DAYS = 3650;

export type StorageFileEntry = {
  area: StorageArea;
  absolutePath: string;
  /** POSIX-style path relative to the storage root, matching `Asset.storageKey`. */
  storageKey: string;
  sizeBytes: number;
  modifiedAtMs: number;
};

export type CleanupDeletionReason = "orphan" | "expired-generated";

export type CleanupDeletion = {
  storageKey: string;
  absolutePath: string;
  area: StorageArea;
  reason: CleanupDeletionReason;
  sizeBytes: number;
  ageDays: number;
};

export type CleanupPlan = {
  storageRoot: string;
  retentionDays: number;
  scannedFiles: number;
  orphanFiles: number;
  deletions: CleanupDeletion[];
  /** Generated files without a DB row that are still inside the grace window. */
  keptRecentOrphans: Array<{ storageKey: string; ageDays: number }>;
  bytesReclaimable: number;
};

export type CleanupFailure = { storageKey: string; message: string };

export type CleanupExecutionResult = CleanupPlan & {
  dryRun: boolean;
  deleted: string[];
  failed: CleanupFailure[];
  prunedDirectories: string[];
};

export type CleanupOptions = {
  /** Absolute storage root (the directory containing `uploads/` and `generated/`). */
  storageRoot: string;
  /** `Asset.storageKey` values known to the database. */
  knownStorageKeys: Iterable<string>;
  /** Grace window for generated orphans, in days. */
  retentionDays?: number;
  /** Injectable clock for tests. */
  now?: number;
  /** Limit the scan to specific areas (defaults to all). */
  areas?: readonly StorageArea[];
};

/** Normalizes a DB storage key or a filesystem path to POSIX form. */
export function normalizeStorageKey(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

/**
 * Parses `CLEANUP_RETENTION_DAYS`. Invalid / non-positive values fall back to
 * the 30 day default so a typo can never turn the cleanup into "delete all".
 */
export function resolveRetentionDays(
  raw: string | undefined,
  fallback: number = DEFAULT_RETENTION_DAYS
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, MAX_RETENTION_DAYS);
}

function isStorageArea(value: string): value is StorageArea {
  return (STORAGE_AREAS as readonly string[]).includes(value);
}

async function walkArea(
  storageRoot: string,
  area: StorageArea,
  directory: string
): Promise<StorageFileEntry[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: StorageFileEntry[] = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkArea(storageRoot, area, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    let metadata;
    try {
      metadata = await stat(absolutePath);
    } catch (error) {
      // The file vanished between readdir and stat (concurrent cleanup/removal).
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    files.push({
      area,
      absolutePath,
      storageKey: normalizeStorageKey(relative(storageRoot, absolutePath)),
      sizeBytes: metadata.size,
      modifiedAtMs: metadata.mtimeMs
    });
  }
  return files;
}

export async function collectStorageFiles(
  storageRoot: string,
  areas: readonly StorageArea[] = STORAGE_AREAS
): Promise<StorageFileEntry[]> {
  const files: StorageFileEntry[] = [];
  for (const area of areas) {
    if (!isStorageArea(area)) {
      continue;
    }
    files.push(...(await walkArea(storageRoot, area, join(storageRoot, area))));
  }
  return files.sort((left, right) => left.storageKey.localeCompare(right.storageKey));
}

/** Builds the cleanup plan without touching the filesystem (aside from reading). */
export async function planCleanup(options: CleanupOptions): Promise<CleanupPlan> {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const retentionMs = retentionDays * MS_PER_DAY;
  const now = options.now ?? Date.now();
  const knownKeys = new Set<string>();
  for (const key of options.knownStorageKeys) {
    knownKeys.add(normalizeStorageKey(key));
  }

  const files = await collectStorageFiles(options.storageRoot, options.areas);
  const deletions: CleanupDeletion[] = [];
  const keptRecentOrphans: CleanupPlan["keptRecentOrphans"] = [];
  let orphanFiles = 0;
  let bytesReclaimable = 0;

  for (const file of files) {
    if (knownKeys.has(file.storageKey)) {
      continue;
    }
    orphanFiles += 1;
    const ageMs = Math.max(0, now - file.modifiedAtMs);
    const ageDays = Math.floor(ageMs / MS_PER_DAY);

    if (file.area === "generated" && ageMs < retentionMs) {
      // Grace window: a generated file may be written slightly before its row.
      keptRecentOrphans.push({ storageKey: file.storageKey, ageDays });
      continue;
    }

    deletions.push({
      storageKey: file.storageKey,
      absolutePath: file.absolutePath,
      area: file.area,
      reason: file.area === "generated" ? "expired-generated" : "orphan",
      sizeBytes: file.sizeBytes,
      ageDays
    });
    bytesReclaimable += file.sizeBytes;
  }

  return {
    storageRoot: options.storageRoot,
    retentionDays,
    scannedFiles: files.length,
    orphanFiles,
    deletions,
    keptRecentOrphans,
    bytesReclaimable
  };
}

/**
 * Removes empty directories left behind after deleting files, bottom-up.
 * Best effort: failures are ignored (a directory may be re-populated
 * concurrently by an upload).
 */
async function pruneEmptyDirectories(storageRoot: string, area: StorageArea): Promise<string[]> {
  const pruned: string[] = [];
  const areaDir = join(storageRoot, area);

  async function prune(directory: string, isAreaRoot: boolean): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    let empty = true;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const childEmpty = await prune(join(directory, entry.name), false);
        if (!childEmpty) {
          empty = false;
        }
      } else {
        empty = false;
      }
    }
    if (empty && !isAreaRoot) {
      try {
        await rmdir(directory);
        pruned.push(normalizeStorageKey(relative(storageRoot, directory)));
        return true;
      } catch {
        return false;
      }
    }
    return empty;
  }

  await prune(areaDir, true);
  return pruned;
}

export type CleanupExecutionOptions = CleanupOptions & {
  /** When true, only report what would be deleted. */
  dryRun?: boolean;
};

/**
 * Plans and optionally executes the cleanup. In dry-run mode the filesystem is
 * never mutated and the plan is returned as-is.
 */
export async function executeCleanup(
  options: CleanupExecutionOptions
): Promise<CleanupExecutionResult> {
  const plan = await planCleanup(options);
  const dryRun = options.dryRun === true;

  if (dryRun) {
    return { ...plan, dryRun, deleted: [], failed: [], prunedDirectories: [] };
  }

  const deleted: string[] = [];
  const failed: CleanupFailure[] = [];
  for (const deletion of plan.deletions) {
    try {
      await rm(deletion.absolutePath, { force: true });
      deleted.push(deletion.storageKey);
    } catch (error) {
      failed.push({
        storageKey: deletion.storageKey,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const areas = options.areas ?? STORAGE_AREAS;
  const prunedDirectories: string[] = [];
  for (const area of areas) {
    prunedDirectories.push(...(await pruneEmptyDirectories(options.storageRoot, area)));
  }

  return { ...plan, dryRun, deleted, failed, prunedDirectories };
}
