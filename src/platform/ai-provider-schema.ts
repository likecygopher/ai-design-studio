import { z } from "zod";
import { AI_CHANNEL_IDS } from "@/src/platform/ai-provider-meta";

const httpUrl = z
  .string()
  .trim()
  .max(600)
  .refine((value) => value === "" || /^https?:\/\//i.test(value), "必须以 http(s):// 开头");

const modelValue = z.string().trim().max(200);

export const aiProviderInputSchema = z.object({
  name: z.string().trim().min(1, "请输入名称。").max(60),
  channel: z.enum(AI_CHANNEL_IDS, {
    message: "渠道必须是 openai-compatible 或 ark。"
  }),
  baseUrl: httpUrl.optional(),
  proxyUrl: httpUrl.optional(),
  apiKey: z.string().trim().max(600).optional(),
  clearApiKey: z.boolean().optional(),
  models: z
    .object({
      image: modelValue.optional(),
      text: modelValue.optional(),
      vision: modelValue.optional(),
      video: modelValue.optional(),
      videoEndpoint: modelValue.optional()
    })
    .optional(),
  enabled: z.boolean().optional()
});

export type AiProviderInputValues = z.infer<typeof aiProviderInputSchema>;
