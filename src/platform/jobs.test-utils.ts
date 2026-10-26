/**
 * Test-only in-memory Prisma stand-in for the job subsystem.
 *
 * Imported exclusively by `*.test.ts` files (production code never references
 * it). It implements the small subset of the Prisma query API that
 * `src/platform/jobs.ts`, `app/api/jobs/**` and `scripts/worker.ts` touch, so
 * state-machine tests run without a live PostgreSQL instance.
 */
import type { GenerationJob } from "@prisma/client";

type Where = Record<string, unknown>;
type Row = Record<string, unknown>;

export type FakePrismaState = {
  jobs: GenerationJob[];
  audits: Array<Record<string, unknown>>;
  rawQueries: string[];
  rawResults: Array<Array<{ id: string; userId: string }>>;
  heartbeatUpserts: Array<Record<string, unknown>>;
  heartbeatDeletes: number;
  disconnected: number;
};

export type FakePrismaHooks = {
  /** Runs inside `create()` before the unique-constraint check. */
  beforeCreate?: (data: Row) => void;
};

let sequence = 0;

/** Build a fully-populated GenerationJob for seeding/expectations. */
export function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  sequence += 1;
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, sequence));
  const base = {
    id: `job_${sequence}`,
    userId: "user-1",
    type: "pop-scene",
    status: "queued",
    priority: 0,
    progress: 0,
    payload: {},
    result: null,
    error: null,
    attempts: 0,
    maxAttempts: 3,
    idempotencyKey: null,
    nextAttemptAt: null,
    cancelledAt: null,
    lockedAt: null,
    lockedBy: null,
    requiresApproval: false,
    approvedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence ?? 0)),
    approvedBy: null,
    approvalNote: null,
    startedAt: null,
    finishedAt: null,
    createdAt,
    updatedAt: createdAt
  };
  return { ...base, ...overrides } as unknown as GenerationJob;
}

function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

function compareValues(a: unknown, b: unknown): number {
  const av = isDate(a) ? a.getTime() : (a as number);
  const bv = isDate(b) ? b.getTime() : (b as number);
  if (av < bv) {
    return -1;
  }
  if (av > bv) {
    return 1;
  }
  return 0;
}

function filterMatches(actual: unknown, expected: unknown): boolean {
  if (expected === null) {
    return actual === null || actual === undefined;
  }
  if (isDate(expected)) {
    return isDate(actual) && actual.getTime() === expected.getTime();
  }
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const filter = expected as Record<string, unknown>;
    if ("equals" in filter) {
      return filterMatches(actual, filter.equals);
    }
    if ("in" in filter) {
      return (filter.in as unknown[]).some((candidate) => filterMatches(actual, candidate));
    }
    if ("notIn" in filter) {
      return !(filter.notIn as unknown[]).some((candidate) => filterMatches(actual, candidate));
    }
    // SQL comparison operators never match NULL, mirror that in the fake.
    const comparable = actual !== null && actual !== undefined;
    if ("lt" in filter) {
      return comparable && compareValues(actual, filter.lt) < 0;
    }
    if ("lte" in filter) {
      return comparable && compareValues(actual, filter.lte) <= 0;
    }
    if ("gt" in filter) {
      return comparable && compareValues(actual, filter.gt) > 0;
    }
    if ("gte" in filter) {
      return comparable && compareValues(actual, filter.gte) >= 0;
    }
    if ("not" in filter) {
      return !filterMatches(actual, filter.not);
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  return actual === expected;
}

function matchWhere(row: Row, where: Where): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) {
      continue;
    }
    if (key === "AND") {
      if (!(expected as Where[]).every((nested) => matchWhere(row, nested))) {
        return false;
      }
      continue;
    }
    if (key === "OR") {
      if (!(expected as Where[]).some((nested) => matchWhere(row, nested))) {
        return false;
      }
      continue;
    }
    if (key === "NOT") {
      if (matchWhere(row, expected as Where)) {
        return false;
      }
      continue;
    }
    if (!filterMatches(row[key], expected)) {
      return false;
    }
  }
  return true;
}

function applyData(row: Row, data: Row): Row {
  const next: Row = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const operation = value as Record<string, unknown>;
      if ("increment" in operation) {
        next[key] = ((row[key] as number | undefined) ?? 0) + (operation.increment as number);
        continue;
      }
      if ("decrement" in operation) {
        next[key] = ((row[key] as number | undefined) ?? 0) - (operation.decrement as number);
        continue;
      }
      if ("set" in operation) {
        next[key] = operation.set;
        continue;
      }
    }
    next[key] = value;
  }
  next.updatedAt = new Date();
  return next;
}

function selectFields(row: Row, select?: Row): Row {
  if (!select) {
    return { ...row };
  }
  const output: Row = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) {
      output[key] = row[key];
    }
  }
  return output;
}

function compareByOrder(a: Row, b: Row, orderBy: unknown): number {
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  for (const order of orders) {
    for (const [field, direction] of Object.entries(order as Row)) {
      const factor = direction === "desc" ? -1 : 1;
      const result = compareValues(a[field], b[field]);
      if (result !== 0) {
        return result * factor;
      }
    }
  }
  return 0;
}

export type FakePrisma = {
  state: FakePrismaState;
  hooks: FakePrismaHooks;
  generationJob: Record<string, (...args: never[]) => unknown>;
  auditLog: Record<string, (...args: never[]) => unknown>;
  workerHeartbeat: Record<string, (...args: never[]) => unknown>;
  $transaction<T>(arg: ((tx: FakePrisma) => Promise<T>) | Promise<unknown>[]): Promise<T>;
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $disconnect(): Promise<void>;
  [key: string]: unknown;
};

export function createFakePrisma(options: { jobs?: GenerationJob[] } = {}): FakePrisma {
  const state: FakePrismaState = {
    jobs: (options.jobs ?? []).map((job) => ({ ...job })),
    audits: [],
    rawQueries: [],
    rawResults: [],
    heartbeatUpserts: [],
    heartbeatDeletes: 0,
    disconnected: 0
  };
  const hooks: FakePrismaHooks = {};
  let nextId = state.jobs.length;

  const generationJob = {
    async create({ data, select }: { data: Row; select?: Row }) {
      hooks.beforeCreate?.(data);
      const userId = data.userId as string;
      const idempotencyKey = (data.idempotencyKey as string | null | undefined) ?? null;
      if (
        idempotencyKey !== null &&
        state.jobs.some(
          (job) => job.userId === userId && job.idempotencyKey === idempotencyKey
        )
      ) {
        throw Object.assign(
          new Error("Unique constraint failed on the fields: (`userId`,`idempotencyKey`)"),
          { code: "P2002", name: "PrismaClientKnownRequestError" }
        );
      }
      nextId += 1;
      const now = new Date();
      const row = buildJob({
        id: `job_${nextId}`,
        userId,
        createdAt: now,
        updatedAt: now
      });
      const created = { ...(row as unknown as Row), ...data, updatedAt: now } as GenerationJob;
      state.jobs.push(created);
      return selectFields(created as unknown as Row, select) as unknown as GenerationJob;
    },

    async findFirst({ where = {}, select }: { where?: Where; select?: Row } = {}) {
      const row = state.jobs.find((job) => matchWhere(job as unknown as Row, where));
      return row ? (selectFields(row as unknown as Row, select) as unknown as GenerationJob) : null;
    },

    async findUnique({ where, select }: { where: Row; select?: Row }) {
      const row = state.jobs.find((job) => matchWhere(job as unknown as Row, where));
      return row ? (selectFields(row as unknown as Row, select) as unknown as GenerationJob) : null;
    },

    async findUniqueOrThrow({ where, select }: { where: Row; select?: Row }) {
      const row = state.jobs.find((job) => matchWhere(job as unknown as Row, where));
      if (!row) {
        throw Object.assign(new Error("An operation failed because it depends on one or more records that were required but not found."), {
          code: "P2025",
          name: "PrismaClientKnownRequestError"
        });
      }
      return selectFields(row as unknown as Row, select) as unknown as GenerationJob;
    },

    async findMany({
      where = {},
      orderBy,
      take,
      cursor,
      skip = 0,
      select
    }: {
      where?: Where;
      orderBy?: unknown;
      take?: number;
      cursor?: { id: string } | null;
      skip?: number;
      select?: Row;
    } = {}) {
      let rows = state.jobs.filter((job) => matchWhere(job as unknown as Row, where));
      if (orderBy) {
        rows = [...rows].sort((a, b) =>
          compareByOrder(a as unknown as Row, b as unknown as Row, orderBy)
        );
      }
      if (cursor?.id) {
        const index = rows.findIndex((job) => job.id === cursor.id);
        rows = index === -1 ? [] : rows.slice(index + skip);
      } else if (skip > 0) {
        rows = rows.slice(skip);
      }
      if (typeof take === "number") {
        rows = rows.slice(0, take);
      }
      return rows.map((job) => selectFields(job as unknown as Row, select)) as unknown as GenerationJob[];
    },

    async count({ where = {} }: { where?: Where } = {}) {
      return state.jobs.filter((job) => matchWhere(job as unknown as Row, where)).length;
    },

    async update({ where, data }: { where: Row; data: Row }) {
      const index = state.jobs.findIndex((job) => matchWhere(job as unknown as Row, where));
      if (index === -1) {
        throw Object.assign(new Error("Record to update not found."), {
          code: "P2025",
          name: "PrismaClientKnownRequestError"
        });
      }
      state.jobs[index] = applyData(
        state.jobs[index] as unknown as Row,
        data
      ) as unknown as GenerationJob;
      return state.jobs[index];
    },

    async updateMany({ where = {}, data }: { where?: Where; data: Row }) {
      let count = 0;
      state.jobs = state.jobs.map((job) => {
        if (matchWhere(job as unknown as Row, where)) {
          count += 1;
          return applyData(job as unknown as Row, data) as unknown as GenerationJob;
        }
        return job;
      });
      return { count };
    }
  };

  const auditLog = {
    async create({ data }: { data: Row }) {
      state.audits.push(data);
      return { id: `audit_${state.audits.length}`, createdAt: new Date(), ...data };
    },
    async findMany() {
      return [];
    }
  };

  const workerHeartbeat = {
    async upsert(input: {
      where: { id: string };
      create: Row;
      update: Row;
    }) {
      state.heartbeatUpserts.push({ id: input.where.id, ...input.update });
      return { id: input.where.id, ...input.create, ...input.update };
    },
    async deleteMany() {
      state.heartbeatDeletes += 1;
      return { count: 0 };
    },
    async findMany() {
      return [];
    }
  };

  const api = {
    state,
    hooks,
    generationJob,
    auditLog,
    workerHeartbeat,
    async $transaction<T>(arg: ((tx: FakePrisma) => Promise<T>) | Promise<unknown>[]): Promise<T> {
      if (typeof arg === "function") {
        return arg(api as unknown as FakePrisma);
      }
      return (await Promise.all(arg)) as T;
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      state.rawQueries.push(
        strings.map((chunk, index) => `${chunk}${index < values.length ? `?` : ""}`).join("")
      );
      return state.rawResults.shift() ?? [];
    },
    async $disconnect() {
      state.disconnected += 1;
    }
  };

  return api as unknown as FakePrisma;
}

/** Drain fire-and-forget audit writes (they resolve on the macrotask queue). */
export async function flushAsync(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
