import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import JobsPage from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/jobs" }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jobs page", () => {
  it("renders the task center inside the studio shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ jobs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    render(<JobsPage />);

    expect(await screen.findByRole("heading", { name: "任务中心" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "平台导航" })).toBeInTheDocument();
    expect(await screen.findByText(/还没有任务/)).toBeInTheDocument();
  });
});
