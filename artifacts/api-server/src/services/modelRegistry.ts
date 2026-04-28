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
  "gpt-5.4",
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
  "gemini-3.1-pro-preview", "gemini-3-flash-preview",
  "gemini-2.5-pro", "gemini-2.5-flash",
];

export const GEMINI_IMAGE_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
];

const OPENROUTER_FEATURED = [
  "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash", "deepseek/deepseek-chat-v3.1",
  "deepseek/deepseek-r1-distill-qwen-32b", "deepseek/deepseek-r1-distill-llama-70b",
  "x-ai/grok-4", "x-ai/grok-3", "x-ai/grok-3-mini", "x-ai/grok-3-mini-beta",
  "anthropic/claude-sonnet-4.6", "anthropic/claude-opus-4.5",
  "anthropic/claude-opus-4.1", "anthropic/claude-opus-4", "anthropic/claude-sonnet-4",
  "anthropic/claude-3.7-sonnet:thinking",
  "google/gemini-2.5-flash", "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-pro-preview", "google/gemini-2.5-pro-preview-05-06",
  "google/gemini-3-flash-preview", "google/gemini-3.1-flash-lite-preview",
  "google/gemini-3.1-flash-image-preview", "google/gemini-3-pro-image-preview",
  "google/gemini-3.1-pro-preview-customtools", "google/gemma-3n-e4b-it",
  "qwen/qwen3.6-flash", "qwen/qwen3.6-35b", "qwen/qwen3.6-27b", "qwen/qwen3.6-max-preview",
  "qwen/qwen3.5-plus-0420", "qwen/qwen3.5-397b", "qwen/qwen3.5-35b", "qwen/qwen3.5-flash",
  "qwen/qwen3.5-plus-0215", "qwen/qwen3-max-thinking", "qwen/qwen3-32b",
  "qwen/qwen3-coder-30b", "qwen/qwen3-8b", "qwen/qwen3-14b", "qwen/qwen-plus:thinking",
  "z-ai/glm-5", "z-ai/glm-4.7", "z-ai/glm-4.7-flash", "z-ai/glm-4.5",
  "z-ai/glm-4.5-air", "z-ai/glm-4.6v", "z-ai/glm-4-32b",
  "moonshotai/kimi-k2.5", "moonshotai/kimi-k2-thinking",
  "minimax/minimax-m2.5", "minimax/minimax-m2.1", "minimax/minimax-m1", "minimax/minimax-m2-her", "minimax/minimax-01",
  "mistralai/devstral-2512", "mistralai/devstral-small", "mistralai/devstral-medium",
  "mistralai/ministral-14b", "mistralai/ministral-8b", "mistralai/ministral-3b",
  "mistralai/mistral-medium-3", "mistralai/mistral-medium-3.1", "mistralai/mistral-nemo",
  "mistralai/codestral-2508", "mistralai/voxtral-small",
  "mistralai/mistral-large-2411", "mistralai/mistral-large-2512",
  "mistralai/mistral-small-creative", "mistralai/mistral-small-3.2",
  "nvidia/nemotron-3-nano-30b-a3b", "nvidia/nemotron-nano-12b-v2-vl",
  "bytedance-seed/seed-1.6", "bytedance-seed/seed-1.6-flash", "bytedance-seed/seed-2.0-mini",
  "bytedance/ui-tars-1.5-7b",
  "amazon/nova-2-lite-v1", "amazon/nova-lite-v1", "amazon/nova-micro-v1", "amazon/nova-pro-v1",
  "baidu/ernie-4.5-vl-424b-a47b",
  "openai/gpt-oss-120b", "openai/gpt-oss-20b", "openai/gpt-oss-safeguard-20b",
  "aion-labs/aion-2.0", "perplexity/sonar-pro-search", "perplexity/sonar", "openrouter/free",
  "inception/mercury-2", "liquid/lfm-2-24b-a2b", "stepfun/step-3.5-flash",
  "upstage/solar-pro-3", "writer/palmyra-x5", "nex-agi/deepseek-v3.1-nex-n1",
  "essentialai/rnj-1-instruct", "openrouter/bodybuilder", "switchpoint/router",
  "allenai/olmo-3.1-32b-instruct", "prime-intellect/intellect-3",
  "deepcogito/cogito-v2.1-671b", "tencent/hunyuan-a13b-instruct",
  "tngtech/deepseek-r1t2-chimera", "morph/morph-v3-large", "morph/morph-v3-fast",
  "nousresearch/hermes-4-70b", "nousresearch/hermes-4-405b",
  "ai21/jamba-large-1.7", "relace/relace-search", "meta-llama/llama-guard-4-12b",
  "microsoft/phi-4", "arcee-ai/trinity-large-preview", "arcee-ai/trinity-mini",
  "x-ai/grok-4.20", "x-ai/grok-4.1-fast", "x-ai/grok-4-fast",
  "x-ai/grok-4.20-multi-agent", "x-ai/grok-code-fast-1",
  "meta-llama/llama-4-maverick", "meta-llama/llama-4-scout",
  "deepseek/deepseek-v3.2", "deepseek/deepseek-v3.2-speciale", "deepseek/deepseek-v3.2-exp",
  "deepseek/deepseek-r1", "deepseek/deepseek-r1-0528",
  "mistralai/mistral-small-2603", "qwen/qwen3.5-122b-a10b", "qwen/qwen3-coder-next",
  "qwen/qwen3-max", "qwen/qwen3-235b-a22b", "qwen/qwen3-coder", "qwen/qwen3-coder-plus",
  "z-ai/glm-4.6", "moonshotai/kimi-k2",
  "google/gemini-2.5-pro", "google/gemini-3.1-pro-preview",
  "anthropic/claude-opus-4.6", "anthropic/claude-opus-4.7",
  "cohere/command-a", "amazon/nova-premier-v1", "baidu/ernie-4.5-300b-a47b",
  "x-ai/grok-3-beta",
  "anthropic/claude-3.7-sonnet", "anthropic/claude-haiku-4.5",
  "anthropic/claude-opus-4.6-fast", "anthropic/claude-sonnet-4.5",
  "google/gemini-2.5-flash-image", "google/gemini-2.5-flash-lite-preview-09-2025",
  "google/gemini-2.0-flash-001", "google/gemini-2.0-flash-lite-001",
  "google/gemma-3-27b-it", "google/gemma-3-12b-it", "google/gemma-3-4b-it",
  "google/gemma-4-31b-it", "google/gemma-4-26b-a4b-it",
  "deepseek/deepseek-chat-v3-0324", "deepseek/deepseek-v3.1-terminus",
  "qwen/qwen-max", "qwen/qwen-plus", "qwen/qwen-plus-2025-07-28", "qwen/qwen-turbo",
  "qwen/qwen-vl-max", "qwen/qwen-vl-plus", "qwen/qwen2.5-vl-72b-instruct",
  "qwen/qwen3-coder-flash",
  "qwen/qwen3-next-80b-a3b-instruct", "qwen/qwen3-next-80b-a3b-thinking",
  "qwen/qwen3-vl-235b-a22b-instruct", "qwen/qwen3-vl-235b-a22b-thinking",
  "qwen/qwen3-vl-30b-a3b-instruct", "qwen/qwen3-vl-30b-a3b-thinking",
  "qwen/qwen3-vl-32b-instruct",
  "qwen/qwen3-vl-8b-instruct", "qwen/qwen3-vl-8b-thinking",
  "qwen/qwen3.5-9b", "qwen/qwen3.6-plus", "qwen/qwq-32b",
  "z-ai/glm-5.1", "z-ai/glm-5-turbo", "z-ai/glm-5v-turbo",
  "moonshotai/kimi-k2-0905", "moonshotai/kimi-k2.6",
  "mistralai/mistral-saba", "mistralai/mistral-small-3.1-24b-instruct",
  "minimax/minimax-m2", "minimax/minimax-m2.7",
  "xiaomi/mimo-v2.5-pro", "xiaomi/mimo-v2.5",
  "xiaomi/mimo-v2-pro", "xiaomi/mimo-v2-omni",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-nano-9b-v2",
  "perplexity/sonar-pro", "perplexity/sonar-deep-research", "perplexity/sonar-reasoning-pro",
  "openai/gpt-4o-search-preview", "openai/gpt-4o-mini-search-preview",
  "aion-labs/aion-1.0", "aion-labs/aion-1.0-mini", "aion-labs/aion-rp-llama-3.1-8b",
  "alibaba/tongyi-deepresearch-30b-a3b",
  "arcee-ai/trinity-large-thinking",
  "bytedance-seed/seed-2.0-lite",
  "ibm-granite/granite-4.0-h-micro",
  "kwaipilot/kat-coder-pro-v2",
  "openrouter/pareto-code",
  "rekaai/reka-edge", "rekaai/reka-flash-3",
  "thedrummer/cydonia-24b-v4.1", "thedrummer/skyfall-36b-v2",
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
const DEFAULT_DISABLED_MODELS = new Set<string>(OPENROUTER_FEATURED);

let disabledModels: Set<string> = new Set<string>(DEFAULT_DISABLED_MODELS);

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
