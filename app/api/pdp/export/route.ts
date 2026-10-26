import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { createUserWorkspace } from "@/src/platform/workspace";
import { toErrorResponse } from "@/src/platform/http";
import { parsePdpCanvasLayout } from "@/src/domain/pdp-canvas-layout";
import type { SellingPoint } from "@/src/domain/types";
import { exportDemoPdp } from "@/src/services/demo-api";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const workspace = createUserWorkspace(userId);
    const product = body.productId
      ? (await workspace.productRegistry.getProduct(String(body.productId))) ?? undefined
      : undefined;

    if (!product) {
      return NextResponse.json(
        { error: "请先在素材库创建产品并上传素材,再导出 PDP。" },
        { status: 400 }
      );
    }

    const settings = await workspace.settingsStore.read();
    const result = await exportDemoPdp({
      taskId: String(body.taskId ?? `task-pdp-export-${Date.now()}`),
      country: settings.country,
      language: settings.language,
      productId: body.productId ? String(body.productId) : undefined,
      product,
      templateVersion: body.templateVersion ? String(body.templateVersion) : undefined,
      sellingPoints: parseSellingPoints(body.sellingPoints),
      sectionImages: parseStringRecord(body.sectionImages),
      coverAssetId: body.coverAssetId ? String(body.coverAssetId) : undefined,
      coverTitle: body.coverTitle ? String(body.coverTitle).slice(0, 160) : undefined,
      coverSubtitle: body.coverSubtitle ? String(body.coverSubtitle).slice(0, 320) : undefined,
      brandMessage: body.brandMessage ? String(body.brandMessage).slice(0, 420) : undefined,
      layout: parsePdpCanvasLayout(body.layout),
      imageStore: workspace.imageStore,
      costLedger: workspace.costLedger
    });

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, 400);
  }
}

function parseSellingPoints(value: unknown): SellingPoint[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const points = value
    .filter(
      (item): item is Record<string, unknown> => typeof item === "object" && item !== null
    )
    .map((item, index) => ({
      id: String(item.id ?? `feature-custom-${index}`),
      title: String(item.title ?? ""),
      shortLabel: String(item.shortLabel ?? item.title ?? ""),
      benefit: String(item.benefit ?? ""),
      technicalProof: item.technicalProof ? String(item.technicalProof) : undefined,
      priority: Number(item.priority ?? index + 1),
      enabled: item.enabled === false ? false : true
    }))
    .filter((point) => point.title || point.shortLabel);

  return points.length ? points : undefined;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}
