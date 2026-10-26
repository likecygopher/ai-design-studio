// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ render: vi.fn(), product: vi.fn() }));
vi.mock("@/src/services/white-background", () => ({ renderWhiteBackgroundOutput: mocks.render }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/src/platform/auth", () => ({
  getSessionUser: async () => ({ id: "user-1", email: "u@example.com", role: "user" })
}));
vi.mock("@/src/platform/workspace", () => ({
  createUserWorkspace: () => ({
    userId: "user-1",
    productRegistry: { getProduct: mocks.product },
    imageStore: {},
    costLedger: {}
  })
}));
import { POST } from "./route";
const body = { productId: "p", referenceAssetIds: ["a"], angle: "front", sourceState: "as-reference", autoRemoveBackground: true, whiteBackground: true, naturalShadow: false, width: 2000, height: 2000, imageModel: "openai" };
beforeEach(() => {
  mocks.render.mockReset().mockResolvedValue({ angle: "front", url: "/generated/test.png", width: 2000, height: 2000 });
  mocks.product.mockReset().mockResolvedValue({ id: "p", assets: [{ id: "a", productId: "p", type: "product-photo", filename: "a.png" }] });
});
const post = (value: unknown) => POST(new Request("http://localhost/api/white-background", { method: "POST", body: JSON.stringify(value) }));
describe("white background endpoint", () => {
  it("returns the generated output for valid selected product references", async () => {
    const response = await post(body); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ output: { url: "/generated/test.png", width: 2000, height: 2000 } });
    expect(mocks.render).toHaveBeenCalledWith(body, expect.any(Object));
  });
  it("rejects invalid dimensions and cross-product assets before generation", async () => {
    expect((await post({ ...body, width: 0 })).status).toBe(400);
    mocks.product.mockResolvedValue({ id: "p", assets: [{ id: "a", productId: "other", type: "product-photo", filename: "a.png" }] });
    expect((await post(body)).status).toBe(400); expect(mocks.render).not.toHaveBeenCalled();
  });
  it("returns actionable generation errors without reporting success", async () => {
    mocks.render.mockRejectedValue(new Error("图片生成失败"));
    const response = await post(body); expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: "图片生成失败" });
  });
});
