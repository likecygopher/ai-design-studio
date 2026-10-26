import type { SellingPoint } from "@/src/domain/types";
import {
  createProxyDispatcher,
  fetchOpenAi,
  normalizeApiRoot
} from "@/src/services/image-provider";
import { ensureAiConfigHydrated } from "@/src/platform/ai-config";

export const DEFAULT_TEXT_MODEL = "gpt-4o-mini";

export type PdfExtractionResult = {
  sellingPoints: SellingPoint[];
  model: string;
  isFallback: boolean;
  failureReason?: string;
};

export type PdfCompletionRequest = {
  model: string;
  filename: string;
  pdfBase64: string;
  systemPrompt: string;
  userPrompt: string;
};

export type PdfCompletionFn = (request: PdfCompletionRequest) => Promise<string>;

export type ExtractSellingPointsInput = {
  pdfBytes: Buffer;
  filename: string;
  productName?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  complete?: PdfCompletionFn;
};

/**
 * Sends an uploaded product-info PDF (free-form layout) to a language model and
 * normalizes the reply into ordered selling points for the PDP pipeline.
 */
export async function extractSellingPointsFromPdf(
  input: ExtractSellingPointsInput
): Promise<PdfExtractionResult> {
  const apiKey = (input.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
  const model = input.model ?? process.env.OPENAI_TEXT_MODEL ?? DEFAULT_TEXT_MODEL;

  if (!apiKey) {
    throw new Error("未配置 OPENAI_API_KEY,无法解析 PDF 卖点。");
  }

  const systemPrompt = [
    "You are a product marketing analyst. Extract the product selling points from the attached PDF.",
    "The PDF layout is unstructured; look for unique selling points, core selling points, benefits,",
    "technical proof values, and secondary features. Reply ONLY with JSON of the shape",
    '{"sellingPoints":[{"title":string,"shortLabel":string,"benefit":string,"technicalProof":string}]}',
    "ordered from most to least important. shortLabel is a 2-4 word English label for a black title bar.",
    "benefit is one concise English sentence. technicalProof carries numbers/specs when present.",
    "Extract every distinct selling point (typically 3-10)."
  ].join(" ");
  const userPrompt = `Extract the selling points${
    input.productName ? ` for the product "${input.productName}"` : ""
  } from the attached document "${input.filename}".`;

  try {
    const complete = input.complete ?? createDefaultPdfCompletion(apiKey, input.baseUrl);
    const reply = await complete({
      model,
      filename: input.filename,
      pdfBase64: input.pdfBytes.toString("base64"),
      systemPrompt,
      userPrompt
    });

    const sellingPoints = normalizeReply(reply);
    if (!sellingPoints.length) {
      throw new Error(`模型返回内容无法解析为卖点列表:${reply.slice(0, 160)}`);
    }

    return { sellingPoints, model, isFallback: false };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    console.error(`[selling-point-extractor] extraction failed: ${failureReason}`);
    throw error instanceof Error ? error : new Error(failureReason);
  }
}

function createDefaultPdfCompletion(apiKey: string, baseUrl?: string): PdfCompletionFn {
  const apiRoot = normalizeApiRoot(baseUrl ?? process.env.OPENAI_BASE_URL);
  const dispatcher = createProxyDispatcher();

  return async (request) => {
    const response = await fetchOpenAi(
      `${apiRoot}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "file",
                  file: {
                    filename: request.filename,
                    file_data: `data:application/pdf;base64,${request.pdfBase64}`
                  }
                },
                { type: "text", text: request.userPrompt }
              ]
            }
          ]
        })
      },
      dispatcher
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI API ${response.status}: ${text.slice(0, 400)}`);
    }

    const payload = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return payload.choices?.[0]?.message?.content ?? "";
  };
}

function normalizeReply(reply: string): SellingPoint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonBlock(reply));
  } catch {
    return [];
  }

  const items = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? ((parsed as Record<string, unknown>).sellingPoints ??
        (parsed as Record<string, unknown>).selling_points ??
        [])
      : [];

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item, index) => {
      const title = firstString(item, ["title", "name", "sellingPoint", "point"]) ?? "";
      const shortLabel = firstString(item, ["shortLabel", "short_label", "label"]) ?? title;
      const benefit =
        firstString(item, ["benefit", "description", "detail", "value"]) ?? title;
      const technicalProof = firstString(item, ["technicalProof", "technical_proof", "proof", "spec"]);
      return {
        id: `feature-extracted-${index + 1}`,
        title,
        shortLabel: shortLabel || title,
        benefit: benefit || title,
        technicalProof: technicalProof || undefined,
        priority: index + 1,
        enabled: true
      };
    })
    .filter((point) => point.title.length > 0);
}

/** Some relays wrap JSON in markdown fences; strip them before parsing. */
function extractJsonBlock(reply: string): string {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : reply).trim();
}

function firstString(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

