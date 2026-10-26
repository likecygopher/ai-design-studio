/**
 * Client-safe AI provider metadata (channels, presets, model fields).
 *
 * No Prisma / node:crypto imports here: this module is shared by the admin UI
 * and the server-side provider configuration layer.
 */

export const AI_CHANNELS = [
  {
    id: "openai-compatible",
    label: "OpenAI 兼容",
    hint: "OpenAI / DeepSeek / Moonshot / 通义 / OpenRouter 等",
    env: {
      apiKey: "OPENAI_API_KEY",
      baseUrl: "OPENAI_BASE_URL",
      proxyUrl: "OPENAI_PROXY_URL"
    },
    modelFields: [
      { key: "image", label: "图像模型", envKey: "OPENAI_IMAGE_MODEL", placeholder: "gpt-image-1" },
      { key: "text", label: "文本模型", envKey: "OPENAI_TEXT_MODEL", placeholder: "gpt-4o-mini" },
      { key: "vision", label: "视觉模型", envKey: "OPENAI_VISION_MODEL", placeholder: "gpt-4o-mini" }
    ]
  },
  {
    id: "ark",
    label: "火山方舟 ARK",
    hint: "Seedream 图像 / Seedance 视频",
    env: {
      apiKey: "ARK_API_KEY",
      baseUrl: "ARK_BASE_URL",
      proxyUrl: "ARK_PROXY_URL"
    },
    modelFields: [
      {
        key: "image",
        label: "图像模型",
        envKey: "DOUBAO_IMAGE_MODEL",
        placeholder: "doubao-seedream-..."
      },
      {
        key: "video",
        label: "视频模型",
        envKey: "DOUBAO_VIDEO_MODEL",
        placeholder: "doubao-seedance-..."
      },
      {
        key: "videoEndpoint",
        label: "视频接入点",
        envKey: "DOUBAO_VIDEO_ENDPOINT_ID",
        placeholder: "ep-..."
      }
    ]
  }
] as const;

export type AiChannelId = (typeof AI_CHANNELS)[number]["id"];
export const AI_CHANNEL_IDS = ["openai-compatible", "ark"] as const;

export type AiModelKey = "image" | "text" | "vision" | "video" | "videoEndpoint";
export const AI_MODEL_KEYS = ["image", "text", "vision", "video", "videoEndpoint"] as const;

export type AiProviderModels = Partial<Record<AiModelKey, string>>;

export type AiChannelMeta = (typeof AI_CHANNELS)[number];

export function channelMeta(channel: string): AiChannelMeta {
  const meta = AI_CHANNELS.find((item) => item.id === channel);
  if (!meta) {
    throw new Error(`Unknown AI channel: ${channel}`);
  }
  return meta;
}

/** Presets only pre-fill the dialog; every provider stays editable afterwards. */
export const AI_PROVIDER_PRESETS = [
  {
    id: "openai",
    name: "OpenAI",
    channel: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    models: { image: "gpt-image-1", text: "gpt-4o-mini", vision: "gpt-4o-mini" }
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    channel: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    models: { text: "deepseek-chat" }
  },
  {
    id: "moonshot",
    name: "Moonshot Kimi",
    channel: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    models: { text: "moonshot-v1-8k" }
  },
  {
    id: "qwen",
    name: "通义千问",
    channel: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: { text: "qwen-plus" }
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    channel: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    models: { text: "openai/gpt-4o-mini" }
  },
  {
    id: "ark",
    name: "火山方舟 ARK",
    channel: "ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: {
      image: "doubao-seedream-5-0-lite-260128",
      video: "doubao-seedance-2-0-fast-260128"
    }
  },
  {
    id: "custom",
    name: "自定义 OpenAI 兼容",
    channel: "openai-compatible",
    baseUrl: "",
    models: {}
  }
] as const;

export type AiProviderPreset = (typeof AI_PROVIDER_PRESETS)[number];

export function presetById(id: string): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((item) => item.id === id);
}
