// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  removeAsset: vi.fn(),
  recordAudit: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({
  requireUserId: mocks.requireUserId
}));

vi.mock("@/src/platform/audit", () => ({
  recordAudit: mocks.recordAudit
}));

vi.mock("@/src/platform/workspace", () => ({
  createUserWorkspace: (userId: string) => ({
    userId,
    imageStore: { removeAsset: mocks.removeAsset }
  })
}));

import { DELETE } from "./route";

function deleteRequest(query: string): Request {
  return new Request(`http://localhost/api/assets${query}`, { method: "DELETE" });
}

beforeEach(() => {
  mocks.requireUserId.mockReset().mockResolvedValue("user-1");
  mocks.removeAsset.mockReset().mockResolvedValue(true);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
});

describe("DELETE /api/assets", () => {
  it("removes the asset for the current user and records an audit entry", async () => {
    const response = await DELETE(deleteRequest("?id=asset-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ removed: true });
    expect(mocks.removeAsset).toHaveBeenCalledWith("asset-1");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "asset.delete",
        targetType: "asset",
        targetId: "asset-1"
      })
    );
  });

  it("keeps the legacy 400 error when the id is missing", async () => {
    const response = await DELETE(deleteRequest(""));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "缺少资产 id。" });
    expect(mocks.removeAsset).not.toHaveBeenCalled();
  });

  it("keeps the legacy 400 error for unknown/foreign assets", async () => {
    mocks.removeAsset.mockResolvedValue(false);

    const response = await DELETE(deleteRequest("?id=someone-elses-asset"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "资产不存在或无权删除。"
    });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("maps unauthenticated requests to 401", async () => {
    const authError = new Error("请先登录后再使用平台功能。");
    authError.name = "AuthRequiredError";
    mocks.requireUserId.mockRejectedValue(authError);

    const response = await DELETE(deleteRequest("?id=asset-1"));

    expect(response.status).toBe(401);
  });
});
