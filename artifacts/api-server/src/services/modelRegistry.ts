import { readJson, writeJson } from "../lib/cloudPersist";

export type RegisteredProvider = "openai" | "anthropic" | "gemini" | "openrouter";
export type ModelCapability = "chat" | "image";
export type ModelGroup = "openai" | "openai_image" | "anthropic" | "gemini" | "gemini_image" | "openrouter";
export type ModelTestMode = "chat" | "image";

export type RegisteredModel = {
  id: string;
  provider: RegisteredProvider;
  capability: ModelCapability;
  group: ModelGroup;
  testMode: ModelTestMode;
  description?: string;
};

export const OPENAI_CHAT_MODELS = [
  "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano",
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "gpt-4o", "gpt-4o-mini",
  "o4-mini", "o3", "o3-mini",
];

const OPENAI_THINKING_ALIASES = OPENAI_CHAT_MODELS
  .filter((model) => model.startsWith("o"))
  .map((model) => `${model}-thinking`);

const OPENAI_IMAGE_MODELS = [
  "gpt-image-1",
];

const ANTHROPIC_BASE_MODELS = [
  "claude-opus-4-7",
  "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1",
  "claude-sonnet-4-6", "claude-sonnet-4-5",
  "claude-haiku-4-5",
];

export const CLAUDE_ADAPTIVE_THINKING_MODELS = new Set<string>([
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
]);

export const CLAUDE_DEFAULT_THINKING_BUDGET = 16000;
export const CLAUDE_MIN_THINKING_BUDGET = 1024;
const CLAUDE_MODEL_MAX: Record<string, number> = {
  "claude-opus-4-7": 64000,
  "claude-haiku-4-5": 8096,
  "claude-sonnet-4-5": 64000,
  "claude-sonnet-4-6": 64000,
  "claude-opus-4-1": 32000,
  "claude-opus-4-5": 64000,
  "claude-opus-4-6": 64000,
};

export const GEMINI_BASE_MODELS = [
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview", "gemini-3-flash-preview",
  "gemini-2.5-pro", "gemini-2.5-flash",
];

export const GEMINI_IMAGE_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
];

const OPENROUTER_FEATURED = [
  "x-ai/grok-4.20", "x-ai/grok-4.1-fast", "x-ai/grok-4-fast",
  "x-ai/grok-4.20-multi-agent", "x-ai/grok-code-fast-1",
  "meta-llama/llama-4-maverick", "meta-llama/llama-4-scout",
  "deepseek/deepseek-v3.2", "deepseek/deepseek-r1", "deepseek/deepseek-r1-0528",
  "mistralai/mistral-small-2603", "qwen/qwen3.5-122b-a10b", "qwen/qwen3-coder-next",
  "google/gemini-2.5-pro", "google/gemini-3.1-pro-preview",
  "anthropic/claude-opus-4.6", "anthropic/claude-opus-4.7",
  "cohere/command-a", "amazon/nova-premier-v1", "baidu/ernie-4.5-300b-a47b",
];

export const REGISTERED_MODELS: RegisteredModel[] = [
  ...OPENAI_CHAT_MODELS.map((id) => ({
    id,
    provider: "openai" as const,
    capability: "chat" as const,
    group: "openai" as const,
    testMode: "chat" as const,
    description: "OpenAI model",
  })),
  ...OPENAI_THINKING_ALIASES.map((id) => ({
    id,
    provider: "openai" as const,
    capability: "chat" as const,
    group: "openai" as const,
    testMode: "chat" as const,
    description: "OpenAI thinking alias",
  })),
  ...OPENAI_IMAGE_MODELS.map((id) => ({
    id,
    provider: "openai" as const,
    capability: "image" as const,
    group: "openai_image" as const,
    testMode: "image" as const,
    description: "OpenAI image generation model",
  })),
  ...ANTHROPIC_BASE_MODELS.flatMap((id) => ([
    {
      id,
      provider: "anthropic" as const,
      capability: "chat" as const,
      group: "anthropic" as const,
      testMode: "chat" as const,
      description: "Anthropic Claude model",
    },
    {
      id: `${id}-thinking`,
      provider: "anthropic" as const,
      capability: "chat" as const,
      group: "anthropic" as const,
      testMode: "chat" as const,
      description: "Extended thinking (hidden)",
    },
  ])),
  ...GEMINI_BASE_MODELS.flatMap((id) => ([
    {
      id,
      provider: "gemini" as const,
      capability: "chat" as const,
      group: "gemini" as const,
      testMode: "chat" as const,
      description: "Gemini chat model",
    },
    {
      id: `${id}-thinking`,
      provider: "gemini" as const,
      capability: "chat" as const,
      group: "gemini" as const,
      testMode: "chat" as const,
      description: "Gemini thinking alias",
    },
  ])),
  ...GEMINI_IMAGE_MODELS.map((id) => ({
    id,
    provider: "gemini" as const,
    capability: "image" as const,
    group: "gemini_image" as const,
    testMode: "image" as const,
    description: "Gemini image generation model",
  })),
  ...OPENROUTER_FEATURED.map((id) => ({
    id,
    provider: "openrouter" as const,
    capability: "chat" as const,
    group: "openrouter" as const,
    testMode: "chat" as const,
    description: "OpenRouter model",
  })),
];

export const MODEL_REGISTRY = new Map(REGISTERED_MODELS.map((model) => [model.id, model]));
export const ALL_MODELS = REGISTERED_MODELS.map((model) => ({ id: model.id, description: model.description }));

const CHAT_MODEL_IDS = new Set(REGISTERED_MODELS.filter((model) => model.capability === "chat").map((model) => model.id));
const IMAGE_MODEL_IDS = new Set(REGISTERED_MODELS.filter((model) => model.capability === "image").map((model) => model.id));

let disabledModels: Set<string> = new Set<string>();

function saveDisabledModels(set: Set<string>): void {
  writeJson("disabled_models.json", [...set]).catch((err) => {
    console.error("[persist] failed to save disabled_models:", err);
  });
}

export const modelRegistryReady: Promise<void> = (async () => {
  const savedDisabled = await readJson<string[]>("disabled_models.json").catch(() => null);
  if (Array.isArray(savedDisabled)) {
    disabledModels = new Set<string>(savedDisabled);
    console.log(`[init] loaded ${disabledModels.size} disabled model(s)`);
  }
})();

export function resolveClaudeThinkingModel(model: string, requestedMaxTokens?: number): {
  actualModel: string;
  thinkingEnabled: boolean;
  resolvedMaxTokens: number;
} {
  const thinkingEnabled = model.endsWith("-thinking");
  const actualModel = thinkingEnabled ? model.replace(/-thinking$/, "") : model;
  const modelMax = CLAUDE_MODEL_MAX[actualModel] ?? 32000;
  const defaultMaxTokens = thinkingEnabled ? Math.max(modelMax, 32000) : modelMax;

  return {
    actualModel,
    thinkingEnabled,
    resolvedMaxTokens: Math.min(requestedMaxTokens ?? defaultMaxTokens, modelMax),
  };
}

export function shouldForceClaudeSummarizedThinking(model: string): boolean {
  return model === "claude-opus-4-7";
}

export function normalizeClaudeThinkingDisplay<
  T extends { type: "adaptive"; display?: "summarized" | "omitted" }
    | { type: "enabled"; budget_tokens: number; display?: "summarized" | "omitted" }
>(model: string, thinking: T): T {
  if (!shouldForceClaudeSummarizedThinking(model) || thinking.display) return thinking;
  return {
    ...thinking,
    display: "summarized",
  };
}

export function isModelEnabled(id: string): boolean {
  return !disabledModels.has(id);
}

export function hasRegisteredModel(id: string): boolean {
  return MODEL_REGISTRY.has(id);
}

export function getRegisteredModel(id: string | undefined): RegisteredModel | undefined {
  return id ? MODEL_REGISTRY.get(id) : undefined;
}

export function isImageModel(id: string | undefined): boolean {
  return !!id && IMAGE_MODEL_IDS.has(id);
}

export function isChatModel(id: string | undefined): boolean {
  return !!id && CHAT_MODEL_IDS.has(id);
}

export function updateModelAvailability(args: {
  ids?: string[];
  group?: string;
  provider?: string;
  enabled: boolean;
}): string[] | null {
  const { ids, group, provider, enabled } = args;

  let targets: string[] = [];
  if (Array.isArray(ids) && ids.length > 0) {
    targets = ids.filter((id) => MODEL_REGISTRY.has(id));
  } else if (typeof group === "string") {
    targets = REGISTERED_MODELS.filter((model) => model.group === group).map((model) => model.id);
  } else if (typeof provider === "string") {
    targets = REGISTERED_MODELS.filter((model) => model.provider === provider).map((model) => model.id);
  } else {
    return null;
  }

  for (const id of targets) {
    if (enabled) disabledModels.delete(id);
    else disabledModels.add(id);
  }

  saveDisabledModels(disabledModels);
  return targets;
}
