import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { ValidationError } from "@/src/platform/errors";
import {
  JOBS_MAX_PAGE_SIZE,
  JOB_TYPES,
  enqueueJobIdempotent,
  listJobsForUser,
  serializeJob,
  type JobType
} from "@/src/platform/jobs";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/** Status filter accepted by `GET /api/jobs` (spec R4.6). */
const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);

const listQuerySchema = z.object({
  status: jobStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(JOBS_MAX_PAGE_SIZE).optional(),
  cursor: z.string().trim().min(1).max(128).optional()
});

const enqueueSchema = z.object({
  type: z
    .string()
    .trim()
    .refine((value): value is JobType => (JOB_TYPES as readonly string[]).includes(value), {
      message: `不支持的任务类型。可选值：${JOB_TYPES.join(", ")}`
    }),
  // Legacy clients post the whole workflow body; handlers validate its shape.
  payload: z.unknown().optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  /** Client-generated key: a repeated submit returns the original job. */
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/, "idempotencyKey 只能包含字母、数字、点、下划线、冒号和连字符。")
    .optional()
});

function parseQuery(searchParams: URLSearchParams) {
  const parsed = listQuerySchema.safeParse({
    status: searchParams.get("status") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined
  });
  if (!parsed.success) {
    throw new ValidationError("查询参数无效。", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return parsed.data;
}

/** Cursor-paginated, status-filtered list of the caller's jobs. */
export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "jobs:list", limit: 120, windowMs: 60_000 } },
    async (ctx) => {
      const url = new URL(request.url);
      const { status, limit, cursor } = parseQuery(url.searchParams);

      const { jobs, nextCursor } = await listJobsForUser(ctx.userId ?? "", {
        status,
        limit,
        cursor
      });

      return NextResponse.json(
        { jobs: jobs.map(serializeJob), nextCursor },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  );
}

/**
 * Idempotent job submission.
 * - new job → 202 + `{ job, created: true }`
 * - repeated `idempotencyKey` → 200 + `{ job, created: false }`
 */
export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "jobs:create" } },
    async (ctx) => {
      const body = await ctx.body(enqueueSchema);

      const { job, created } = await enqueueJobIdempotent({
        userId: ctx.userId ?? "",
        type: body.type as JobType,
        payload: (body.payload ?? {}) as Prisma.InputJsonValue,
        priority: body.priority,
        idempotencyKey: body.idempotencyKey,
        actorRole: ctx.role,
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      return NextResponse.json({ job: serializeJob(job), created }, { status: created ? 202 : 200 });
    }
  );
}
