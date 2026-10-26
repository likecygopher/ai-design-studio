import { test as setup, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "demo@midea.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "demo1234";
const STATE = "e2e/.auth/admin.json";

setup("authenticate as the seeded admin", async ({ page }) => {
  await mkdir("e2e/.auth", { recursive: true });
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.waitForURL("**/studio-home");
  await expect(page.getByRole("navigation", { name: "平台导航" })).toBeVisible();
  await page.context().storageState({ path: STATE });
});
