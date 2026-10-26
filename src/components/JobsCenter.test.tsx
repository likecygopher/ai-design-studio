import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsCenter, type JobListItem } from "./JobsCenter";

function makeJob(overrides: Partial<JobListItem> & { id: string }): JobListItem {
  return {
    type: "style-transfer",
    status: "queued",
    progress: 0,
    createdAt: "2026-10-26T03:04:05.000Z",
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function listResponse(jobs: JobListItem[], nextCursor?: string) {
  return jsonResponse(nextCursor ? { jobs, nextCursor } : { jobs });
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String(input);
    return handler(url, init);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestUrls(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.map(([input]) =>
    typeof input === "string" ? input : String(input)
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe("JobsCenter", () => {
  it("renders jobs with Chinese status, progress, creation time and failure reason", async () => {
    installFetch(() =>
      listResponse([
        makeJob({ id: "job-running-1", status: "running", progress: 42 }),
        makeJob({
          id: "job-failed-2",
          type: "product-video",
          status: "failed",
          progress: 100,
          error: "模型调用超时"
        })
      ])
    );

    render(<JobsCenter />);

    const list = await screen.findByRole("list", { name: "任务列表" });
    expect(within(list).getByText("风格迁移")).toBeInTheDocument();
    expect(within(list).getByText("产品视频")).toBeInTheDocument();
    expect(within(list).getByText("生成中")).toBeInTheDocument();
    expect(within(list).getByText("失败")).toBeInTheDocument();
    expect(within(list).getByText("42%")).toBeInTheDocument();
    expect(within(list).getByText("100%")).toBeInTheDocument();
    expect(within(list).getByText("失败原因：模型调用超时")).toBeInTheDocument();
    expect(within(list).getAllByText(/创建时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)).toHaveLength(2);
    expect(within(list).getAllByText(/任务编号：/)).toHaveLength(2);
    expect(screen.getByRole("progressbar", { name: "风格迁移 进度" })).toHaveAttribute(
      "aria-valuenow",
      "42"
    );
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows an empty state with a link back to the studio", async () => {
    installFetch(() => listResponse([]));

    render(<JobsCenter />);

    expect(await screen.findByText(/还没有任务/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
      "href",
      "/studio-home"
    );
    expect(screen.queryByRole("list", { name: "任务列表" })).not.toBeInTheDocument();
  });

  it("shows the error with request id and retries", async () => {
    let attempts = 0;
    installFetch(() => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse(
            { error: "读取任务列表失败。", code: "INTERNAL_ERROR", requestId: "req-9" },
            500
          )
        : listResponse([makeJob({ id: "job-1" })]);
    });
    const user = userEvent.setup();

    render(<JobsCenter />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("读取任务列表失败。");
    expect(alert).toHaveTextContent("请求编号：req-9");
    await user.click(within(alert).getByRole("button", { name: "重试" }));
    expect(await screen.findByText("风格迁移")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("filters the loaded jobs by status", async () => {
    installFetch(() =>
      listResponse([
        makeJob({ id: "job-queued", status: "queued" }),
        makeJob({ id: "job-failed", status: "failed", error: "失败" }),
        makeJob({ id: "job-succeeded", status: "succeeded", progress: 100 })
      ])
    );
    const user = userEvent.setup();

    render(<JobsCenter />);
    const list = await screen.findByRole("list", { name: "任务列表" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);

    await user.selectOptions(screen.getByLabelText("状态筛选"), "failed");

    const filtered = screen.getByRole("list", { name: "任务列表" });
    expect(within(filtered).getAllByRole("listitem")).toHaveLength(1);
    expect(within(filtered).getByText("失败")).toBeInTheDocument();
    expect(within(filtered).queryByText("排队中")).not.toBeInTheDocument();
  });

  it("cancels a queued job and refreshes the list", async () => {
    let cancelled = false;
    const fetchMock = installFetch((url) => {
      if (url.includes("/cancel")) {
        cancelled = true;
        return jsonResponse({ job: makeJob({ id: "job-1", status: "cancelled" }) });
      }
      return listResponse([makeJob({ id: "job-1", status: cancelled ? "cancelled" : "queued" })]);
    });
    const user = userEvent.setup();

    render(<JobsCenter />);
    await user.click(await screen.findByRole("button", { name: "取消任务" }));

    expect(await screen.findByRole("status")).toHaveTextContent("任务 job-1 已取消。");
    expect(requestUrls(fetchMock).some((url) => url.endsWith("/api/jobs/job-1/cancel"))).toBe(
      true
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "任务列表" })).getByText("已取消")
      ).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "取消任务" })).not.toBeInTheDocument();
  });

  it("retries a failed job and refreshes the list", async () => {
    let retried = false;
    const fetchMock = installFetch((url) => {
      if (url.includes("/retry")) {
        retried = true;
        return jsonResponse({ job: makeJob({ id: "job-fail", status: "queued" }) }, 201);
      }
      return listResponse([
        makeJob({
          id: "job-fail",
          status: retried ? "queued" : "failed",
          progress: retried ? 0 : 100,
          error: retried ? null : "provider timeout"
        })
      ]);
    });
    const user = userEvent.setup();

    render(<JobsCenter />);
    await user.click(await screen.findByRole("button", { name: "重试任务" }));

    expect(await screen.findByRole("status")).toHaveTextContent("任务 job-fail 已重新提交。");
    expect(requestUrls(fetchMock).some((url) => url.endsWith("/api/jobs/job-fail/retry"))).toBe(
      true
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "任务列表" })).getByText("排队中")
      ).toBeInTheDocument()
    );
  });

  it("degrades gracefully when the cancel endpoint is missing (404)", async () => {
    let cancelAttempts = 0;
    installFetch((url) => {
      if (url.includes("/cancel")) {
        cancelAttempts += 1;
        return jsonResponse({ error: "任务不存在。", code: "NOT_FOUND" }, 404);
      }
      return listResponse([makeJob({ id: "job-1", status: "queued" })]);
    });
    const user = userEvent.setup();

    render(<JobsCenter />);
    await user.click(await screen.findByRole("button", { name: "取消任务" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "当前环境暂不支持取消任务，请等待任务完成。"
    );
    expect(cancelAttempts).toBe(1);
    expect(await screen.findByRole("button", { name: "取消任务" })).toBeEnabled();
  });

  it("reports a 409 conflict and refreshes the list", async () => {
    const fetchMock = installFetch((url) => {
      if (url.includes("/cancel")) {
        return jsonResponse(
          { error: "任务已经完成，无法取消。", code: "JOB_NOT_CANCELLABLE" },
          409
        );
      }
      return listResponse([makeJob({ id: "job-1", status: "queued" })]);
    });
    const user = userEvent.setup();

    render(<JobsCenter />);
    await user.click(await screen.findByRole("button", { name: "取消任务" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "任务状态已变化，无法取消，列表已刷新。"
    );
    await waitFor(() =>
      expect(requestUrls(fetchMock).filter((url) => url.startsWith("/api/jobs?")).length).toBeGreaterThanOrEqual(2)
    );
  });

  it("polls automatically while a job is active", async () => {
    const fetchMock = installFetch(() =>
      listResponse([makeJob({ id: "job-1", status: "running", progress: 10 })])
    );

    render(<JobsCenter pollIntervalMs={25} />);

    expect(await screen.findByText("生成中")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 2000
    });
  });

  it("pauses polling while the tab is hidden and refreshes when visible again", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden"
    });
    const fetchMock = installFetch(() =>
      listResponse([makeJob({ id: "job-1", status: "running", progress: 10 })])
    );

    render(<JobsCenter pollIntervalMs={20} />);
    expect(await screen.findByText("生成中")).toBeInTheDocument();

    const callsWhileHidden = fetchMock.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 160));
    });
    expect(fetchMock.mock.calls.length).toBe(callsWhileHidden);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsWhileHidden), {
      timeout: 2000
    });
  });

  it("loads the next page when the API returns a cursor", async () => {
    let page = 0;
    const fetchMock = installFetch(() => {
      page += 1;
      return page === 1
        ? listResponse([makeJob({ id: "job-1" })], "cursor-2")
        : listResponse([makeJob({ id: "job-2", type: "localize" })]);
    });
    const user = userEvent.setup();

    render(<JobsCenter />);
    await user.click(await screen.findByRole("button", { name: "加载更多" }));

    expect(await screen.findByText("多语言环境适应")).toBeInTheDocument();
    expect(screen.getByText("风格迁移")).toBeInTheDocument();
    expect(requestUrls(fetchMock).some((url) => url.includes("cursor=cursor-2"))).toBe(true);
  });
});
