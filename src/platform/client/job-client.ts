"use client";

export type JobSnapshot = {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  result?: unknown;
  error?: string | null;
};

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForJob<T = unknown>(
  jobId: string,
  options?: { pollIntervalMs?: number; signal?: AbortSignal }
): Promise<{ job: JobSnapshot; result: T }> {
  const pollIntervalMs = options?.pollIntervalMs ?? 1500;

  for (;;) {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const statusResponse = await fetch(`/api/jobs/${jobId}`, { signal: options?.signal });
    const payload = await statusResponse.json();
    if (!statusResponse.ok || !payload.job) {
      throw new Error(payload.error ?? "查询任务状态失败");
    }

    const job = payload.job as JobSnapshot;
    if (job.status === "succeeded") {
      return { job, result: job.result as T };
    }
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(job.error || "生成任务失败");
    }

    await sleep(pollIntervalMs);
  }
}

export async function enqueueAndWaitJob<T = unknown>(input: {
  type: string;
  payload: unknown;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}): Promise<{ job: JobSnapshot; result: T }> {
  const createResponse = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: input.type, payload: input.payload }),
    signal: input.signal
  });
  const created = await createResponse.json();
  if (!createResponse.ok || !created.job?.id) {
    throw new Error(created.error ?? "创建生成任务失败");
  }

  return waitForJob<T>(created.job.id as string, {
    pollIntervalMs: input.pollIntervalMs,
    signal: input.signal
  });
}

/** Submit a capability API that returns `{ job }` and wait until the worker finishes. */
export async function postCapabilityJob<T = unknown>(
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? "创建生成任务失败");
  }
  if (!payload.job?.id) {
    // Backward compatible: some routes may still return the final payload directly.
    return payload as T;
  }
  const { result } = await waitForJob<T>(payload.job.id as string, { signal });
  return result;
}
