import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { getProviderTestTarget, recordProviderTest } from "@/src/platform/ai-config";
import { channelMeta } from "@/src/platform/ai-provider-meta";
import { DEFAULT_ARK_API_ROOT } from "@/src/services/doubao-image-provider";
import { createProxyDispatcher, fetchOpenAi, normalizeApiRoot } from "@/src/services/image-provider";
import { NotFoundError } from "@/src/platform/errors";

export const dynamic = "force-dynamic";

const TEST_TIMEOUT_MS = 10_000;

type TestResult = {
  ok: boolean;
  status?: number;
  reason: string;
  latencyMs: number;
  modelCount?: number;
  message?: string;
};

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:ai:providers:test", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const target = await getProviderTestTarget(id);
      if (!target) {
        throw new NotFoundError("AI 供应商不存在。");
      }

      const started = Date.now();
      const channel = channelMeta(target.channel);

      if (!target.apiKey) {
        const result: TestResult = { ok: false, reason: "NO_KEY", latencyMs: 0 };
        await recordProviderTest(id, { ok: false, note: "NO_KEY" });
        await recordAudit({
          userId: ctx.userId,
          actorRole: ctx.role,
          action: "admin.ai_config.test",
          targetType: "ai_provider",
          targetId: id,
          metadata: { ...result },
          ip: ctx.ip,
          requestId: ctx.requestId
        });
        return NextResponse.json(result);
      }

      const baseUrlExplicit = target.baseUrl.trim();
      const baseUrl = (
        target.channel === "ark"
          ? baseUrlExplicit || DEFAULT_ARK_API_ROOT
          : normalizeApiRoot(baseUrlExplicit)
      ).replace(/\/+$/, "");

      let result: TestResult;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetchOpenAi(
            `${baseUrl}/models`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${target.apiKey}`,
                Accept: "application/json"
              },
              signal: controller.signal
            },
            createProxyDispatcher(target.proxyUrl ?? process.env[channel.env.proxyUrl])
          );
        } finally {
          clearTimeout(timer);
        }

        let modelCount: number | undefined;
        try {
          const payload = (await response.json()) as { data?: unknown };
          if (Array.isArray(payload?.data)) {
            modelCount = payload.data.length;
          }
        } catch {
          // Non-JSON error bodies are fine; status/reason are still meaningful.
        }

        const reason = response.ok
          ? "OK"
          : response.status === 401 || response.status === 403
            ? "AUTH_FAILED"
            : response.status === 404
              ? "ENDPOINT_NOT_FOUND"
              : `HTTP_${response.status}`;

        result = {
          ok: response.ok,
          status: response.status,
          reason,
          latencyMs: Date.now() - started,
          ...(modelCount === undefined ? {} : { modelCount }),
          ...(response.ok
            ? {}
            : {
                message:
                  reason === "AUTH_FAILED"
                    ? "凭据被拒绝，请检查 API Key。"
                    : reason === "ENDPOINT_NOT_FOUND"
                      ? "接口地址不存在，请检查 Base URL。"
                      : `接口返回 HTTP ${response.status}。`
              })
        };
      } catch (error) {
        const aborted = error instanceof Error && /abort/i.test(error.message);
        ctx.log.warn("admin.ai_provider.test_failed", {
          id,
          error: error instanceof Error ? error.message : String(error)
        });
        result = {
          ok: false,
          reason: aborted ? "TIMEOUT" : "NETWORK_ERROR",
          latencyMs: Date.now() - started,
          message: aborted
            ? "连接超时，请检查 Base URL 或代理。"
            : "网络请求失败，请检查 Base URL 或代理。"
        };
      }

      await recordProviderTest(id, {
        ok: result.ok,
        note: `${result.reason}${result.status ? ` · ${result.status}` : ""} · ${result.latencyMs}ms`
      });

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.ai_config.test",
        targetType: "ai_provider",
        targetId: id,
        metadata: { ok: result.ok, reason: result.reason, status: result.status },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      return NextResponse.json(result);
    }
  );
}
