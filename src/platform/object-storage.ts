import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PLATFORM_CONFIG } from "@/src/platform/config";

/**
 * Storage abstraction for user assets.
 *
 * `local` keeps the historical behaviour (files under `STORAGE_ROOT`, URLs like
 * `/uploads/...`). `s3` stores bytes in any S3-compatible bucket (AWS S3,
 * MinIO, Aliyun OSS S3-compatible endpoint, ...) and the UI uses the
 * authorised `/api/assets/{id}/file` proxy instead of a public static path.
 */

export type ObjectStorageKind = "local" | "s3";

export interface ObjectStorage {
  readonly kind: ObjectStorageKind;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Local absolute path for generated files; null for remote storage. */
  localPath(key: string): string | null;
}

export type ObjectStorageOptions = {
  publicDir?: string;
  driver?: ObjectStorageKind;
};

function resolveRoot(publicDir?: string): string {
  return resolve(publicDir ?? resolve(process.cwd(), PLATFORM_CONFIG.storageRoot));
}

function assertInside(root: string, candidate: string): void {
  const relative = candidate.slice(root.length);
  if (!candidate.startsWith(root) || relative.startsWith("..")) {
    throw new Error("Resolved asset path escapes the configured public directory.");
  }
}

class LocalObjectStorage implements ObjectStorage {
  readonly kind = "local" as const;
  private readonly root: string;

  constructor(publicDir?: string) {
    this.root = resolveRoot(publicDir);
  }

  private pathFor(key: string): string {
    const filePath = resolve(this.root, key);
    assertInside(this.root, filePath);
    return filePath;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const filePath = this.pathFor(key);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    await writeFile(filePath, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  localPath(key: string): string {
    return this.pathFor(key);
  }
}

type S3ClientLike = {
  send(command: unknown): Promise<unknown>;
};

let cachedClient: S3ClientLike | null = null;
let cachedClientKey = "";

function s3ClientKey(): string {
  return [
    PLATFORM_CONFIG.s3Endpoint ?? "",
    PLATFORM_CONFIG.s3Region,
    PLATFORM_CONFIG.s3ForcePathStyle ? "path" : "virtual"
  ].join("|");
}

async function getS3Client(): Promise<S3ClientLike> {
  const key = s3ClientKey();
  if (cachedClient && cachedClientKey === key) {
    return cachedClient;
  }
  const { S3Client } = await import("@aws-sdk/client-s3");
  cachedClient = new S3Client({
    region: PLATFORM_CONFIG.s3Region,
    ...(PLATFORM_CONFIG.s3Endpoint ? { endpoint: PLATFORM_CONFIG.s3Endpoint } : {}),
    ...(PLATFORM_CONFIG.s3AccessKeyId
      ? {
          credentials: {
            accessKeyId: PLATFORM_CONFIG.s3AccessKeyId,
            secretAccessKey: PLATFORM_CONFIG.s3SecretAccessKey ?? ""
          }
        }
      : {}),
    forcePathStyle: PLATFORM_CONFIG.s3ForcePathStyle
  }) as S3ClientLike;
  cachedClientKey = key;
  return cachedClient;
}

class S3ObjectStorage implements ObjectStorage {
  readonly kind = "s3" as const;

  constructor() {
    if (!PLATFORM_CONFIG.s3Bucket) {
      throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET to be configured.");
    }
  }

  private bucket(): string {
    if (!PLATFORM_CONFIG.s3Bucket) {
      throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET to be configured.");
    }
    return PLATFORM_CONFIG.s3Bucket;
  }

  private objectKey(key: string): string {
    return `${PLATFORM_CONFIG.s3Prefix}/${key}`;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: this.objectKey(key),
        Body: bytes,
        ContentType: contentType
      })
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3Client();
    try {
      const result = (await client.send(
        new GetObjectCommand({
          Bucket: this.bucket(),
          Key: this.objectKey(key)
        })
      )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      if (!result.Body) {
        return null;
      }
      return await result.Body.transformToByteArray();
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket(),
        Key: this.objectKey(key)
      })
    );
  }

  localPath(): null {
    return null;
  }
}

export function createObjectStorage(options: ObjectStorageOptions = {}): ObjectStorage {
  const driver = options.driver ?? PLATFORM_CONFIG.storageDriver;
  return driver === "s3" ? new S3ObjectStorage() : new LocalObjectStorage(options.publicDir);
}
