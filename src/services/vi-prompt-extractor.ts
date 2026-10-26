import {
  createProxyDispatcher,
  fetchOpenAi,
  normalizeApiRoot,
  type SourceImage
} from "@/src/services/image-provider";
import { ensureAiConfigHydrated } from "@/src/platform/ai-config";

export const DEFAULT_VISION_MODEL = "gpt-4o-mini";

export type IconViPromptResult = {
  template: string;
  model: string;
};

export type IconViCompletionRequest = {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  brandColorImage: SourceImage;
  iconGuidelineImage: SourceImage;
};

export type IconViCompletionFn = (request: IconViCompletionRequest) => Promise<string>;

export type ExtractIconViPromptInput = {
  brandColorImage: SourceImage;
  iconGuidelineImage: SourceImage;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  complete?: IconViCompletionFn;
};

export async function extractIconViPromptTemplate(
  input: ExtractIconViPromptInput
): Promise<IconViPromptResult> {
  await ensureAiConfigHydrated();
  const apiKey = (input.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
  const model =
    input.model ??
    process.env.OPENAI_VISION_MODEL ??
    process.env.OPENAI_TEXT_MODEL ??
    DEFAULT_VISION_MODEL;

  if (!apiKey && !input.complete) {
    throw new Error("未配置 OPENAI_API_KEY，无法使用视觉模型解析 VI 规范。");
  }

  const systemPrompt = [
    "You are a senior brand identity system designer.",
    "Analyze the supplied brand color guideline and feature-icon guideline, then write a reusable image-editing prompt template.",
    "Return plain text only, without markdown fences, commentary, or a generated image."
  ].join(" ");
  const userPrompt = [
    "Image 1 is the authoritative brand color guideline. Image 2 is the authoritative product feature icon VI guideline.",
    "Create a reusable prompt template for a later generation request in which image 3 will be the source icon symbol.",
    "The template must preserve the placeholder {{FEATURE_TITLE}} exactly and must state that only the title and source symbol may change.",
    "Extract and express exact colors, stroke treatment, line caps and joins, circular container rules, typography, spacing, alignment, and forbidden effects visible in the references.",
    "It must support four official color variants: black on white, Midea blue on white, blue background with a white circle and blue icon, and deep-blue background with a blue circle and white icon.",
    "It must also support Layout A with a centered icon and title below, and Layout B with icon left and title right. Use the guideline typography; when it specifies Gotham Medium, retain that exact requirement.",
    "The resulting template will be combined with one selected output-variant instruction, so do not ask for a six-panel contact sheet."
  ].join(" ");

  const complete = input.complete ?? createDefaultIconViCompletion(apiKey, input.baseUrl);
  const reply = await complete({
    model,
    systemPrompt,
    userPrompt,
    brandColorImage: input.brandColorImage,
    iconGuidelineImage: input.iconGuidelineImage
  });
  const template = normalizeTemplate(reply);
  if (!template) {
    throw new Error("视觉模型未返回可用的 VI 提示词模板。");
  }

  return { template, model };
}

export function createDefaultIconViCompletion(
  apiKey: string,
  baseUrl?: string
): IconViCompletionFn {
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
          messages: [
            { role: "system", content: request.systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: request.userPrompt },
                {
                  type: "image_url",
                  image_url: { url: toDataUrl(request.brandColorImage), detail: "high" }
                },
                {
                  type: "image_url",
                  image_url: { url: toDataUrl(request.iconGuidelineImage), detail: "high" }
                }
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

function toDataUrl(image: SourceImage): string {
  return `data:${image.contentType};base64,${image.bytes.toString("base64")}`;
}

function normalizeTemplate(reply: string): string {
  const fenced = reply.match(/```(?:text)?\s*([\s\S]*?)```/i);
  let template = (fenced ? fenced[1] : reply).trim();
  template = template
    .replace(/【\s*Replace Here\s*】/gi, "{{FEATURE_TITLE}}")
    .replace(/\[\s*Replace Here\s*\]/gi, "{{FEATURE_TITLE}}");
  if (template && !template.includes("{{FEATURE_TITLE}}")) {
    template += "\nFeature title: {{FEATURE_TITLE}}. Only this title and the image 3 source symbol may change.";
  }
  return template;
}
