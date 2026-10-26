import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import {
  createCoverChatReply,
  getCoverChatUnavailableMessage
} from "@/src/services/cover-chat";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2_000)
      })
    )
    .max(12)
    .default([])
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public route: the landing page chat is available before login, so it is
// explicitly rate limited to protect the upstream model from abuse.
export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "public", rateLimit: { name: "cover-chat", key: "ip", limit: 20, windowMs: 60_000 } },
    async () => {
      const body = await request.json().catch(() => null);
      const parsed = requestSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "请输入有效的聊天内容。" }, { status: 400 });
      }

      try {
        const result = await createCoverChatReply(parsed.data);
        return NextResponse.json(result);
      } catch (error) {
        return NextResponse.json(
          {
            error: getCoverChatUnavailableMessage(parsed.data.message),
            details: error instanceof Error ? error.message : undefined
          },
          { status: 502 }
        );
      }
    }
  );
}
