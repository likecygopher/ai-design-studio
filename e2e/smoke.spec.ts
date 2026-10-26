import { test, expect, type Page } from "@playwright/test";

// The setup project signs in once and stores the session; tests reuse it.
// Each login attempt counts against LOGIN_MAX_ATTEMPTS, so avoid per-test logins.

test("signs in and shows the studio workbench", async ({ page }) => {
  await page.goto("/studio-home");
  await expect(page.getByRole("navigation", { name: "平台导航" })).toBeVisible();
  await expect(page.getByText("AI Content Studio").first()).toBeVisible();
  await page.getByRole("button", { name: "系统" }).click();
  await expect(page.getByRole("link", { name: "任务中心" }).first()).toBeVisible();
});

test("admin can open every platform-management page", async ({ page }) => {
  const pages: Array<{ path: string; heading: string }> = [
    { path: "/admin", heading: "系统概览" },
    { path: "/admin/users", heading: "用户管理" },
    { path: "/admin/plans", heading: "套餐管理" },
    { path: "/admin/marketplace", heading: "市场审核" },
    { path: "/admin/jobs", heading: "任务管理" },
    { path: "/admin/ai", heading: "AI 引擎" },
    { path: "/admin/audit", heading: "审计日志" }
  ];

  for (const item of pages) {
    const response = await page.goto(item.path);
    expect(response?.status(), `${item.path} status`).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: item.heading })).toBeVisible();
  }

  const metrics = await page.request.get("/api/metrics");
  expect(metrics.status()).toBe(200);
  expect(await metrics.text()).toContain("studio_http_requests_total");
});

test("admin pages render in English after switching locale", async ({ page, context }) => {
  await context.addCookies([
    { name: "studio_locale", value: "en", domain: "127.0.0.1", path: "/" }
  ]);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/admin/jobs");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await page.goto("/admin/plans");
  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
  await page.goto("/admin/ai");
  await expect(page.getByRole("heading", { name: "AI Engines" })).toBeVisible();
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.goto("/assets");
  await expect(page.getByText("Current product")).toBeVisible();
  await page.goto("/studio-home");
  await expect(page.getByText("Online generation mode")).toBeVisible();
  await page.goto("/marketplace");
  await expect(page.getByRole("heading", { name: "Template Marketplace" })).toBeVisible();
  await page.goto("/account/organization");
  await expect(page.getByRole("heading", { name: "Organization & Team" })).toBeVisible();
  await page.goto("/account/organization/sso");
  await expect(page.getByRole("heading", { name: "Enterprise SSO settings" })).toBeVisible();
  await page.goto("/phone-standardize");
  await expect(page.getByText("Phone shot / non-standard product photo")).toBeVisible();
  await page.goto("/style-transfer");
  await expect(page.getByRole("heading", { name: "One-click style transfer" })).toBeVisible();
});

test("admin primary actions are not covered by the settings dock", async ({ page }) => {
  await page.goto("/admin/plans");
  await page.getByRole("button", { name: "新增套餐" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("switches to the compact workspace and remembers the choice", async ({ page }) => {
  await page.goto("/studio-home");
  await page
    .getByRole("button", { name: "切换到紧凑工作区（更大操作区域）" })
    .click();
  await expect(page.locator("main[data-layout='compact']").first()).toBeVisible();
  await page.reload();
  await expect(page.locator("main[data-layout='compact']").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "切换到舒适布局（玻璃视觉）" })
  ).toBeVisible();
});

test("serves a nonce-based Content-Security-Policy", async ({ request }) => {
  const response = await request.get("/login");
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("'nonce-");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  const html = await response.text();
  expect(html).toMatch(/<script[^>]+nonce=/);
});

test("user pages render the task center and cost dashboard", async ({ page }) => {
  for (const item of [
    { path: "/jobs", heading: "任务中心" },
    { path: "/costs", heading: "资源消耗" }
  ]) {
    const response = await page.goto(item.path);
    expect(response?.status(), `${item.path} status`).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: item.heading })).toBeVisible();
  }
});

test.describe("anonymous visitors", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("are redirected away from admin pages", async ({ page }) => {
    await page.goto("/admin/jobs");
    await expect(page).toHaveURL(/\/login/);
  });

  test("cannot scrape metrics anonymously", async ({ page }) => {
    const metrics = await page.request.get("/api/metrics");
    expect(metrics.status()).toBe(401);
  });

  test("can switch the login page to English", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "EN" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter workspace" })).toBeVisible();
  });
});
