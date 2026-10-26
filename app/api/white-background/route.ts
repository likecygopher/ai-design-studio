import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { handleApi } from "@/src/platform/api";
import {
  parseWhiteBackgroundRequest,
  validateWhiteBackgroundReferences
} from "@/src/domain/white-background";
import { renderWhiteBackgroundOutput } from "@/src/services/white-background";
import { createUserWorkspace } from "@/src/platform/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

export function POST(request: Request) {
  return handleApi(
    request,
    {
      auth: "user",
      // Synchronous generation is expensive: cap per-user submissions.
      rateLimit: { name: "white-background", limit: 6, windowMs: 60_000 }
    },
    async (ctx) => {
      let input;
      try {
        input = parseWhiteBackgroundRequest(await request.json());
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof ZodError
                ? "请选择1–3张产品参考图、有效角度和256–4096px的整数尺寸，并检查背景选项。"
                : "请求内容无效。"
          },
          { status: 400 }
        );
      }

      const workspace = createUserWorkspace(ctx.userId!);
      const product = await workspace.productRegistry.getProduct(input.productId);
      if (!product) {
        return NextResponse.json(
          { error: "当前产品不存在，请先在素材库创建产品。" },
          { status: 400 }
        );
      }

      try {
        validateWhiteBackgroundReferences(input, product.assets);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "参考图无效。" },
          { status: 400 }
        );
      }

      try {
        const output = await renderWhiteBackgroundOutput(input, {
          imageStore: workspace.imageStore,
          costLedger: workspace.costLedger
        });
        return NextResponse.json({ output });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "生成失败，请重试。" },
          { status: 502 }
        );
      }
    }
  );
}
