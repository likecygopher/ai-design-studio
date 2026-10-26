import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_RETENTION_DAYS,
  collectStorageFiles,
  executeCleanup,
  normalizeStorageKey,
  planCleanup,
  resolveRetentionDays
} from "./cleanup";

const DAY_MS = 24 * 60 * 60 * 1000;
let root: string;

async function writeStorageFile(relativePath: string, contents = "file-bytes", ageDays = 0): Promise<string> {
  const absolutePath = join(root, relativePath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, contents);
  if (ageDays > 0) {
    const seconds = Math.floor((Date.now() - ageDays * DAY_MS) / 1000);
    await utimes(absolutePath, seconds, seconds);
  }
  return absolutePath;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-cleanup-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("collectStorageFiles", () => {
  it("walks uploads/ and generated/ recursively and builds POSIX storage keys", async () => {
    await writeStorageFile("uploads/u1/project/a.png", "aaa");
    await writeStorageFile("generated/u1/task/b.png", "bbbb");
    await writeStorageFile("generated/u1/task/nested/c.svg", "cc");

    const files = await collectStorageFiles(root);
    expect(files.map((file) => file.storageKey)).toEqual([
      "generated/u1/task/b.png",
      "generated/u1/task/nested/c.svg",
      "uploads/u1/project/a.png"
    ]);
    expect(files.every((file) => file.absolutePath.startsWith(root))).toBe(true);
    expect(files.find((file) => file.storageKey === "uploads/u1/project/a.png")?.sizeBytes).toBe(3);
  });

  it("returns an empty list when the storage areas do not exist", async () => {
    await expect(collectStorageFiles(root)).resolves.toEqual([]);
  });
});

describe("planCleanup", () => {
  it("deletes upload orphans and expired generated orphans, keeps recent generated orphans", async () => {
    await writeStorageFile("uploads/u1/project/known.png", "known");
    await writeStorageFile("uploads/u1/project/orphan.png", "orphan");
    await writeStorageFile("generated/u1/task/known.png", "known");
    await writeStorageFile("generated/u1/task/old-orphan.svg", "old", 40);
    await writeStorageFile("generated/u1/task/new-orphan.png", "new", 0.01);

    const plan = await planCleanup({
      storageRoot: root,
      knownStorageKeys: ["uploads/u1/project/known.png", "generated/u1/task/known.png"]
    });

    expect(plan.scannedFiles).toBe(5);
    expect(plan.orphanFiles).toBe(3);
    expect(plan.deletions.map((item) => item.storageKey).sort()).toEqual([
      "generated/u1/task/old-orphan.svg",
      "uploads/u1/project/orphan.png"
    ]);
    const expired = plan.deletions.find(
      (item) => item.storageKey === "generated/u1/task/old-orphan.svg"
    );
    expect(expired?.reason).toBe("expired-generated");
    expect(expired?.ageDays).toBeGreaterThanOrEqual(39);
    const orphan = plan.deletions.find((item) => item.storageKey === "uploads/u1/project/orphan.png");
    expect(orphan?.reason).toBe("orphan");
    expect(plan.keptRecentOrphans.map((item) => item.storageKey)).toEqual([
      "generated/u1/task/new-orphan.png"
    ]);
    expect(plan.bytesReclaimable).toBe("orphan".length + "old".length);
    expect(plan.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("normalizes Windows-style DB storage keys", async () => {
    await writeStorageFile("uploads/u1/project/known.png", "known");
    const plan = await planCleanup({
      storageRoot: root,
      knownStorageKeys: ["\\uploads\\u1\\project\\known.png"]
    });
    expect(plan.deletions).toEqual([]);
    expect(plan.orphanFiles).toBe(0);
  });

  it("applies the retention boundary to generated orphans", async () => {
    await writeStorageFile("generated/u1/task/just-inside.png", "x", 29.5);
    await writeStorageFile("generated/u1/task/just-outside.png", "x", 30.5);

    const plan = await planCleanup({ storageRoot: root, knownStorageKeys: [], retentionDays: 30 });
    expect(plan.deletions.map((item) => item.storageKey)).toEqual([
      "generated/u1/task/just-outside.png"
    ]);
    expect(plan.keptRecentOrphans.map((item) => item.storageKey)).toEqual([
      "generated/u1/task/just-inside.png"
    ]);
  });

  it("does not delete anything when every file is known", async () => {
    await writeStorageFile("uploads/u1/project/a.png");
    const plan = await planCleanup({
      storageRoot: root,
      knownStorageKeys: ["uploads/u1/project/a.png"]
    });
    expect(plan.deletions).toEqual([]);
    expect(plan.bytesReclaimable).toBe(0);
  });
});

describe("executeCleanup", () => {
  it("does not touch the filesystem in dry-run mode", async () => {
    await writeStorageFile("uploads/u1/project/orphan.png");
    const result = await executeCleanup({ storageRoot: root, knownStorageKeys: [], dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.deletions).toHaveLength(1);
    expect(result.deleted).toEqual([]);
    const absolutePath = join(root, "uploads/u1/project/orphan.png");
    await expect(stat(absolutePath)).resolves.toBeTruthy();
  });

  it("deletes orphan files, keeps known files and prunes empty directories", async () => {
    await writeStorageFile("uploads/u1/project/known.png");
    await writeStorageFile("uploads/u1/project/orphan.png");
    await writeStorageFile("generated/u1/task/old.svg", "old", 40);

    const result = await executeCleanup({
      storageRoot: root,
      knownStorageKeys: ["uploads/u1/project/known.png"]
    });

    expect(result.deleted.sort()).toEqual([
      "generated/u1/task/old.svg",
      "uploads/u1/project/orphan.png"
    ]);
    expect(result.failed).toEqual([]);
    const known = join(root, "uploads/u1/project/known.png");
    await expect(stat(known)).resolves.toBeTruthy();
    // Only empty sub-directories are pruned; the configured storage area root stays.
    await expect(readdir(join(root, "generated"))).resolves.toEqual([]);
    expect(result.prunedDirectories).toContain("generated/u1/task");
    expect(result.prunedDirectories).toContain("generated/u1");
    expect(result.prunedDirectories).not.toContain("generated");
    const uploadsEntries = await readdir(join(root, "uploads/u1/project"));
    expect(uploadsEntries).toEqual(["known.png"]);
  });
});

describe("resolveRetentionDays", () => {
  it("accepts positive integers and falls back for invalid input", () => {
    expect(resolveRetentionDays("7")).toBe(7);
    expect(resolveRetentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays("abc")).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays("0")).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays("-5")).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays("1.5")).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays("999999")).toBe(3650);
  });
});

describe("normalizeStorageKey", () => {
  it("converts separators and strips leading slashes", () => {
    expect(normalizeStorageKey("\\uploads\\u1\\a.png")).toBe("uploads/u1/a.png");
    expect(normalizeStorageKey("/uploads/u1/a.png")).toBe("uploads/u1/a.png");
    expect(normalizeStorageKey("./uploads/u1/a.png")).toBe("uploads/u1/a.png");
  });
});
