import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sdk = vi.hoisted(() => ({
  sent: [] as Array<{ name: string; input: Record<string, unknown> }>
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    readonly name: string;
    readonly input: Record<string, unknown>;
    constructor(name: string, input: Record<string, unknown>) {
      this.name = name;
      this.input = input;
    }
  }
  class S3Client {
    async send(command: Command) {
      sdk.sent.push({ name: command.name, input: command.input });
      if (command.name === "GetObjectCommand") {
        return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      }
      return {};
    }
  }
  return {
    S3Client,
    PutObjectCommand: class extends Command {
      constructor(input: Record<string, unknown>) {
        super("PutObjectCommand", input);
      }
    },
    GetObjectCommand: class extends Command {
      constructor(input: Record<string, unknown>) {
        super("GetObjectCommand", input);
      }
    },
    DeleteObjectCommand: class extends Command {
      constructor(input: Record<string, unknown>) {
        super("DeleteObjectCommand", input);
      }
    }
  };
});

const originalEnv = { ...process.env };
let publicDir: string;

beforeEach(async () => {
  sdk.sent.length = 0;
  publicDir = await mkdtemp(join(tmpdir(), "dsh-object-storage-"));
});

afterEach(async () => {
  process.env = { ...originalEnv };
  await rm(publicDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("local object storage", () => {
  it("writes, reads and deletes files under the public directory", async () => {
    const { createObjectStorage } = await import("./object-storage");
    const storage = createObjectStorage({ driver: "local", publicDir });
    await storage.put("uploads/u/a.png", new Uint8Array([9, 9]), "image/png");
    expect(await storage.get("uploads/u/a.png")).toEqual(Buffer.from([9, 9]));
    expect(storage.localPath("uploads/u/a.png")).toContain(publicDir);
    await storage.delete("uploads/u/a.png");
    expect(await storage.get("uploads/u/a.png")).toBeNull();
  });
});

describe("s3 object storage", () => {
  it("uses the configured bucket, prefix and credentials", async () => {
    process.env.STORAGE_DRIVER = "s3";
    process.env.S3_BUCKET = "studio-assets";
    process.env.S3_REGION = "cn-hangzhou";
    process.env.S3_ENDPOINT = "https://oss-cn-hangzhou.aliyuncs.com";
    process.env.S3_ACCESS_KEY_ID = "test-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret";
    process.env.S3_PREFIX = "midea";
    vi.resetModules();

    const { createObjectStorage } = await import("./object-storage");
    const storage = createObjectStorage({ driver: "s3" });

    await storage.put("uploads/u/a.png", new Uint8Array([1]), "image/png");
    expect(await storage.get("uploads/u/a.png")).toEqual(new Uint8Array([1, 2, 3]));
    await storage.delete("uploads/u/a.png");

    expect(sdk.sent.map((item) => item.name)).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand"
    ]);
    expect(sdk.sent[0].input).toMatchObject({
      Bucket: "studio-assets",
      Key: "midea/uploads/u/a.png",
      ContentType: "image/png"
    });
    expect(storage.localPath("uploads/u/a.png")).toBeNull();
  });

  it("requires a bucket when s3 is selected", async () => {
    process.env.STORAGE_DRIVER = "s3";
    delete process.env.S3_BUCKET;
    vi.resetModules();
    const { createObjectStorage } = await import("./object-storage");
    expect(() => createObjectStorage({ driver: "s3" })).toThrow(/S3_BUCKET/);
  });
});
