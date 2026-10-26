import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { createUserWorkspace } from "@/src/platform/workspace";
import { toErrorResponse } from "@/src/platform/http";
import { parseImageModelChoice } from "@/src/domain/generation-models";
import {
  getCompetitionTaskSpec,
  type CompetitionTaskId
} from "@/src/domain/competition-tasks";
import {
  isWhiteBackgroundSourceState,
  WHITE_BACKGROUND_SOURCE_TYPES
} from "@/src/domain/white-background";
import { runCompetitionOutput } from "@/src/services/competition-runner";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const taskId = String(body.taskId ?? "") as CompetitionTaskId;
  let task;

  try {
    task = getCompetitionTaskSpec(taskId);
  } catch {
    return NextResponse.json({ error: "Unknown capability: " + taskId }, { status: 400 });
  }

  const userId = await requireUserId();
  const workspace = createUserWorkspace(userId);
  const imageStore = workspace.imageStore;
  const product = body.productId
    ? await workspace.productRegistry.getProduct(String(body.productId))
    : null;

  if (!product) {
    return NextResponse.json(
      { error: "请先在素材库创建产品并上传素材，再执行生成。" },
      { status: 400 }
    );
  }

  const outputId = String(body.outputId ?? "");
  if (!task.outputs.some((output) => output.id === outputId)) {
    return NextResponse.json(
      { error: "Unknown output " + outputId + " for capability " + taskId },
      { status: 400 }
    );
  }

  let sourceAssetIdOverride: string | undefined;
  let sourceState: "closed" | "open" | undefined;

  if (taskId === "task1-white-background-6") {
    const requestedSourceAssetId = String(body.sourceAssetId ?? "").trim();
    const requestedSourceState = body.sourceState;

    if (!requestedSourceAssetId || !isWhiteBackgroundSourceState(requestedSourceState)) {
      return NextResponse.json(
        { error: "白底三视角生成需要指定关门或开门产品图。" },
        { status: 400 }
      );
    }

    const sourceAsset = product.assets.find((asset) => asset.id === requestedSourceAssetId);
    const expectedType = WHITE_BACKGROUND_SOURCE_TYPES[requestedSourceState];

    if (!sourceAsset || sourceAsset.productId !== product.id || sourceAsset.type !== expectedType) {
      return NextResponse.json(
        { error: "所选产品图与当前产品或开关门状态不匹配，请重新上传。" },
        { status: 400 }
      );
    }

    sourceAssetIdOverride = sourceAsset.id;
    sourceState = requestedSourceState;
  } else if (taskId === "task1-phone-to-studio-6") {
    const requestedSourceAssetId = String(body.sourceAssetId ?? "").trim();
    const sourceAsset = product.assets.find((asset) => asset.id === requestedSourceAssetId);

    if (
      !requestedSourceAssetId ||
      !sourceAsset ||
      sourceAsset.productId !== product.id ||
      sourceAsset.type !== "phone-shot"
    ) {
      return NextResponse.json(
        { error: "手机图标准化需要上传当前产品的手机拍摄图或非标准产品图。" },
        { status: 400 }
      );
    }

    sourceAssetIdOverride = sourceAsset.id;
  }

  try {
    const locale = await workspace.settingsStore.read();
    const result = await runCompetitionOutput({
      taskId,
      outputId,
      sourceAssetIdOverride,
      sourceState,
      productOverride: product,
      locale,
      imageModel: parseImageModelChoice(body.imageModel),
      imageStore,
      costLedger: workspace.costLedger
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Output run failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}