import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCleanupArgs, runCleanupCli } from "./cleanup-cli";

const DAY_MS = 24 * 60 * 60 * 1000;
let root: string;

async function writeStorageFile(relativePath: string, ageDays = 0): Promise<string> {
  const absolutePath = join(root, relativePath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, "x");
  if (ageDays > 0) {
    const seconds = Math.floor((Date.now() - ageDays * DAY_MS) / 1000);
    await utimes(absolutePath, seconds, seconds);
  }
  return absolutePath;
}

function parseSummary(lines: string[]): Record<string, unknown> {
  const summaryLine = lines.find((line) => line.startsWith('{"event":"cleanup.finished"'));
  expect(summaryLine).toBeDefined();
  return JSON.parse(summaryLine as string) as Record<string, unknown>;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-cleanup-cli-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parseCleanupArgs", () => {
  it("resolves the storage root, retention and dry-run flag", () => {
    expect(
      parseCleanupArgs(["--dry-run"], { STORAGE_ROOT: "var/storage", CLEANUP_RETENTION_DAYS: "7" }, {
        cwd: "/srv/app",
        defaultStorageRoot: "public"
      })
    ).toEqual({ storageRoot: "/srv/app/var/storage", retentionDays: 7, dryRun: true });
  });

  it("supports -n and defaults for missing/invalid env", () => {
    expect(
      parseCleanupArgs(["-n"], { CLEANUP_RETENTION_DAYS: "nope" }, { cwd: "/srv/app" })
    ).toEqual({ storageRoot: "/srv/app/public", retentionDays: 30, dryRun: true });
  });

  it("keeps execution mode by default", () => {
    expect(parseCleanupArgs([], {}, { cwd: "/srv/app" }).dryRun).toBe(false);
  });
});

describe("runCleanupCli", () => {
  it("only reports planned deletions in dry-run mode", async () => {
    const orphan = await writeStorageFile("uploads/u1/project/orphan.png");
    const logs: string[] = [];

    const { result, exitCode } = await runCleanupCli(
      { storageRoot: root, retentionDays: 30, dryRun: true },
      { listStorageKeys: async () => [], log: (line) => logs.push(line) }
    );

    expect(exitCode).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.deleted).toEqual([]);
    await expect(stat(orphan)).resolves.toBeTruthy();
    expect(logs.some((line) => line.includes("would-delete uploads/u1/project/orphan.png"))).toBe(
      true
    );
    const summary = parseSummary(logs);
    expect(summary).toMatchObject({
      event: "cleanup.finished",
      dryRun: true,
      scannedFiles: 1,
      plannedDeletions: 1,
      deleted: 0,
      failed: 0
    });
  });

  it("deletes orphans and reports a machine-readable summary", async () => {
    await writeStorageFile("uploads/u1/project/known.png");
    await writeStorageFile("uploads/u1/project/orphan.png");
    await writeStorageFile("generated/u1/task/old.svg", 40);
    await writeStorageFile("generated/u1/task/fresh.png", 0.01);
    const logs: string[] = [];

    const { result, exitCode } = await runCleanupCli(
      { storageRoot: root, retentionDays: 30, dryRun: false },
      {
        listStorageKeys: async () => ["uploads/u1/project/known.png"],
        log: (line) => logs.push(line)
      }
    );

    expect(exitCode).toBe(0);
    expect(result.deleted.sort()).toEqual([
      "generated/u1/task/old.svg",
      "uploads/u1/project/orphan.png"
    ]);
    expect(logs.some((line) => line.includes("keep generated/u1/task/fresh.png"))).toBe(true);
    const summary = parseSummary(logs);
    expect(summary).toMatchObject({
      dryRun: false,
      scannedFiles: 4,
      plannedDeletions: 2,
      deleted: 2,
      keptRecentOrphans: 1,
      failed: 0
    });
    expect(summary.bytesReclaimed).toBe(2);
  });

  it("fails soft with exit code 1 when a file cannot be deleted", async () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      // root bypasses directory permissions; the failure path cannot be simulated.
      return;
    }
    const directory = join(root, "uploads/u1/project");
    await writeStorageFile("uploads/u1/project/orphan.png");
    const logs: string[] = [];

    await chmod(directory, 0o500);
    try {
      const { result, exitCode } = await runCleanupCli(
        { storageRoot: root, retentionDays: 30, dryRun: false },
        { listStorageKeys: async () => [], log: (line) => logs.push(line) }
      );
      expect(exitCode).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(logs.some((line) => line.startsWith("[cleanup] failed "))).toBe(true);
      expect(parseSummary(logs)).toMatchObject({ failed: 1 });
    } finally {
      await chmod(directory, 0o700);
    }
  });

  it("propagates storage key listing failures to the caller", async () => {
    const failure = new Error("database unreachable");
    await expect(
      runCleanupCli(
        { storageRoot: root, retentionDays: 30, dryRun: true },
        {
          listStorageKeys: vi.fn().mockRejectedValue(failure),
          log: () => undefined
        }
      )
    ).rejects.toThrow("database unreachable");
  });
});
