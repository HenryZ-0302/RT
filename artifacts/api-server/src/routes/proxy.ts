import { Router, type IRouter, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { readJson, writeJson } from "../lib/cloudPersist";
import { getServiceAccessKey } from "../lib/serviceConfig";
import { getSillyTavernMode } from "./settings";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const OPENAI_CHAT_MODELS = [
  "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano",
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "gpt-4o", "gpt-4o-mini",
  "o4-mini", "o3", "o3-mini",
];
const OPENAI_THINKING_ALIASES = OPENAI_CHAT_MODELS
  .filter((m) => m.startsWith("o"))
  .map((m) => `${m}-thinking`);

const OPENAI_IMAGE_MODELS = [
  "gpt-image-1",
];

const ANTHROPIC_BASE_MODELS = [
  "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1",
  "claude-sonnet-4-6", "claude-sonnet-4-5",
  "claude-haiku-4-5",
];

const CLAUDE_ADAPTIVE_THINKING_MODELS = new Set<string>([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
]);
const CLAUDE_DEFAULT_THINKING_BUDGET = 16000;
const CLAUDE_MIN_THINKING_BUDGET = 1024;
const CLAUDE_MODEL_MAX: Record<string, number> = {
  "claude-haiku-4-5": 8096,
  "claude-sonnet-4-5": 64000,
  "claude-sonnet-4-6": 64000,
  "claude-opus-4-1": 32000,
  "claude-opus-4-5": 64000,
  "claude-opus-4-6": 64000,
};

const GEMINI_BASE_MODELS = [
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview", "gemini-3-flash-preview",
  "gemini-2.5-pro", "gemini-2.5-flash",
];

const GEMINI_IMAGE_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
];

const OPENROUTER_FEATURED = [
  "x-ai/grok-4.20", "x-ai/grok-4.1-fast", "x-ai/grok-4-fast",
  "meta-llama/llama-4-maverick", "meta-llama/llama-4-scout",
  "deepseek/deepseek-v3.2", "deepseek/deepseek-r1", "deepseek/deepseek-r1-0528",
  "mistralai/mistral-small-2603", "qwen/qwen3.5-122b-a10b",
  "google/gemini-2.5-pro", "anthropic/claude-opus-4.6",
  "cohere/command-a", "amazon/nova-premier-v1", "baidu/ernie-4.5-300b-a47b",
];

type RegisteredProvider = "openai" | "anthropic" | "gemini" | "openrouter";
type ModelCapability = "chat" | "image";
type ModelGroup = "openai" | "openai_image" | "anthropic" | "gemini" | "gemini_image" | "openrouter";
type ModelTestMode = "chat" | "image";

type RegisteredModel = {
  id: string;
  provider: RegisteredProvider;
  capability: ModelCapability;
  group: ModelGroup;
  testMode: ModelTestMode;
  description?: string;
};

function resolveClaudeThinkingModel(model: string, requestedMaxTokens?: number): {
  actualModel: string;
  thinkingEnabled: boolean;
  resolvedMaxTokens: number;
} {
  const thinkingEnabled = model.endsWith("-thinking");
  const actualModel = thinkingEnabled
    ? model.replace(/-thinking$/, "")
    : model;
  const modelMax = CLAUDE_MODEL_MAX[actualModel] ?? 32000;
  const defaultMaxTokens = thinkingEnabled ? Math.max(modelMax, 32000) : modelMax;
  return {
    actualModel,
    thinkingEnabled,
    resolvedMaxTokens: Math.min(requestedMaxTokens ?? defaultMaxTokens, modelMax),
  };
}

const REGISTERED_MODELS: RegisteredModel[] = [
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

const MODEL_REGISTRY = new Map(REGISTERED_MODELS.map((model) => [model.id, model]));
const ALL_MODELS = REGISTERED_MODELS.map((model) => ({ id: model.id, description: model.description }));
const CHAT_MODEL_IDS = new Set(REGISTERED_MODELS.filter((m) => m.capability === "chat").map((m) => m.id));
const IMAGE_MODEL_IDS = new Set(REGISTERED_MODELS.filter((m) => m.capability === "image").map((m) => m.id));

// ---------------------------------------------------------------------------
// Backend pool — round-robin across local account + multiple friend proxies
// with background health checking
// ---------------------------------------------------------------------------

type Backend =
  | { kind: "local" }
  | { kind: "friend"; label: string; url: string; apiKey: string };

interface HealthEntry { healthy: boolean; checkedAt: number }
const healthCache = new Map<string, HealthEntry>();
const HEALTH_TTL_MS = 30_000;   // reuse cached result for 30s
const HEALTH_TIMEOUT_MS = 15_000; // 15s timeout per check (Replit cold starts can take 10–30s)

// ---------------------------------------------------------------------------
// Dynamic backends (cloud-persisted via GCS in production, local file in dev)
// ---------------------------------------------------------------------------

interface DynamicBackend { label: string; url: string; enabled?: boolean }

let dynamicBackends: DynamicBackend[] = [];

function saveDynamicBackends(list: DynamicBackend[]): void {
  writeJson("dynamic_backends.json", list).catch((err) => {
    console.error("[persist] failed to save dynamic_backends:", err);
  });
}

// ---------------------------------------------------------------------------
// Model provider map + enable/disable management
// ---------------------------------------------------------------------------

type ModelProvider = "openai" | "anthropic" | "gemini" | "openrouter";

// Build a complete id → provider lookup from the model constants above
const MODEL_PROVIDER_MAP = new Map<string, ModelProvider>(
  REGISTERED_MODELS.map((model) => [model.id, model.provider]),
);

let disabledModels: Set<string> = new Set<string>();

function saveDisabledModels(set: Set<string>): void {
  writeJson("disabled_models.json", [...set]).catch((err) => {
    console.error("[persist] failed to save disabled_models:", err);
  });
}

interface RoutingSettings { localEnabled: boolean; localFallback: boolean; fakeStream: boolean }
let routingSettings: RoutingSettings = { localEnabled: true, localFallback: true, fakeStream: true };

export const initReady: Promise<void> = (async () => {
  const [savedBackends, savedDisabled, savedRouting] = await Promise.all([
    readJson<DynamicBackend[]>("dynamic_backends.json").catch(() => null),
    readJson<string[]>("disabled_models.json").catch(() => null),
    readJson<Partial<RoutingSettings>>("routing_settings.json").catch(() => null),
  ]);
  if (Array.isArray(savedBackends)) {
    dynamicBackends = savedBackends;
    console.log(`[init] loaded ${dynamicBackends.length} dynamic backend(s)`);
  }
  if (Array.isArray(savedDisabled)) {
    disabledModels = new Set<string>(savedDisabled);
    console.log(`[init] loaded ${disabledModels.size} disabled model(s)`);
  }
  if (savedRouting && typeof savedRouting === "object") {
    if (typeof savedRouting.localEnabled === "boolean") routingSettings.localEnabled = savedRouting.localEnabled;
    if (typeof savedRouting.localFallback === "boolean") routingSettings.localFallback = savedRouting.localFallback;
    if (typeof savedRouting.fakeStream === "boolean") routingSettings.fakeStream = savedRouting.fakeStream;
  }
  console.log("[init] routing settings:", JSON.stringify(routingSettings));
})();

function saveRoutingSettings(): void {
  writeJson("routing_settings.json", routingSettings).catch((err) => {
    console.error("[routing] failed to save settings:", err);
  });
}

function isModelEnabled(id: string): boolean {
  return !disabledModels.has(id);
}

function getRegisteredModel(id: string | undefined): RegisteredModel | undefined {
  return id ? MODEL_REGISTRY.get(id) : undefined;
}

function isImageModel(id: string | undefined): boolean {
  return !!id && IMAGE_MODEL_IDS.has(id);
}

function isChatModel(id: string | undefined): boolean {
  return !!id && CHAT_MODEL_IDS.has(id);
}

// Normalize sub-node endpoint URL — ensures it ends with /api.
// Sub-nodes use the same dual-mount architecture: /api/v1/* routes.
function normalizeSubNodeUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  if (!url) return url;
  return /\/api$/i.test(url) ? url : url + "/api";
}

function getFriendProxyConfigs(): { label: string; url: string; apiKey: string }[] {
  const apiKey = getServiceAccessKey() ?? "";
  const configs: { label: string; url: string; apiKey: string }[] = [];

  // Auto-scan FRIEND_PROXY_URL, FRIEND_PROXY_URL_2 … FRIEND_PROXY_URL_20 from env
  const envKeys = ["FRIEND_PROXY_URL", ...Array.from({ length: 19 }, (_, i) => `FRIEND_PROXY_URL_${i + 2}`)];
  for (const key of envKeys) {
    const raw = process.env[key];
    if (raw) configs.push({ label: key.replace("FRIEND_PROXY_URL", "FRIEND"), url: normalizeSubNodeUrl(raw), apiKey });
  }

  // Merge dynamic backends (added via API), skip duplicates and disabled ones
  const knownUrls = new Set(configs.map((c) => c.url));
  for (const d of dynamicBackends) {
    const url = normalizeSubNodeUrl(d.url);
    if (!knownUrls.has(url) && d.enabled !== false) configs.push({ label: d.label, url, apiKey });
  }

  return configs;
}

// getAllFriendProxyConfigs — 返回全部节点（含禁用的），专供统计页面使用
function getAllFriendProxyConfigs(): { label: string; url: string; apiKey: string; enabled: boolean }[] {
  const apiKey = getServiceAccessKey() ?? "";
  const configs: { label: string; url: string; apiKey: string; enabled: boolean }[] = [];

  const envKeys = ["FRIEND_PROXY_URL", ...Array.from({ length: 19 }, (_, i) => `FRIEND_PROXY_URL_${i + 2}`)];
  for (const key of envKeys) {
    const raw = process.env[key];
    if (raw) configs.push({ label: key.replace("FRIEND_PROXY_URL", "FRIEND"), url: normalizeSubNodeUrl(raw), apiKey, enabled: true });
  }

  const knownUrls = new Set(configs.map((c) => c.url));
  for (const d of dynamicBackends) {
    const url = normalizeSubNodeUrl(d.url);
    if (!knownUrls.has(url)) configs.push({ label: d.label, url, apiKey, enabled: d.enabled !== false });
  }

  return configs;
}

async function probeHealth(url: string, apiKey: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const resp = await fetch(`${url}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

function getCachedHealth(url: string): boolean | null {
  const entry = healthCache.get(url);
  if (!entry) return null; // unknown — never checked
  if (Date.now() - entry.checkedAt < HEALTH_TTL_MS) return entry.healthy;
  return null; // stale
}

function setHealth(url: string, healthy: boolean): void {
  healthCache.set(url, { healthy, checkedAt: Date.now() });
}

// Refresh stale/unknown health entries in the background (non-blocking)
function refreshHealthAsync(): void {
  const configs = getFriendProxyConfigs();
  for (const { url, apiKey } of configs) {
    if (getCachedHealth(url) === null) {
      probeHealth(url, apiKey).then((ok) => setHealth(url, ok)).catch(() => setHealth(url, false));
    }
  }
}

// Kick off initial health checks after a short delay (server hasn't fully started yet)
setTimeout(refreshHealthAsync, 2000);
// Recheck every 30s
setInterval(refreshHealthAsync, HEALTH_TTL_MS);

function buildBackendPool(): Backend[] {
  const friends: Backend[] = [];

  for (const { label, url, apiKey } of getFriendProxyConfigs()) {
    const healthy = getCachedHealth(url);
    if (healthy !== false) {
      friends.push({ kind: "friend", label, url, apiKey });
    }
  }

  if (friends.length > 0) return friends;

  if (routingSettings.localFallback && routingSettings.localEnabled) return [{ kind: "local" }];

  return [];
}

let requestCounter = 0;

function pickBackend(): Backend | null {
  const pool = buildBackendPool();
  if (pool.length === 0) return null;
  const backend = pool[requestCounter % pool.length];
  requestCounter++;
  return backend;
}

function pickBackendExcluding(exclude: Set<string>): Backend | null {
  const friends = buildBackendPool().filter(
    (b) => b.kind === "friend" && !exclude.has(b.url)
  );
  if (friends.length > 0) return friends[requestCounter % friends.length];
  if (routingSettings.localFallback && routingSettings.localEnabled) return { kind: "local" };
  return null;
}

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

function makeLocalOpenAI(): OpenAI {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new Error(
      "OpenAI integration is not configured. Please enable the platform OpenAI integration before using GPT models."
    );
  }
  return new OpenAI({ apiKey, baseURL });
}

function getLocalOpenAIConfig(): { apiKey: string; baseURL: string } {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new Error(
      "OpenAI integration is not configured. Please enable the platform OpenAI integration before using GPT models."
    );
  }
  return { apiKey, baseURL };
}

function makeLocalAnthropic(): Anthropic {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new Error(
      "Anthropic integration is not configured. Please enable the platform Anthropic integration before using Claude models."
    );
  }
  return new Anthropic({ apiKey, baseURL });
}

function makeLocalGemini(): GoogleGenAI {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error(
      "Gemini integration is not configured. Please enable the platform Gemini integration before using Gemini models."
    );
  }
  return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
}

function makeLocalOpenRouter(): OpenAI {
  const apiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new Error(
      "OpenRouter integration is not configured. Please enable the platform OpenRouter integration before using OpenRouter models."
    );
  }
  return new OpenAI({ apiKey, baseURL });
}


// ---------------------------------------------------------------------------
// Per-backend usage statistics — persisted to cloudPersist ("usage_stats.json")
// ---------------------------------------------------------------------------

const STATS_FILE = "usage_stats.json";

interface BackendStat {
  calls: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  totalDurationMs: number;
  totalTtftMs: number;
  streamingCalls: number;
}

interface ModelStat {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  capability?: ModelCapability;
}

const EMPTY_STAT = (): BackendStat => ({
  calls: 0, errors: 0, promptTokens: 0, completionTokens: 0,
  totalDurationMs: 0, totalTtftMs: 0, streamingCalls: 0,
});

const EMPTY_MODEL_STAT = (): ModelStat => ({
  calls: 0, promptTokens: 0, completionTokens: 0,
});

const statsMap = new Map<string, BackendStat>();
const modelStatsMap = new Map<string, ModelStat>();

// ── Persistence helpers ────────────────────────────────────────────────────

function statsToObject(): { backends: Record<string, BackendStat>; models: Record<string, ModelStat> } {
  return {
    backends: Object.fromEntries(statsMap.entries()),
    models: Object.fromEntries(modelStatsMap.entries()),
  };
}

async function persistStats(): Promise<void> {
  try { await writeJson(STATS_FILE, statsToObject()); } catch {}
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; void persistStats(); }, 2_000);
}

setInterval(() => { void persistStats(); }, 60_000);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[stats] ${sig} received, flushing stats…`);
    persistStats().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000);
  });
}

export const statsReady: Promise<void> = (async () => {
  try {
    const saved = await readJson<Record<string, unknown>>(STATS_FILE);
    if (saved && typeof saved === "object") {
      const backendsRaw = (saved as { backends?: Record<string, BackendStat> }).backends ?? saved as Record<string, BackendStat>;
      const modelsRaw = (saved as { models?: Record<string, ModelStat> }).models;

      for (const [label, raw] of Object.entries(backendsRaw)) {
        if (raw && typeof raw === "object" && "calls" in (raw as Record<string, unknown>)) {
          statsMap.set(label, {
            calls:            Number((raw as BackendStat).calls)            || 0,
            errors:           Number((raw as BackendStat).errors)           || 0,
            promptTokens:     Number((raw as BackendStat).promptTokens)     || 0,
            completionTokens: Number((raw as BackendStat).completionTokens) || 0,
            totalDurationMs:  Number((raw as BackendStat).totalDurationMs)  || 0,
            totalTtftMs:      Number((raw as BackendStat).totalTtftMs)      || 0,
            streamingCalls:   Number((raw as BackendStat).streamingCalls)   || 0,
          });
        }
      }

      if (modelsRaw && typeof modelsRaw === "object") {
        for (const [model, raw] of Object.entries(modelsRaw)) {
          if (raw && typeof raw === "object") {
            modelStatsMap.set(model, {
              calls:            Number(raw.calls)            || 0,
              promptTokens:     Number(raw.promptTokens)     || 0,
              completionTokens: Number(raw.completionTokens) || 0,
              capability: raw.capability === "image" ? "image" : "chat",
            });
          }
        }
      }

      console.log(`[stats] loaded ${statsMap.size} backend(s), ${modelStatsMap.size} model(s) from ${STATS_FILE}`);
    }
  } catch {
    console.warn(`[stats] could not load ${STATS_FILE}, starting fresh`);
  }
})();

// ── Stat accessors ─────────────────────────────────────────────────────────

function getStat(label: string): BackendStat {
  if (!statsMap.has(label)) statsMap.set(label, EMPTY_STAT());
  return statsMap.get(label)!;
}

function recordCallStat(label: string, durationMs: number, prompt: number, completion: number, ttftMs?: number, model?: string): void {
  const s = getStat(label);
  s.calls++;
  s.promptTokens += prompt;
  s.completionTokens += completion;
  s.totalDurationMs += durationMs;
  if (ttftMs !== undefined) { s.totalTtftMs += ttftMs; s.streamingCalls++; }
  if (model) {
    const ms = getModelStat(model);
    ms.calls++;
    ms.promptTokens += prompt;
    ms.completionTokens += completion;
    ms.capability = MODEL_REGISTRY.get(model)?.capability ?? "chat";
  }
  scheduleSave();
}

function getModelStat(model: string): ModelStat {
  if (!modelStatsMap.has(model)) {
    modelStatsMap.set(model, {
      ...EMPTY_MODEL_STAT(),
      capability: MODEL_REGISTRY.get(model)?.capability ?? "chat",
    });
  }
  return modelStatsMap.get(model)!;
}

function recordImageCallStat(label: string, durationMs: number, model: string): void {
  const s = getStat(label);
  s.calls++;
  s.totalDurationMs += durationMs;
  const ms = getModelStat(model);
  ms.calls++;
  ms.capability = "image";
  scheduleSave();
}

function recordErrorStat(label: string): void { getStat(label).errors++; scheduleSave(); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setSseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
}

function writeAndFlush(res: Response, data: string) {
  res.write(data);
  (res as unknown as { flush?: () => void }).flush?.();
}

function sanitizeThinkingText(raw: string): string {
  return raw.replace(/<\/?think>/g, "");
}

function isTimeoutLikeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return err instanceof DOMException
    || /timeout|timed out|aborted|aborterror|und_err_connect_timeout/i.test(message);
}

function normalizeImageError(err: unknown, model: string): unknown {
  if (err instanceof HttpStatusError) return err;
  if (isTimeoutLikeError(err)) {
    return new HttpStatusError(504, `Image generation timed out for '${model}'. Please retry in a moment.`);
  }
  return err;
}

function buildReasoningFields(reasoning: string): { reasoning: string; reasoning_content: string } {
  return {
    reasoning,
    reasoning_content: reasoning,
  };
}

function extractGeminiTextAndReasoning(source: unknown): { text: string; reasoning: string } {
  const candidates = (source as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> })?.candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];
  const textParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const part of parts) {
    if (typeof part?.text !== "string" || !part.text) continue;
    if (part.thought === true) {
      reasoningParts.push(part.text);
    } else {
      textParts.push(part.text);
    }
  }

  return {
    text: textParts.join(""),
    reasoning: reasoningParts.join(""),
  };
}

async function fakeStreamResponse(
  res: Response,
  json: Record<string, unknown>,
  startTime: number,
): Promise<{ promptTokens: number; completionTokens: number; ttftMs: number }> {
  const id = (json["id"] as string) ?? `chatcmpl-fake-${Date.now()}`;
  const model = (json["model"] as string) ?? "unknown";
  const created = (json["created"] as number) ?? Math.floor(Date.now() / 1000);
  const choices = (json["choices"] as Array<Record<string, unknown>>) ?? [];
  const usage = json["usage"] as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  setSseHeaders(res);

  const roleChunk = {
    id, object: "chat.completion.chunk", created, model,
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
  };
  writeAndFlush(res, `data: ${JSON.stringify(roleChunk)}\n\n`);
  const ttftMs = Date.now() - startTime;

  const fullContent = (choices[0]?.["message"] as { content?: string })?.content ?? "";
  const fullReasoning = (choices[0]?.["message"] as { reasoning?: string; reasoning_content?: string })?.reasoning_content
    ?? (choices[0]?.["message"] as { reasoning?: string })?.reasoning
    ?? "";
  const toolCalls = (choices[0]?.["message"] as { tool_calls?: unknown[] })?.tool_calls;

  if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
    const tcChunk = {
      id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
    };
    writeAndFlush(res, `data: ${JSON.stringify(tcChunk)}\n\n`);
  }

  const CHUNK_SIZE = 4;
  for (let i = 0; i < fullReasoning.length; i += CHUNK_SIZE) {
    const slice = fullReasoning.slice(i, i + CHUNK_SIZE);
    const chunk = {
      id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: buildReasoningFields(slice), finish_reason: null }],
    };
    writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
    if (i + CHUNK_SIZE < fullReasoning.length) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  for (let i = 0; i < fullContent.length; i += CHUNK_SIZE) {
    const slice = fullContent.slice(i, i + CHUNK_SIZE);
    const chunk = {
      id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: { content: slice }, finish_reason: null }],
    };
    writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
    if (i + CHUNK_SIZE < fullContent.length) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  const finishReason = (choices[0]?.["finish_reason"] as string) ?? "stop";
  const stopChunk = {
    id, object: "chat.completion.chunk", created, model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
  writeAndFlush(res, `data: ${JSON.stringify(stopChunk)}\n\n`);
  writeAndFlush(res, "data: [DONE]\n\n");
  res.end();

  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    ttftMs,
  };
}

function requireApiKey(req: Request, res: Response, next: () => void) {
  const serviceKey = getServiceAccessKey();
  if (!serviceKey) {
    pushRequestLog({
      method: req.method,
      path: req.path,
      status: 500,
      duration: 0,
      stream: false,
      level: "error",
      error: "Service access key is not configured",
    });
    res.status(500).json({ error: { message: "Service access key is not configured", type: "server_error" } });
    return;
  }

  const authHeader = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];
  const xGoogApiKey = req.headers["x-goog-api-key"];

  let providedKey: string | undefined;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    providedKey = authHeader.slice(7);
  } else if (typeof xApiKey === "string") {
    providedKey = xApiKey;
  } else if (typeof xGoogApiKey === "string") {
    providedKey = xGoogApiKey;
  }

  if (!providedKey) {
    pushRequestLog({
      method: req.method,
      path: req.path,
      status: 401,
      duration: 0,
      stream: false,
      level: "warn",
      error: "Missing access key",
    });
    res.status(401).json({ error: { message: "Missing access key (provide Authorization: Bearer <key>, x-api-key, x-goog-api-key, or ?key=...)", type: "invalid_request_error" } });
    return;
  }
  if (providedKey !== serviceKey) {
    pushRequestLog({
      method: req.method,
      path: req.path,
      status: 401,
      duration: 0,
      stream: false,
      level: "warn",
      error: "Invalid access key",
    });
    res.status(401).json({ error: { message: "Invalid access key", type: "invalid_request_error" } });
    return;
  }
  next();
}

function requireApiKeyWithQuery(req: Request, res: Response, next: () => void) {
  const queryKey = req.query["key"] as string | undefined;
  if (queryKey) {
    req.headers["authorization"] = `Bearer ${queryKey}`;
  }
  requireApiKey(req, res, next);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function sendModelCatalog(_req: Request, res: Response) {
  const pool = buildBackendPool();
  const friendStatuses = getFriendProxyConfigs().map(({ label, url }) => ({
    label,
    url,
    status: getCachedHealth(url) === null ? "unknown" : getCachedHealth(url) ? "healthy" : "down",
  }));
  res.json({
    object: "list",
    data: ALL_MODELS.filter((m) => isModelEnabled(m.id)).map((m) => ({
      id: m.id,
      object: "model",
      created: 1700000000,
      owned_by: MODEL_REGISTRY.get(m.id)?.provider ?? "service-layer",
      description: m.description,
      capability: MODEL_REGISTRY.get(m.id)?.capability ?? "chat",
      group: MODEL_REGISTRY.get(m.id)?.group ?? "openrouter",
    })),
    _meta: {
      active_backends: pool.length,
      local: "healthy",
      friends: friendStatuses,
    },
  });
}

for (const path of ["/v1/models", "/service/catalog"]) {
  router.get(path, requireApiKeyWithQuery, sendModelCatalog);
}

function formatGeminiDisplayName(modelId: string): string {
  return modelId
    .split("-")
    .map((part) => {
      if (part === "gemini") return "Gemini";
      if (/^\d+(?:\.\d+)?$/.test(part)) return part;
      if (part === "pro") return "Pro";
      if (part === "flash") return "Flash";
      if (part === "preview") return "Preview";
      if (part === "image") return "Image";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function buildGeminiNativeModel(modelId: string) {
  const registered = MODEL_REGISTRY.get(modelId);
  const isImage = registered?.capability === "image";
  const versionMatch = modelId.match(/gemini-(\d+(?:\.\d+)?)/);

  return {
    name: `models/${modelId}`,
    baseModelId: modelId,
    version: versionMatch?.[1] ?? "preview",
    displayName: formatGeminiDisplayName(modelId),
    description: registered?.description ?? "Gemini model",
    supportedGenerationMethods: isImage
      ? ["generateImages"]
      : ["generateContent", "streamGenerateContent", "countTokens"],
    thinking: !isImage && GEMINI_BASE_MODELS.includes(modelId),
  };
}

function listGeminiNativeModels(_req: Request, res: Response) {
  const models = [...GEMINI_BASE_MODELS, ...GEMINI_IMAGE_MODELS]
    .filter((id) => isModelEnabled(id))
    .map((id) => buildGeminiNativeModel(id));

  res.json({ models });
}

function getGeminiNativeModel(req: Request, res: Response) {
  const rawModel = req.params.model;
  const modelId = rawModel.startsWith("models/") ? rawModel.slice("models/".length) : rawModel;

  if (![...GEMINI_BASE_MODELS, ...GEMINI_IMAGE_MODELS].includes(modelId) || !isModelEnabled(modelId)) {
    res.status(404).json({
      error: {
        message: `Model 'models/${modelId}' not found`,
        type: "not_found",
      },
    });
    return;
  }

  res.json(buildGeminiNativeModel(modelId));
}

router.get("/v1beta/models", requireApiKeyWithQuery, listGeminiNativeModels);
router.get("/v1beta/models/:model", requireApiKeyWithQuery, getGeminiNativeModel);

// ---------------------------------------------------------------------------
// Image format conversion: OpenAI image_url → Anthropic image
// ---------------------------------------------------------------------------

type OAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } }
  | Record<string, unknown>;

type OAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OAITool = {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
};

type OAIMessage =
  | { role: "system"; content: string | OAIContentPart[] }
  | { role: "user"; content: string | OAIContentPart[] }
  | { role: "assistant"; content: string | OAIContentPart[] | null; tool_calls?: OAIToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string }
  | { role: string; content: string | OAIContentPart[] | null };

type OAIImageGenerationRequest = {
  model?: string;
  prompt?: string;
  image?: string;
  images?: string[];
  n?: number;
  size?: string;
  response_format?: "b64_json" | "url" | string;
};

type GeminiNativeImageRequest = {
  prompt?: string;
  image?: string;
  images?: string[];
  n?: number;
  size?: string;
  response_format?: "b64_json" | "url" | string;
  contents?: unknown;
  config?: Record<string, unknown>;
};

type GeminiNativeGenerateContentRequest = {
  contents?: unknown;
  config?: Record<string, unknown>;
  generationConfig?: Record<string, unknown>;
  systemInstruction?: unknown;
  safetySettings?: unknown;
  tools?: unknown;
  toolConfig?: unknown;
  cachedContent?: string;
  [key: string]: unknown;
};

type AnthropicImageSource =
  | { type: "base64"; media_type: string; data: string }
  | { type: "url"; url: string };

type AnthropicContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: AnthropicImageSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContentPart[] };

function convertContentForClaude(content: string | OAIContentPart[] | null | undefined): string | AnthropicContentPart[] {
  if (!content) return "";
  if (typeof content === "string") return content;

  return content.map((part): AnthropicContentPart => {
    if (part.type === "image_url") {
      const url = (part as { type: "image_url"; image_url: { url: string } }).image_url.url;
      if (url.startsWith("data:")) {
        const [header, data] = url.split(",");
        const media_type = header.replace("data:", "").replace(";base64", "");
        return { type: "image", source: { type: "base64", media_type, data } };
      } else {
        return { type: "image", source: { type: "url", url } };
      }
    }
    if (part.type === "text") {
      return { type: "text", text: (part as { type: "text"; text: string }).text };
    }
    return { type: "text", text: JSON.stringify(part) };
  });
}

function detectMimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function mapOpenAIImageSize(size?: string): { aspectRatio?: string } {
  switch (size) {
    case undefined:
    case "":
    case "1024x1024":
      return { aspectRatio: "1:1" };
    case "1536x1024":
      return { aspectRatio: "3:2" };
    case "1024x1536":
      return { aspectRatio: "2:3" };
    case "1536x864":
      return { aspectRatio: "16:9" };
    case "864x1536":
      return { aspectRatio: "9:16" };
    default:
      throw new HttpStatusError(
        400,
        `Unsupported image size '${size}'. Supported sizes: 1024x1024, 1536x1024, 1024x1536, 1536x864, 864x1536.`,
      );
  }
}

async function imageInputToPart(value: string): Promise<Record<string, unknown>> {
  const dataUrl = parseDataUrl(value);
  if (dataUrl) {
    return { inlineData: { mimeType: dataUrl.mimeType, data: dataUrl.data } };
  }

  const response = await fetch(value, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new HttpStatusError(400, `Failed to fetch input image: HTTP ${response.status}`);
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0] || detectMimeTypeFromUrl(value);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { inlineData: { mimeType, data: buffer.toString("base64") } };
}

async function imageInputToBlob(value: string): Promise<Blob> {
  const dataUrl = parseDataUrl(value);
  if (dataUrl) {
    return new Blob([Buffer.from(dataUrl.data, "base64")], { type: dataUrl.mimeType });
  }

  const response = await fetch(value, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new HttpStatusError(400, `Failed to fetch input image: HTTP ${response.status}`);
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0] || detectMimeTypeFromUrl(value);
  return new Blob([Buffer.from(await response.arrayBuffer())], { type: mimeType });
}

async function buildGeminiImageContents(prompt: string, imageInputs: string[]): Promise<Record<string, unknown>[]> {
  const parts: Record<string, unknown>[] = [];
  for (const input of imageInputs) {
    parts.push(await imageInputToPart(input));
  }
  parts.push({ text: prompt });
  return [{ role: "user", parts }];
}

function extractGeneratedImages(response: {
  candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
}): Array<{ mimeType: string; b64_json: string }> {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const images: Array<{ mimeType: string; b64_json: string }> = [];
  for (const part of parts) {
    const inlineData = part.inlineData as { mimeType?: string; data?: string } | undefined;
    if (inlineData?.data) {
      images.push({
        mimeType: inlineData.mimeType ?? "image/png",
        b64_json: inlineData.data,
      });
    }
  }
  return images;
}

async function handleOpenAIImage({
  model,
  prompt,
  imageInputs,
  n,
  size,
}: {
  model: string;
  prompt: string;
  imageInputs: string[];
  n?: number;
  size?: string;
}): Promise<Record<string, unknown>> {
  try {
    const { apiKey, baseURL } = getLocalOpenAIConfig();
    const normalizedBaseURL = baseURL.replace(/\/+$/, "");

    if (imageInputs.length > 0) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      if (typeof n === "number") form.set("n", String(Math.max(1, Math.min(4, Math.floor(n)))));
      if (size) form.set("size", size);
      for (let i = 0; i < imageInputs.length; i++) {
        form.append("image", await imageInputToBlob(imageInputs[i]), `image-${i + 1}.png`);
      }

      const response = await fetch(`${normalizedBaseURL}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "unknown");
        throw new HttpStatusError(response.status, `OpenAI image edit failed: ${errText}`);
      }
      return await response.json() as Record<string, unknown>;
    }

    const response = await fetch(`${normalizedBaseURL}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        ...(typeof n === "number" ? { n: Math.max(1, Math.min(4, Math.floor(n))) } : {}),
        ...(size ? { size } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "unknown");
      throw new HttpStatusError(response.status, `OpenAI image generation failed: ${errText}`);
    }
    return await response.json() as Record<string, unknown>;
  } catch (err) {
    throw normalizeImageError(err, model);
  }
}

// Convert OpenAI tools array → Anthropic tools array
function convertToolsForClaude(tools: OAITool[]): { name: string; description: string; input_schema: unknown }[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

// Convert OpenAI messages (incl. tool_calls / tool roles) → Anthropic messages
function convertMessagesForClaude(messages: OAIMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue; // handled as top-level system param

    if (msg.role === "assistant") {
      const assistantMsg = msg as Extract<OAIMessage, { role: "assistant" }>;
      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        // Convert tool_calls to Anthropic tool_use blocks
        const parts: AnthropicContentPart[] = [];
        const textContent = assistantMsg.content;
        if (textContent && (typeof textContent === "string" ? textContent.trim() : textContent.length > 0)) {
          const converted = convertContentForClaude(textContent as string | OAIContentPart[]);
          if (typeof converted === "string") {
            if (converted.trim()) parts.push({ type: "text", text: converted });
          } else {
            parts.push(...converted);
          }
        }
        for (const tc of assistantMsg.tool_calls) {
          let input: unknown = {};
          try { input = JSON.parse(tc.function.arguments); } catch {}
          parts.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
        result.push({ role: "assistant", content: parts });
      } else {
        result.push({
          role: "assistant",
          content: convertContentForClaude(assistantMsg.content as string | OAIContentPart[]),
        });
      }
    } else if (msg.role === "tool") {
      // Tool results → Anthropic user message with tool_result
      const toolMsg = msg as Extract<OAIMessage, { role: "tool" }>;
      result.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolMsg.tool_call_id, content: toolMsg.content }],
      });
    } else {
      // user (and any other role)
      result.push({
        role: "user",
        content: convertContentForClaude(msg.content as string | OAIContentPart[]),
      });
    }
  }

  return result;
}

async function handleGeminiImage({
  model,
  prompt,
  imageInputs,
  n,
  size,
  nativeConfig,
  nativeContents,
}: {
  model: string;
  prompt: string;
  imageInputs: string[];
  n?: number;
  size?: string;
  nativeConfig?: Record<string, unknown>;
  nativeContents?: unknown;
}): Promise<{
  raw: Record<string, unknown>;
  images: Array<{ mimeType: string; b64_json: string }>;
}> {
  try {
    const client = makeLocalGemini();
    const contents = nativeContents ?? await buildGeminiImageContents(prompt, imageInputs);
    const sizeConfig = mapOpenAIImageSize(size);
    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        ...(nativeConfig ?? {}),
        ...(sizeConfig.aspectRatio ? { aspectRatio: sizeConfig.aspectRatio } : {}),
        ...(typeof n === "number" ? { numberOfImages: Math.max(1, Math.min(4, Math.floor(n))) } : {}),
      },
    });
    const raw = response as unknown as Record<string, unknown>;
    const images = extractGeneratedImages(raw as {
      candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
    });
    if (images.length === 0) {
      throw new HttpStatusError(502, `Image model '${model}' returned no image output.`);
    }
    return { raw, images };
  } catch (err) {
    throw normalizeImageError(err, model);
  }
}

async function handleFriendJsonProxy({
  backend,
  path,
  body,
  timeoutMs = 180_000,
}: {
  backend: Extract<Backend, { kind: "friend" }>;
  path: string;
  body: unknown;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> {
  const fetchRes = await fetch(`${backend.url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!fetchRes.ok) {
    const errText = await fetchRes.text().catch(() => "unknown");
    throw new FriendProxyHttpError(fetchRes.status, `Peer backend error ${fetchRes.status}: ${errText}`);
  }
  return await fetchRes.json() as Record<string, unknown>;
}

async function handleFriendSseProxy({
  backend,
  path,
  body,
  res,
  timeoutMs = 180_000,
}: {
  backend: Extract<Backend, { kind: "friend" }>;
  path: string;
  body: unknown;
  res: Response;
  timeoutMs?: number;
}): Promise<void> {
  const fetchRes = await fetch(`${backend.url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!fetchRes.ok) {
    const errText = await fetchRes.text().catch(() => "unknown");
    throw new FriendProxyHttpError(fetchRes.status, `Peer backend error ${fetchRes.status}: ${errText}`);
  }
  if (!fetchRes.body) {
    throw new HttpStatusError(502, "Peer backend returned no stream body.");
  }

  setSseHeaders(res);
  const reader = fetchRes.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) writeAndFlush(res, decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) writeAndFlush(res, tail);
  } finally {
    reader.releaseLock();
  }

  res.end();
}

function normalizeGeminiNativeModel(rawModel: string): string {
  return rawModel.startsWith("models/") ? rawModel.slice("models/".length) : rawModel;
}

function getEnabledGeminiNativeChatModel(rawModel: string): string {
  const model = normalizeGeminiNativeModel(rawModel);
  if (!GEMINI_BASE_MODELS.includes(model)) {
    throw new HttpStatusError(400, `Model '${model}' is not a Gemini chat model.`);
  }
  if (!isModelEnabled(model)) {
    throw new HttpStatusError(403, `Model '${model}' is disabled on this service.`);
  }
  return model;
}

function buildGeminiNativeConfig(body: GeminiNativeGenerateContentRequest): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {
    ...(body.config && typeof body.config === "object" ? body.config : {}),
    ...(body.generationConfig && typeof body.generationConfig === "object" ? body.generationConfig : {}),
  };

  if (body.systemInstruction !== undefined) config.systemInstruction = body.systemInstruction;
  if (body.safetySettings !== undefined) config.safetySettings = body.safetySettings;
  if (body.tools !== undefined) config.tools = body.tools;
  if (body.toolConfig !== undefined) config.toolConfig = body.toolConfig;
  if (body.cachedContent !== undefined) config.cachedContent = body.cachedContent;

  return Object.keys(config).length > 0 ? config : undefined;
}

function buildGeminiNativeGenerateArgs(model: string, body: GeminiNativeGenerateContentRequest): Record<string, unknown> {
  const config = buildGeminiNativeConfig(body);
  return {
    model,
    contents: body.contents ?? [],
    ...(config ? { config } : {}),
  };
}

function estimateGeminiNativeTokensFromContents(contents: unknown): number {
  const visited = new Set<unknown>();

  const walk = (value: unknown): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === "string") return value.length;
    if (typeof value === "number" || typeof value === "boolean") return String(value).length;
    if (typeof value !== "object") return 0;
    if (visited.has(value)) return 0;
    visited.add(value);

    if (Array.isArray(value)) return value.reduce((sum, item) => sum + walk(item), 0);

    return Object.values(value as Record<string, unknown>).reduce((sum, item) => sum + walk(item), 0);
  };

  return Math.max(1, Math.ceil(walk(contents) / 4));
}

async function generateOpenAICompatibleImageResponse(
  req: Request,
  body: OAIImageGenerationRequest,
): Promise<Record<string, unknown>> {
  if (body.model && !MODEL_REGISTRY.has(body.model)) {
    throw new HttpStatusError(400, `Unknown model '${body.model}'.`);
  }
  const selectedModel = body.model ?? "gemini-2.5-flash-image";
  const modelInfo = getRegisteredModel(selectedModel);
  if (!modelInfo || modelInfo.capability !== "image") {
    throw new HttpStatusError(400, `Model '${selectedModel}' is not an image generation model.`);
  }
  if (!isModelEnabled(selectedModel)) {
    throw new HttpStatusError(403, `Model '${selectedModel}' is disabled on this service.`);
  }
  if (body.response_format && body.response_format !== "b64_json") {
    throw new HttpStatusError(400, "This service only supports response_format 'b64_json' for image generation.");
  }
  const prompt = body.prompt?.trim();
  if (!prompt) {
    throw new HttpStatusError(400, "prompt is required.");
  }
  const imageInputs = [
    ...(typeof body.image === "string" ? [body.image] : []),
    ...(Array.isArray(body.images) ? body.images.filter((item): item is string => typeof item === "string" && item.length > 0) : []),
  ];
  const provider = modelInfo.provider;

  const startTime = Date.now();
  let backend = pickBackend();
  if (!backend) throw new HttpStatusError(503, "No available backends - all sub-nodes are down and local fallback is disabled");

  const triedFriendUrls = new Set<string>();
  for (let attempt = 0; ; attempt++) {
    const backendLabel = backend.kind === "local" ? "local" : backend.label;
    try {
      let responseJson: Record<string, unknown>;
      if (backend.kind === "friend") {
        triedFriendUrls.add(backend.url);
        responseJson = await handleFriendJsonProxy({
          backend,
          path: "/v1/images/generations",
          body: {
            model: selectedModel,
            prompt,
            image: body.image,
            images: body.images,
            n: body.n,
            size: body.size,
            response_format: "b64_json",
          },
        });
      } else {
        if (provider === "openai") {
          responseJson = await handleOpenAIImage({
            model: selectedModel,
            prompt,
            imageInputs,
            n: body.n,
            size: body.size,
          });
        } else {
          const result = await handleGeminiImage({
            model: selectedModel,
            prompt,
            imageInputs,
            n: body.n,
            size: body.size,
          });
          responseJson = {
            created: Math.floor(Date.now() / 1000),
            data: result.images.map((image) => ({ b64_json: image.b64_json, mime_type: image.mimeType })),
          };
        }
      }

      const duration = Date.now() - startTime;
      if (backend.kind === "friend") setHealth(backend.url, true);
      recordImageCallStat(backendLabel, duration, selectedModel);
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "image",
        backend: backendLabel,
        status: 200,
        duration,
        stream: false,
        level: "info",
      });
      return responseJson;
    } catch (err) {
      const duration = Date.now() - startTime;
      if (backend.kind === "friend") {
        setHealth(backend.url, false);
        const status = err instanceof FriendProxyHttpError ? err.status : 502;
        if (!(err instanceof FriendProxyHttpError) || status >= 500) {
          backend = pickBackendExcluding(triedFriendUrls);
          if (backend && attempt < 3) continue;
        }
      }
      const status = err instanceof HttpStatusError
        ? err.status
        : err instanceof FriendProxyHttpError
          ? err.status
          : 500;
      const message = err instanceof Error ? err.message : "Unknown error";
      recordErrorStat(backend.kind === "local" ? "local" : backend.label);
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "image",
        backend: backend.kind === "local" ? "local" : backend.label,
        status,
        duration,
        stream: false,
        level: status >= 500 ? "error" : "warn",
        error: message,
      });
      if (err && typeof err === "object") (err as { __logged?: boolean }).__logged = true;
      throw err;
    }
  }
}

async function handleOpenAIImageGeneration(req: Request, res: Response) {
  const body = req.body as OAIImageGenerationRequest;
  if (body.response_format && body.response_format !== "b64_json") {
    throw new HttpStatusError(400, "This service only supports response_format 'b64_json' for image generation.");
  }
  const responseJson = await generateOpenAICompatibleImageResponse(req, body);
  res.json(responseJson);
}

async function handleGeminiNativeImage(req: Request, res: Response) {
  const params = req.body as GeminiNativeImageRequest;
  const selectedModel = req.params.model;
  const modelInfo = getRegisteredModel(selectedModel);
  if (!modelInfo || modelInfo.capability !== "image") {
    throw new HttpStatusError(400, `Model '${selectedModel}' is not an image generation model.`);
  }
  if (!isModelEnabled(selectedModel)) {
    throw new HttpStatusError(403, `Model '${selectedModel}' is disabled on this service.`);
  }
  if (params.response_format && params.response_format !== "b64_json") {
    throw new HttpStatusError(400, "This service only supports base64 image output.");
  }
  const prompt = params.prompt?.trim() || "Generate an image.";
  const imageInputs = [
    ...(typeof params.image === "string" ? [params.image] : []),
    ...(Array.isArray(params.images) ? params.images.filter((item): item is string => typeof item === "string" && item.length > 0) : []),
  ];
  const startTime = Date.now();
  let backend = pickBackend();
  if (!backend) throw new HttpStatusError(503, "No available backends - all sub-nodes are down and local fallback is disabled");
  const triedFriendUrls = new Set<string>();

  for (let attempt = 0; ; attempt++) {
    const backendLabel = backend.kind === "local" ? "local" : backend.label;
    try {
      let responseJson: Record<string, unknown>;
      if (backend.kind === "friend") {
        triedFriendUrls.add(backend.url);
        responseJson = await handleFriendJsonProxy({
          backend,
          path: `/v1beta/models/${selectedModel}:generateImages`,
          body: params,
        });
      } else {
        const result = await handleGeminiImage({
          model: selectedModel,
          prompt,
          imageInputs,
          n: params.n,
          size: params.size,
          nativeConfig: params.config,
          nativeContents: params.contents,
        });
        responseJson = {
          model: selectedModel,
          generatedImages: result.images.map((image) => ({
            image: {
              mimeType: image.mimeType,
              imageBytes: image.b64_json,
            },
          })),
        };
      }
      const duration = Date.now() - startTime;
      if (backend.kind === "friend") setHealth(backend.url, true);
      recordImageCallStat(backendLabel, duration, selectedModel);
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "image",
        backend: backendLabel,
        status: 200,
        duration,
        stream: false,
        level: "info",
      });
      res.json(responseJson);
      return;
    } catch (err) {
      const duration = Date.now() - startTime;
      if (backend.kind === "friend") {
        setHealth(backend.url, false);
        const status = err instanceof FriendProxyHttpError ? err.status : 502;
        if (!(err instanceof FriendProxyHttpError) || status >= 500) {
          backend = pickBackendExcluding(triedFriendUrls);
          if (backend && attempt < 3) continue;
        }
      }
      const status = err instanceof HttpStatusError
        ? err.status
        : err instanceof FriendProxyHttpError
          ? err.status
          : 500;
      const message = err instanceof Error ? err.message : "Unknown error";
      recordErrorStat(backend.kind === "local" ? "local" : backend.label);
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "image",
        backend: backend.kind === "local" ? "local" : backend.label,
        status,
        duration,
        stream: false,
        level: status >= 500 ? "error" : "warn",
        error: message,
      });
      if (err && typeof err === "object") (err as { __logged?: boolean }).__logged = true;
      throw err;
    }
  }
}

async function handleGeminiNativeGenerateContent(req: Request, res: Response) {
  const body = (req.body ?? {}) as GeminiNativeGenerateContentRequest;
  const selectedModel = getEnabledGeminiNativeChatModel(req.params.model);
  const startTime = Date.now();
  let backend = pickBackend();
  if (!backend) throw new HttpStatusError(503, "No available backends - all sub-nodes are down and local fallback is disabled");
  const triedFriendUrls = new Set<string>();

  for (let attempt = 0; ; attempt++) {
    const backendLabel = backend.kind === "local" ? "local" : backend.label;
    try {
      let responseJson: Record<string, unknown>;
      if (backend.kind === "friend") {
        triedFriendUrls.add(backend.url);
        responseJson = await handleFriendJsonProxy({
          backend,
          path: `/v1beta/models/${selectedModel}:generateContent`,
          body,
        });
      } else {
        const client = makeLocalGemini();
        responseJson = await (client.models as unknown as {
          generateContent: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }).generateContent(buildGeminiNativeGenerateArgs(selectedModel, body));
      }

      const duration = Date.now() - startTime;
      if (backend.kind === "friend") setHealth(backend.url, true);
      const usage = responseJson["usageMetadata"] as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      recordCallStat(
        backendLabel,
        duration,
        usage?.promptTokenCount ?? estimateGeminiNativeTokensFromContents(body.contents),
        usage?.candidatesTokenCount ?? 0,
        undefined,
        selectedModel,
      );
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "chat",
        backend: backendLabel,
        status: 200,
        duration,
        stream: false,
        promptTokens: usage?.promptTokenCount,
        completionTokens: usage?.candidatesTokenCount,
        level: "info",
      });
      res.json(responseJson);
      return;
    } catch (err) {
      const duration = Date.now() - startTime;
      if (backend.kind === "friend") {
        setHealth(backend.url, false);
        const status = err instanceof FriendProxyHttpError ? err.status : 502;
        if (!(err instanceof FriendProxyHttpError) || status >= 500) {
          backend = pickBackendExcluding(triedFriendUrls);
          if (backend && attempt < 3) continue;
        }
      }
      const status = err instanceof HttpStatusError
        ? err.status
        : err instanceof FriendProxyHttpError
          ? err.status
          : 500;
      const message = err instanceof Error ? err.message : "Unknown error";
      recordErrorStat(backend.kind === "local" ? "local" : backend.label);
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "chat",
        backend: backend.kind === "local" ? "local" : backend.label,
        status,
        duration,
        stream: false,
        level: status >= 500 ? "error" : "warn",
        error: message,
      });
      if (err && typeof err === "object") (err as { __logged?: boolean }).__logged = true;
      throw err;
    }
  }
}

async function handleGeminiNativeStreamGenerateContent(req: Request, res: Response) {
  const body = (req.body ?? {}) as GeminiNativeGenerateContentRequest;
  const selectedModel = getEnabledGeminiNativeChatModel(req.params.model);
  const startTime = Date.now();
  let backend = pickBackend();
  if (!backend) throw new HttpStatusError(503, "No available backends - all sub-nodes are down and local fallback is disabled");
  const triedFriendUrls = new Set<string>();

  for (let attempt = 0; ; attempt++) {
    const backendLabel = backend.kind === "local" ? "local" : backend.label;
    try {
      if (backend.kind === "friend") {
        triedFriendUrls.add(backend.url);
        await handleFriendSseProxy({
          backend,
          path: `/v1beta/models/${selectedModel}:streamGenerateContent`,
          body,
          res,
        });
      } else {
        const client = makeLocalGemini();
        const streamResponse = await (client.models as unknown as {
          generateContentStream: (args: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
        }).generateContentStream(buildGeminiNativeGenerateArgs(selectedModel, body));
        setSseHeaders(res);
        for await (const chunk of streamResponse) {
          writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.end();
      }

      const duration = Date.now() - startTime;
      if (backend.kind === "friend") setHealth(backend.url, true);
      recordCallStat(
        backendLabel,
        duration,
        estimateGeminiNativeTokensFromContents(body.contents),
        0,
        undefined,
        selectedModel,
      );
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "chat",
        backend: backendLabel,
        status: 200,
        duration,
        stream: true,
        level: "info",
      });
      return;
    } catch (err) {
      const duration = Date.now() - startTime;
      if (backend.kind === "friend") {
        setHealth(backend.url, false);
        const status = err instanceof FriendProxyHttpError ? err.status : 502;
        if (!(err instanceof FriendProxyHttpError) || status >= 500) {
          backend = pickBackendExcluding(triedFriendUrls);
          if (backend && attempt < 3 && !res.headersSent) continue;
        }
      }
      const status = err instanceof HttpStatusError
        ? err.status
        : err instanceof FriendProxyHttpError
          ? err.status
          : 500;
      const message = err instanceof Error ? err.message : "Unknown error";
      recordErrorStat(backend.kind === "local" ? "local" : backend.label);
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "chat",
        backend: backend.kind === "local" ? "local" : backend.label,
        status,
        duration,
        stream: true,
        level: status >= 500 ? "error" : "warn",
        error: message,
      });
      if (err && typeof err === "object") (err as { __logged?: boolean }).__logged = true;
      throw err;
    }
  }
}

async function handleGeminiNativeCountTokens(req: Request, res: Response) {
  const body = (req.body ?? {}) as GeminiNativeGenerateContentRequest;
  const selectedModel = getEnabledGeminiNativeChatModel(req.params.model);
  const startTime = Date.now();
  let backend = pickBackend();
  if (!backend) throw new HttpStatusError(503, "No available backends - all sub-nodes are down and local fallback is disabled");
  const triedFriendUrls = new Set<string>();

  for (let attempt = 0; ; attempt++) {
    const backendLabel = backend.kind === "local" ? "local" : backend.label;
    try {
      let responseJson: Record<string, unknown>;
      if (backend.kind === "friend") {
        triedFriendUrls.add(backend.url);
        responseJson = await handleFriendJsonProxy({
          backend,
          path: `/v1beta/models/${selectedModel}:countTokens`,
          body,
        });
      } else {
        const client = makeLocalGemini();
        const modelApi = client.models as unknown as Record<string, unknown>;
        const countTokens = modelApi["countTokens"];
        if (typeof countTokens === "function") {
          responseJson = await (countTokens as (args: Record<string, unknown>) => Promise<Record<string, unknown>>)({
            model: selectedModel,
            contents: body.contents ?? [],
          });
        } else {
          responseJson = { totalTokens: estimateGeminiNativeTokensFromContents(body.contents) };
        }
      }

      const duration = Date.now() - startTime;
      if (backend.kind === "friend") setHealth(backend.url, true);
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "chat",
        backend: backendLabel,
        status: 200,
        duration,
        stream: false,
        level: "info",
      });
      res.json(responseJson);
      return;
    } catch (err) {
      const duration = Date.now() - startTime;
      if (backend.kind === "friend") {
        setHealth(backend.url, false);
        const status = err instanceof FriendProxyHttpError ? err.status : 502;
        if (!(err instanceof FriendProxyHttpError) || status >= 500) {
          backend = pickBackendExcluding(triedFriendUrls);
          if (backend && attempt < 3) continue;
        }
      }
      const status = err instanceof HttpStatusError
        ? err.status
        : err instanceof FriendProxyHttpError
          ? err.status
          : 500;
      const message = err instanceof Error ? err.message : "Unknown error";
      recordErrorStat(backend.kind === "local" ? "local" : backend.label);
      pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        capability: "chat",
        backend: backend.kind === "local" ? "local" : backend.label,
        status,
        duration,
        stream: false,
        level: status >= 500 ? "error" : "warn",
        error: message,
      });
      if (err && typeof err === "object") (err as { __logged?: boolean }).__logged = true;
      throw err;
    }
  }
}

async function handleChatCompletions(req: Request, res: Response) {
  const { model, messages, stream, max_tokens, tools, tool_choice } = req.body as {
    model?: string;
    messages: OAIMessage[];
    stream?: boolean;
    max_tokens?: number;
    tools?: OAITool[];
    tool_choice?: unknown;
  };

  // Reject disabled models early
  if (model && !isModelEnabled(model)) {
    res.status(403).json({ error: { message: `Model '${model}' is disabled on this service`, type: "invalid_request_error", code: "model_disabled" } });
    return;
  }
  if (model && isImageModel(model)) {
    res.status(400).json({
      error: {
        message: `Model '${model}' is image-only. Use /v1/images/generations or /v1beta/models/${model}:generateImages instead.`,
        type: "invalid_request_error",
        code: "wrong_model_capability",
      },
    });
    return;
  }

  const selectedModel = model && isChatModel(model) ? model : "gpt-5.2";
  const provider = MODEL_REGISTRY.get(selectedModel)?.provider ?? "openai";
  const isClaudeModel = provider === "anthropic";
  const isGeminiModel = provider === "gemini";
  const isOpenRouterModel = provider === "openrouter";
  const shouldStream = stream ?? false;
  const startTime = Date.now();

  const finalMessages = (isClaudeModel && getSillyTavernMode() && !tools?.length)
    ? [...messages, { role: "user" as const, content: "继续" }]
    : messages;

  const MAX_FRIEND_RETRIES = 3;
  const triedFriendUrls = new Set<string>();
  let backend = pickBackend();
  if (!backend) { res.status(503).json({ error: { message: "No available backends - all sub-nodes are down and local fallback is disabled", type: "service_unavailable" } }); return; }

  for (let attempt = 0; ; attempt++) {
    const backendLabel = backend.kind === "local" ? "local" : backend.label;
    req.log.info({ model: selectedModel, backend: backendLabel, attempt, counter: requestCounter - 1, sillyTavern: isClaudeModel && getSillyTavernMode(), toolCount: tools?.length ?? 0 }, "Service request");

    try {
      let result: { promptTokens: number; completionTokens: number; ttftMs?: number };
      if (backend.kind === "friend") {
        triedFriendUrls.add(backend.url);
        result = await handleFriendProxy({ req, res, backend, model: selectedModel, messages: finalMessages, stream: shouldStream, maxTokens: max_tokens, tools, toolChoice: tool_choice, startTime });
      } else if (isClaudeModel) {
        const { actualModel, thinkingEnabled, resolvedMaxTokens } = resolveClaudeThinkingModel(selectedModel, max_tokens);
        const client = makeLocalAnthropic();
        result = await handleClaude({ req, res, client, model: actualModel, messages: finalMessages, stream: shouldStream, maxTokens: resolvedMaxTokens, thinking: thinkingEnabled, tools, toolChoice: tool_choice, startTime });
      } else if (isGeminiModel) {
        const thinkingEnabled = selectedModel.endsWith("-thinking");
        const actualModel = thinkingEnabled
          ? selectedModel.replace(/-thinking$/, "")
          : selectedModel;
        result = await handleGemini({ req, res, model: actualModel, messages: finalMessages, stream: shouldStream, maxTokens: max_tokens, thinking: thinkingEnabled, startTime });
      } else if (isOpenRouterModel) {
        const client = makeLocalOpenRouter();
        result = await handleOpenAI({ req, res, client, model: selectedModel, messages: finalMessages, stream: shouldStream, maxTokens: max_tokens, tools, toolChoice: tool_choice, startTime });
      } else {
        const actualModel = selectedModel.endsWith("-thinking")
          ? selectedModel.replace(/-thinking$/, "")
          : selectedModel;
        const client = makeLocalOpenAI();
        result = await handleOpenAI({ req, res, client, model: actualModel, messages: finalMessages, stream: shouldStream, maxTokens: max_tokens, tools, toolChoice: tool_choice, startTime });
      }
      // ✅ Success — record stats, mark friend healthy, and exit retry loop
      if (backend.kind === "friend") setHealth(backend.url, true);
      const duration = Date.now() - startTime;
      recordCallStat(backendLabel, duration, result.promptTokens, result.completionTokens, result.ttftMs, selectedModel);
      pushRequestLog({
        method: req.method, path: req.path, model: selectedModel,
        backend: backendLabel, status: 200, duration, stream: shouldStream,
        promptTokens: result.promptTokens, completionTokens: result.completionTokens,
        level: "info",
      });
      break;
    } catch (err: unknown) {
      // ❌ Failure — record error, decide whether to retry on a different node
      recordErrorStat(backendLabel);

      const is5xx = err instanceof FriendProxyHttpError && err.status >= 500;
      const errMsg = err instanceof Error ? err.message : "";
      const isNetworkErr = err instanceof TypeError
        || ["fetch", "aborted", "terminated", "closed", "upstream", "ECONNRESET", "socket hang up", "UND_ERR"]
          .some((kw) => errMsg.includes(kw));

      if (backend.kind === "friend" && (is5xx || isNetworkErr)) {
        setHealth(backend.url, false);
        req.log.warn({ url: backend.url, attempt, is5xx, isNetworkErr }, "Friend backend marked unhealthy, considering retry");

        if (attempt < MAX_FRIEND_RETRIES && !res.headersSent) {
          const next = pickBackendExcluding(triedFriendUrls);
          if (next?.kind === "friend") {
            backend = next;
            continue; // retry with next friend node
          }
        }
      }

      req.log.error({ err }, "Service request failed");
      const errStatus = (
        err instanceof FriendProxyHttpError
          ? err.status
          : err instanceof HttpStatusError
            ? err.status
            : undefined
      ) ?? 500;
      const errType = errStatus >= 500 ? "server_error" : "invalid_request_error";
      pushRequestLog({
        method: req.method, path: req.path, model: selectedModel,
        backend: backendLabel, status: errStatus, duration: Date.now() - startTime,
        stream: shouldStream, level: errStatus >= 500 ? "error" : "warn",
        error: errMsg || "Unknown error",
      });
      if (!res.headersSent) {
        res.status(errStatus).json({ error: { message: errMsg || "Unknown error", type: errType } });
      } else if (!res.writableEnded) {
        writeAndFlush(res, `data: ${JSON.stringify({ error: { message: errMsg || "Unknown error" } })}\n\n`);
        writeAndFlush(res, "data: [DONE]\n\n");
        res.end();
      }
      break;
    }
  }
}

for (const path of ["/v1/chat/completions", "/service/chat"]) {
  router.post(path, requireApiKey, handleChatCompletions);
}

router.post("/v1/images/generations", requireApiKey, async (req, res) => {
  try {
    await handleOpenAIImageGeneration(req, res);
  } catch (err) {
    sendApiError(req, res, err);
  }
});

router.post("/v1beta/models/:model/generateImages", requireApiKey, async (req, res) => {
  try {
    await handleGeminiNativeImage(req, res);
  } catch (err) {
    sendApiError(req, res, err);
  }
});

router.post(/^\/v1beta\/models\/([^:]+):generateImages$/, requireApiKey, async (req, res) => {
  try {
    req.params.model = req.params[0];
    await handleGeminiNativeImage(req, res);
  } catch (err) {
    sendApiError(req, res, err);
  }
});

router.post("/v1beta/models/:model/generateContent", requireApiKey, async (req, res) => {
  try {
    await handleGeminiNativeGenerateContent(req, res);
  } catch (err) {
    sendApiError(req, res, err);
  }
});

router.post(/^\/v1beta\/models\/([^:]+):generateContent$/, requireApiKey, async (req, res) => {
  try {
    req.params.model = req.params[0];
    await handleGeminiNativeGenerateContent(req, res);
  } catch (err) {
    sendApiError(req, res, err);
  }
});

router.post("/v1beta/models/:model/streamGenerateContent", requireApiKey, async (req, res) => {
  try {
    await handleGeminiNativeStreamGenerateContent(req, res);
  } catch (err) {
    sendApiError(req, res, err);
  }
});

router.post(/^\/v1beta\/models\/([^:]+):streamGenerateContent$/, requireApiKey, async (req, res) => {
  try {
    req.params.model = req.params[0];
    await handleGeminiNativeStreamGenerateContent(req, res);
  } catch (err) {
    sendApiError(req, res, err);
  }
});

router.post("/v1beta/models/:model/countTokens", requireApiKey, async (req, res) => {
  try {
    await handleGeminiNativeCountTokens(req, res);
  } catch (err) {
    sendApiError(req, res, err);
  }
});

router.post(/^\/v1beta\/models\/([^:]+):countTokens$/, requireApiKey, async (req, res) => {
  try {
    req.params.model = req.params[0];
    await handleGeminiNativeCountTokens(req, res);
  } catch (err) {
    sendApiError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Anthropic-native /v1/messages endpoint
// Accepts Anthropic API format directly (for clients like Cherry Studio, Claude.ai compatible tools)
// ---------------------------------------------------------------------------

async function handleAnthropicMessages(req: Request, res: Response) {
  const body = req.body as {
    model?: string;
    messages: AnthropicMessage[];
    system?: string | { type: string; text: string }[];
    stream?: boolean;
    max_tokens?: number;
    temperature?: number;
    thinking?: { type: "adaptive" } | { type: "enabled"; budget_tokens: number };
    [key: string]: unknown;
  };

  const { model, messages, system, stream, max_tokens, thinking, ...rest } = body;
  const selectedModel = model ?? "claude-sonnet-4-5";
  const { actualModel, thinkingEnabled, resolvedMaxTokens } = resolveClaudeThinkingModel(selectedModel, max_tokens);
  const effectiveThinking =
    thinking
    ?? (thinkingEnabled
      ? (
        CLAUDE_ADAPTIVE_THINKING_MODELS.has(actualModel)
          ? { type: "adaptive" as const }
          : { type: "enabled" as const, budget_tokens: Math.max(
            CLAUDE_MIN_THINKING_BUDGET,
            Math.min(CLAUDE_DEFAULT_THINKING_BUDGET, resolvedMaxTokens - 1),
          ) }
      )
      : undefined);
  const shouldStream = stream ?? false;
  const startTime = Date.now();

  req.log.info({ model: selectedModel, actualModel, stream: shouldStream, thinking: effectiveThinking }, "Anthropic /v1/messages request");

  try {
    if (thinkingEnabled && thinking) {
      throw new HttpStatusError(400, `Model alias '${selectedModel}' already implies thinking mode. Remove the explicit thinking parameter or use '${actualModel}'.`);
    }
    if (
      effectiveThinking
      && effectiveThinking.type === "enabled"
      && resolvedMaxTokens <= CLAUDE_MIN_THINKING_BUDGET
    ) {
      throw new HttpStatusError(
        400,
        `Thinking mode for '${actualModel}' requires max_tokens greater than ${CLAUDE_MIN_THINKING_BUDGET}. Received ${resolvedMaxTokens}.`,
      );
    }
    if (
      effectiveThinking
      && effectiveThinking.type === "enabled"
      && effectiveThinking.budget_tokens >= resolvedMaxTokens
    ) {
      throw new HttpStatusError(
        400,
        `Thinking mode for '${actualModel}' requires max_tokens greater than thinking.budget_tokens. Received max_tokens=${resolvedMaxTokens}.`,
      );
    }

    const client = makeLocalAnthropic();

    const createParams = {
      model: actualModel,
      max_tokens: resolvedMaxTokens,
      messages,
      ...(system ? { system } : {}),
      ...(effectiveThinking ? { thinking: effectiveThinking } : {}),
      ...rest,
    } as Parameters<typeof client.messages.create>[0];

    if (shouldStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const keepalive = setInterval(() => {
        if (!res.writableEnded) writeAndFlush(res, ": keepalive\n\n");
      }, 5000);
      req.on("close", () => clearInterval(keepalive));

      let inputTokens = 0;
      let outputTokens = 0;

      try {
        const claudeStream = client.messages.stream(createParams as Parameters<typeof client.messages.stream>[0]);

        for await (const event of claudeStream) {
          if (event.type === "message_start") {
            inputTokens = event.message.usage.input_tokens;
          } else if (event.type === "message_delta") {
            outputTokens = event.usage.output_tokens;
          }
          writeAndFlush(res, `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        writeAndFlush(res, "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
        res.end();
        const dur = Date.now() - startTime;
        recordCallStat("local", dur, inputTokens, outputTokens, undefined, selectedModel);
        pushRequestLog({
          method: req.method, path: req.path, model: selectedModel,
          backend: "local", status: 200, duration: dur, stream: true,
          promptTokens: inputTokens, completionTokens: outputTokens, level: "info",
        });
      } finally {
        clearInterval(keepalive);
      }
    } else {
      const result = await client.messages.create(createParams);
      const usage = (result as { usage?: { input_tokens?: number; output_tokens?: number } }).usage ?? {};
      const dur = Date.now() - startTime;
      recordCallStat("local", dur, usage.input_tokens ?? 0, usage.output_tokens ?? 0, undefined, selectedModel);
      pushRequestLog({
        method: req.method, path: req.path, model: selectedModel,
        backend: "local", status: 200, duration: dur, stream: false,
        promptTokens: usage.input_tokens ?? 0, completionTokens: usage.output_tokens ?? 0, level: "info",
      });
      res.json(result);
    }
  } catch (err: unknown) {
    recordErrorStat("local");
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof HttpStatusError ? err.statusCode : 500;
    req.log.error({ err }, "/v1/messages request failed");
    pushRequestLog({
      method: req.method, path: req.path, model: selectedModel,
      backend: "local", status, duration: Date.now() - startTime,
      stream: shouldStream, level: "error", error: errMsg,
    });
    if (!res.headersSent) {
      res.status(status).json({ error: { type: status >= 500 ? "server_error" : "invalid_request_error", message: errMsg } });
    } else {
      writeAndFlush(res, `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: status >= 500 ? "server_error" : "invalid_request_error", message: errMsg } })}\n\n`);
      res.end();
    }
  }
}

for (const path of ["/v1/messages", "/service/messages"]) {
  router.post(path, requireApiKey, handleAnthropicMessages);
}

// ---------------------------------------------------------------------------
// Real-time request log ring buffer + SSE
// ---------------------------------------------------------------------------

interface RequestLog {
  id: number;
  time: string;
  method: string;
  path: string;
  model?: string;
  capability?: ModelCapability;
  backend?: string;
  status: number;
  duration: number;
  stream: boolean;
  promptTokens?: number;
  completionTokens?: number;
  level: "info" | "warn" | "error";
  error?: string;
}

const REQUEST_LOG_MAX = 200;
const requestLogs: RequestLog[] = [];
let logIdCounter = 0;
const logSSEClients: Set<Response> = new Set();

export function pushRequestLog(entry: Omit<RequestLog, "id" | "time">): void {
  const log: RequestLog = { id: ++logIdCounter, time: new Date().toISOString(), ...entry };
  requestLogs.push(log);
  if (requestLogs.length > REQUEST_LOG_MAX) requestLogs.shift();
  const data = `data: ${JSON.stringify(log)}\n\n`;
  for (const client of logSSEClients) {
    try { client.write(data); } catch { logSSEClients.delete(client); }
  }
}

function sendLogs(_req: Request, res: Response) {
  res.json({ logs: requestLogs });
}

function streamLogs(req: Request, res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  logSSEClients.add(res);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 20000);
  req.on("close", () => { clearInterval(heartbeat); logSSEClients.delete(res); });
}

function sendMetrics(_req: Request, res: Response) {
  const allConfigs = getAllFriendProxyConfigs();
  const allLabels = ["local", ...allConfigs.map((c) => c.label)];
  const result: Record<string, unknown> = {};
  for (const label of allLabels) {
    const s = getStat(label);
    const cfg = allConfigs.find((c) => c.label === label);
    result[label] = {
      calls: s.calls,
      errors: s.errors,
      streamingCalls: s.streamingCalls,
      promptTokens: s.promptTokens,
      completionTokens: s.completionTokens,
      totalTokens: s.promptTokens + s.completionTokens,
      avgDurationMs: s.calls > 0 ? Math.round(s.totalDurationMs / s.calls) : 0,
      avgTtftMs: s.streamingCalls > 0 ? Math.round(s.totalTtftMs / s.streamingCalls) : null,
      health: label === "local" ? "healthy" : getCachedHealth(cfg?.url ?? "") === false ? "down" : "healthy",
      url: label === "local" ? null : cfg?.url ?? null,
      dynamic: dynamicBackends.some((d) => d.label === label),
      enabled: cfg ? cfg.enabled : true,
    };
  }
  const modelStats: Record<string, ModelStat> = Object.fromEntries(modelStatsMap.entries());
  res.json({ stats: result, modelStats, uptimeSeconds: Math.round(process.uptime()), routing: routingSettings });
}

function resetMetrics(_req: Request, res: Response) {
  statsMap.clear();
  modelStatsMap.clear();
  scheduleSave();
  res.json({ ok: true });
}

for (const path of ["/v1/admin/logs", "/service/logs"]) {
  router.get(path, requireApiKey, sendLogs);
}

for (const path of ["/v1/admin/logs/stream", "/service/logs/stream"]) {
  router.get(path, requireApiKeyWithQuery, streamLogs);
}

for (const path of ["/v1/stats", "/service/metrics"]) {
  router.get(path, requireApiKey, sendMetrics);
}

for (const path of ["/v1/admin/stats/reset", "/service/metrics/reset"]) {
  router.post(path, requireApiKey, resetMetrics);
}

// ---------------------------------------------------------------------------
// Admin: manage dynamic backends at runtime (no restart / redeploy required)
// ---------------------------------------------------------------------------

function listBackends(_req: Request, res: Response) {
  const apiKey = getServiceAccessKey() ?? "";
  const envConfigs = (() => {
    const list: { label: string; url: string }[] = [];
    const envKeys = ["FRIEND_PROXY_URL", ...Array.from({ length: 19 }, (_, i) => `FRIEND_PROXY_URL_${i + 2}`)];
    for (const key of envKeys) { const url = process.env[key]; if (url) list.push({ label: key.replace("FRIEND_PROXY_URL", "FRIEND"), url }); }
    return list;
  })();
  res.json({
    local: { url: null, source: "local" },
    env: envConfigs.map((c) => ({ ...c, source: "env", health: getCachedHealth(c.url) === false ? "down" : "healthy" })),
    dynamic: dynamicBackends.map((d) => ({ ...d, source: "dynamic", health: getCachedHealth(d.url) === false ? "down" : "healthy" })),
    apiKey,
  });
}

function createBackend(req: Request, res: Response) {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    res.status(400).json({ error: "Valid https URL required" });
    return;
  }
  const cleanUrl = url.replace(/\/+$/, "");
  const normalizedUrl = normalizeSubNodeUrl(cleanUrl);
  const allUrls = getFriendProxyConfigs().map((c) => c.url);
  if (allUrls.includes(normalizedUrl)) { res.status(409).json({ error: "URL already in pool" }); return; }
  const label = `DYNAMIC_${dynamicBackends.length + 1}`;
  dynamicBackends.push({ label, url: cleanUrl });
  saveDynamicBackends(dynamicBackends);
  const apiKey = getServiceAccessKey() ?? "";
  probeHealth(normalizedUrl, apiKey).then((ok) => setHealth(normalizedUrl, ok)).catch(() => setHealth(normalizedUrl, false));
  res.json({ label, url: cleanUrl, source: "dynamic" });
}

function deleteBackend(req: Request, res: Response) {
  const { label } = req.params;
  const before = dynamicBackends.length;
  dynamicBackends = dynamicBackends.filter((d) => d.label !== label);
  if (dynamicBackends.length === before) { res.status(404).json({ error: "Dynamic backend not found" }); return; }
  saveDynamicBackends(dynamicBackends);
  res.json({ deleted: true, label });
}

// PATCH /v1/admin/backends/:label — 切换单个节点启用/禁用
function updateBackend(req: Request, res: Response) {
  const { label } = req.params;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled (boolean) required" }); return; }
  const target = dynamicBackends.find((d) => d.label === label);
  if (!target) { res.status(404).json({ error: "Dynamic backend not found" }); return; }
  target.enabled = enabled;
  saveDynamicBackends(dynamicBackends);
  res.json({ label, enabled });
}

// PATCH /v1/admin/backends — 批量切换（labels 数组 + enabled 布尔值）
function batchUpdateBackends(req: Request, res: Response) {
  const { labels, enabled } = req.body as { labels?: string[]; enabled?: boolean };
  if (!Array.isArray(labels) || typeof enabled !== "boolean") {
    res.status(400).json({ error: "labels (string[]) and enabled (boolean) required" });
    return;
  }
  const set = new Set(labels);
  let updated = 0;
  for (const d of dynamicBackends) {
    if (set.has(d.label)) { d.enabled = enabled; updated++; }
  }
  saveDynamicBackends(dynamicBackends);
  res.json({ updated, enabled });
}

for (const path of ["/v1/admin/backends", "/service/backends"]) {
  router.get(path, requireApiKey, listBackends);
  router.post(path, requireApiKey, createBackend);
  router.patch(path, requireApiKey, batchUpdateBackends);
}

for (const path of ["/v1/admin/backends/:label", "/service/backends/:label"]) {
  router.delete(path, requireApiKey, deleteBackend);
  router.patch(path, requireApiKey, updateBackend);
}

function getRouting(_req: Request, res: Response) {
  res.json(routingSettings);
}

function updateRouting(req: Request, res: Response) {
  const { localEnabled, localFallback, fakeStream } = req.body as Partial<RoutingSettings>;
  if (typeof localEnabled === "boolean") routingSettings.localEnabled = localEnabled;
  if (typeof localFallback === "boolean") routingSettings.localFallback = localFallback;
  if (typeof fakeStream === "boolean") routingSettings.fakeStream = fakeStream;
  saveRoutingSettings();
  res.json(routingSettings);
}

for (const path of ["/v1/admin/routing", "/service/routing"]) {
  router.get(path, requireApiKey, getRouting);
  router.patch(path, requireApiKey, updateRouting);
}

// ---------------------------------------------------------------------------
// Admin: model enable/disable management
// ---------------------------------------------------------------------------

// GET /v1/admin/models — list all models with provider + enabled status
function listModels(_req: Request, res: Response) {
  const models = ALL_MODELS.map((m) => ({
    id: m.id,
    provider: MODEL_REGISTRY.get(m.id)?.provider ?? "openrouter",
    capability: MODEL_REGISTRY.get(m.id)?.capability ?? "chat",
    group: MODEL_REGISTRY.get(m.id)?.group ?? "openrouter",
    testMode: MODEL_REGISTRY.get(m.id)?.testMode ?? "chat",
    enabled: isModelEnabled(m.id),
  }));
  const summary: Record<string, { total: number; enabled: number }> = {};
  for (const m of models) {
    if (!summary[m.group]) summary[m.group] = { total: 0, enabled: 0 };
    summary[m.group].total++;
    if (m.enabled) summary[m.group].enabled++;
  }
  res.json({ models, summary });
}

// PATCH /v1/admin/models — bulk enable/disable by ids or by provider
// Body: { ids?: string[], provider?: string, enabled: boolean }
function updateModels(req: Request, res: Response) {
  const { ids, group, provider, enabled } = req.body as { ids?: string[]; group?: string; provider?: string; enabled?: boolean };
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled (boolean) required" }); return; }

  let targets: string[] = [];
  if (Array.isArray(ids) && ids.length > 0) {
    targets = ids.filter((id) => MODEL_REGISTRY.has(id));
  } else if (typeof group === "string") {
    targets = REGISTERED_MODELS.filter((model) => model.group === group).map((model) => model.id);
  } else if (typeof provider === "string") {
    targets = REGISTERED_MODELS.filter((model) => model.provider === provider).map((model) => model.id);
  } else {
    res.status(400).json({ error: "ids (string[]), group (string), or provider (string) required" }); return;
  }

  for (const id of targets) {
    if (enabled) disabledModels.delete(id);
    else disabledModels.add(id);
  }
  saveDisabledModels(disabledModels);
  res.json({ updated: targets.length, enabled, ids: targets });
}

for (const path of ["/v1/admin/models", "/service/models"]) {
  router.get(path, requireApiKeyWithQuery, listModels);
  router.patch(path, requireApiKey, updateModels);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// Distinguishes upstream HTTP errors (5xx) from network/timeout errors so the
// retry logic can make the right decision about whether to try another node.
class HttpStatusError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
  }
}

class FriendProxyHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "FriendProxyHttpError";
  }
}

function sendApiError(_req: Request, res: Response, err: unknown): void {
  const status = err instanceof HttpStatusError
    ? err.status
    : err instanceof FriendProxyHttpError
      ? err.status
      : 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  const alreadyLogged = !!(err as { __logged?: boolean } | null | undefined)?.__logged;
  if (!alreadyLogged) {
    recordErrorStat("local");
    pushRequestLog({
      method: _req.method,
      path: _req.path,
      status,
      duration: 0,
      stream: false,
      level: status >= 500 ? "error" : "warn",
      error: message,
    });
  }
  if (!res.headersSent) {
    res.status(status).json({
      error: {
        message,
        type: status >= 500 ? "server_error" : "invalid_request_error",
      },
    });
  }
}

// handleFriendProxy — raw fetch (bypasses SDK SSE parsing) so chunk.usage is
// captured reliably regardless of the friend proxy's SDK version or chunk format.
// SSE headers are committed only after the first chunk arrives, which preserves
// the retry window in case the upstream connection fails immediately.
async function handleFriendProxy({
  req, res, backend, model, messages, stream, maxTokens, tools, toolChoice, startTime,
}: {
  req: Request;
  res: Response;
  backend: Extract<Backend, { kind: "friend" }>;
  model: string;
  messages: OAIMessage[];
  stream: boolean;
  maxTokens?: number;
  tools?: OAITool[];
  toolChoice?: unknown;
  startTime: number;
}): Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number }> {
  const body: Record<string, unknown> = { model, messages, stream };
  body["max_tokens"] = maxTokens ?? 16000; // always override sub-node's potentially low default
  if (stream) body["stream_options"] = { include_usage: true };
  if (tools?.length) body["tools"] = tools;
  if (toolChoice !== undefined) body["tool_choice"] = toolChoice;

  // ── Non-streaming (or fake-stream when client wants stream but we call non-stream) ──
  if (!stream) {
    const fetchRes = await fetch(`${backend.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!fetchRes.ok) {
      const errText = await fetchRes.text().catch(() => "unknown");
      throw new FriendProxyHttpError(fetchRes.status, `Peer backend error ${fetchRes.status}: ${errText}`);
    }
    const json = await fetchRes.json() as Record<string, unknown>;
    res.json(json);
    const usage = json["usage"] as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
    if ((usage?.prompt_tokens ?? 0) === 0) {
      const inputChars = messages.reduce((acc, m) => {
        if (typeof m.content === "string") return acc + m.content.length;
        if (Array.isArray(m.content))
          return acc + (m.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === "text").reduce((a, p) => a + (p.text?.length ?? 0), 0);
        return acc;
      }, 0);
      const outputChars = (json["choices"] as Array<{ message?: { content?: string } }>)?.[0]?.message?.content?.length ?? 0;
      return { promptTokens: Math.ceil(inputChars / 4), completionTokens: Math.ceil(outputChars / 4) };
    }
    return { promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0 };
  }

  // ── Streaming ────────────────────────────────────────────────────────────
  const fetchRes = await fetch(`${backend.url}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });

  if (!fetchRes.ok) {
    const errText = await fetchRes.text().catch(() => "unknown");
    throw new FriendProxyHttpError(fetchRes.status, `Peer backend error ${fetchRes.status}: ${errText}`);
  }

  const contentType = fetchRes.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && routingSettings.fakeStream) {
    req.log.info("Friend returned JSON for stream request — fake-streaming");
    const json = await fetchRes.json() as Record<string, unknown>;
    const result = await fakeStreamResponse(res, json, startTime);
    if (result.promptTokens === 0) {
      const inputChars = messages.reduce((acc, m) => {
        if (typeof m.content === "string") return acc + m.content.length;
        if (Array.isArray(m.content))
          return acc + (m.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === "text").reduce((a, p) => a + (p.text?.length ?? 0), 0);
        return acc;
      }, 0);
      const outputContent = ((json["choices"] as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ?? "").length;
      return { promptTokens: Math.ceil(inputChars / 4), completionTokens: Math.ceil(outputContent / 4), ttftMs: result.ttftMs };
    }
    return result;
  }

  setSseHeaders(res);
  const keepaliveTimer = setInterval(() => writeAndFlush(res, ": keep-alive\n\n"), 15_000);

  let promptTokens = 0;
  let completionTokens = 0;
  let ttftMs: number | undefined;
  let outputChars = 0;

  try {

    const reader = fetchRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") { writeAndFlush(res, "data: [DONE]\n\n"); continue; }
          try {
            const chunk = JSON.parse(data) as Record<string, unknown>;
            // Capture usage from any chunk that carries it
            const usage = chunk["usage"] as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
            if (usage && typeof usage === "object") {
              promptTokens = usage.prompt_tokens ?? promptTokens;
              completionTokens = usage.completion_tokens ?? completionTokens;
            }
            // Record TTFT + accumulate output chars for fallback estimation
            const deltaContent = (chunk["choices"] as Array<{ delta?: { content?: string } }>)?.[0]?.delta?.content;
            if (deltaContent) {
              if (ttftMs === undefined) ttftMs = Date.now() - startTime;
              outputChars += deltaContent.length;
            }
            writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
          } catch { /* skip malformed chunk */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearInterval(keepaliveTimer);
  }

  res.end();

  // Fallback: estimate tokens from char count when sub-node didn't return usage
  if (promptTokens === 0) {
    const inputChars = messages.reduce((acc, m) => {
      if (typeof m.content === "string") return acc + m.content.length;
      if (Array.isArray(m.content))
        return acc + (m.content as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === "text").reduce((a, p) => a + (p.text?.length ?? 0), 0);
      return acc;
    }, 0);
    promptTokens = Math.ceil(inputChars / 4);
    completionTokens = Math.ceil(outputChars / 4);
  }

  return { promptTokens, completionTokens, ttftMs };
}

async function handleOpenAI({
  req, res, client, model, messages, stream, maxTokens, tools, toolChoice, startTime,
}: {
  req: Request;
  res: Response;
  client: OpenAI;
  model: string;
  messages: OAIMessage[];
  stream: boolean;
  maxTokens?: number;
  tools?: OAITool[];
  toolChoice?: unknown;
  startTime: number;
}): Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number }> {
  const params: Parameters<typeof client.chat.completions.create>[0] = {
    model,
    messages: messages as Parameters<typeof client.chat.completions.create>[0]["messages"],
    stream,
  };
  if (maxTokens) (params as Record<string, unknown>)["max_completion_tokens"] = maxTokens;
  if (tools?.length) (params as Record<string, unknown>)["tools"] = tools;
  if (toolChoice !== undefined) (params as Record<string, unknown>)["tool_choice"] = toolChoice;

  if (stream) {
    try {
      setSseHeaders(res);
      let ttftMs: number | undefined;
      let promptTokens = 0;
      let completionTokens = 0;
      const streamResult = await client.chat.completions.create({
        ...params,
        stream: true,
        stream_options: { include_usage: true },
      });
      for await (const chunk of streamResult) {
        if (ttftMs === undefined && (chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.delta?.tool_calls)) {
          ttftMs = Date.now() - startTime;
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? 0;
          completionTokens = chunk.usage.completion_tokens ?? 0;
        }
        writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
      }
      writeAndFlush(res, "data: [DONE]\n\n");
      res.end();
      return { promptTokens, completionTokens, ttftMs };
    } catch (streamErr) {
      if (res.headersSent || !routingSettings.fakeStream) throw streamErr;
      req.log.warn({ err: streamErr }, "Real streaming failed, falling back to fake-stream");
      const result = await client.chat.completions.create({ ...params, stream: false });
      return fakeStreamResponse(res, result as unknown as Record<string, unknown>, startTime);
    }
  } else {
    const result = await client.chat.completions.create({ ...params, stream: false });
    res.json(result);
    return {
      promptTokens: result.usage?.prompt_tokens ?? 0,
      completionTokens: result.usage?.completion_tokens ?? 0,
    };
  }
}

async function handleGemini({
  req, res, model, messages, stream, maxTokens, thinking = false, startTime,
}: {
  req: Request;
  res: Response;
  model: string;
  messages: OAIMessage[];
  stream: boolean;
  maxTokens?: number;
  thinking?: boolean;
  startTime: number;
}): Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number }> {
  const client = makeLocalGemini();

  let systemInstruction: string | undefined;
  const contents: { role: string; parts: { text: string }[] }[] = [];

  for (const msg of messages) {
    const textContent = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.filter((p: OAIContentPart) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join("\n")
        : "";
    if (msg.role === "system") {
      systemInstruction = systemInstruction ? `${systemInstruction}\n${textContent}` : textContent;
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: textContent || " " }],
      });
    }
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: " " }] });
  }

  const config: Record<string, unknown> = {};
  if (maxTokens) config.maxOutputTokens = maxTokens;
  if (thinking) {
    config.thinkingConfig = {
      thinkingBudget: maxTokens ? Math.min(maxTokens, 32768) : 16384,
      includeThoughts: true,
    };
  }

  if (stream) {
    try {
      setSseHeaders(res);
      let ttftMs: number | undefined;
      let promptTokens = 0;
      let completionTokens = 0;
      const chatId = `chatcmpl-${Date.now()}`;

      const response = await client.models.generateContentStream({
        model,
        contents,
        config: {
          ...config,
          ...(systemInstruction ? { systemInstruction } : {}),
        },
      });

      for await (const chunk of response) {
        const { text, reasoning } = extractGeminiTextAndReasoning(chunk);
        if (ttftMs === undefined && (text || reasoning)) {
          ttftMs = Date.now() - startTime;
        }
        if (chunk.usageMetadata) {
          promptTokens = chunk.usageMetadata.promptTokenCount ?? 0;
          completionTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
        }
        if (reasoning) {
          const reasoningChunk = {
            id: chatId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
              index: 0,
              delta: buildReasoningFields(reasoning),
              finish_reason: null,
            }],
          };
          writeAndFlush(res, `data: ${JSON.stringify(reasoningChunk)}\n\n`);
        }
        if (text) {
          const oaiChunk = {
            id: chatId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
              index: 0,
              delta: { content: text },
              finish_reason: chunk.candidates?.[0]?.finishReason === "STOP" ? "stop" : null,
            }],
          };
          writeAndFlush(res, `data: ${JSON.stringify(oaiChunk)}\n\n`);
        }
      }

      writeAndFlush(res, "data: [DONE]\n\n");
      res.end();
      return { promptTokens, completionTokens, ttftMs };
    } catch (streamErr) {
      if (res.headersSent || !routingSettings.fakeStream) throw streamErr;
      req.log.warn({ err: streamErr }, "Gemini streaming failed, falling back to fake-stream");
      const response = await client.models.generateContent({
        model, contents,
        config: { ...config, ...(systemInstruction ? { systemInstruction } : {}) },
      });
      const { text, reasoning } = extractGeminiTextAndReasoning(response);
      const pTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const cTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
      const json = {
        id: `chatcmpl-${Date.now()}`, object: "chat.completion",
        created: Math.floor(Date.now() / 1000), model,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: text || null,
            ...(reasoning ? buildReasoningFields(reasoning) : {}),
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: pTokens, completion_tokens: cTokens, total_tokens: pTokens + cTokens },
      };
      return fakeStreamResponse(res, json as unknown as Record<string, unknown>, startTime);
    }
  } else {
    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        ...config,
        ...(systemInstruction ? { systemInstruction } : {}),
      },
    });

    const { text, reasoning } = extractGeminiTextAndReasoning(response);
    const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(reasoning ? buildReasoningFields(reasoning) : {}),
        },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    });
    return { promptTokens, completionTokens };
  }
}

async function handleClaude({
  req, res, client, model, messages, stream, maxTokens, thinking = false, tools, toolChoice, startTime,
}: {
  req: Request;
  res: Response;
  client: Anthropic;
  model: string;
  messages: OAIMessage[];
  stream: boolean;
  maxTokens: number;
  thinking?: boolean;
  tools?: OAITool[];
  toolChoice?: unknown;
  startTime: number;
}): Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number }> {
  // Extract system prompt
  const systemMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : (m.content as OAIContentPart[]).map((p) => (p.type === "text" ? (p as { type: "text"; text: string }).text : "")).join("")))
    .join("\n");

  // Convert all messages including tool_calls / tool roles
  const chatMessages = convertMessagesForClaude(messages);

  let thinkingParam:
    | {}
    | { thinking: { type: "adaptive" } }
    | { thinking: { type: "enabled"; budget_tokens: number } } = {};

  if (thinking) {
    if (CLAUDE_ADAPTIVE_THINKING_MODELS.has(model)) {
      thinkingParam = { thinking: { type: "adaptive" } };
    } else {
      if (maxTokens <= CLAUDE_MIN_THINKING_BUDGET) {
        throw new HttpStatusError(
          400,
          `Thinking mode for '${model}' requires max_tokens greater than ${CLAUDE_MIN_THINKING_BUDGET}. Received ${maxTokens}.`,
        );
      }

      const budgetTokens = Math.max(
        CLAUDE_MIN_THINKING_BUDGET,
        Math.min(CLAUDE_DEFAULT_THINKING_BUDGET, maxTokens - 1),
      );

      if (budgetTokens >= maxTokens) {
        throw new HttpStatusError(
          400,
          `Thinking mode for '${model}' requires max_tokens greater than thinking.budget_tokens. Received max_tokens=${maxTokens}.`,
        );
      }

      thinkingParam = {
        thinking: { type: "enabled", budget_tokens: budgetTokens },
      };
    }
  }

  // Convert tools to Anthropic format
  const anthropicTools = tools?.length ? convertToolsForClaude(tools) : undefined;
  // Convert tool_choice
  let anthropicToolChoice: unknown;
  if (toolChoice !== undefined && anthropicTools?.length) {
    if (toolChoice === "auto") anthropicToolChoice = { type: "auto" };
    else if (toolChoice === "none") anthropicToolChoice = { type: "none" };
    else if (toolChoice === "required") anthropicToolChoice = { type: "any" };
    else if (typeof toolChoice === "object" && (toolChoice as Record<string, unknown>).type === "function") {
      anthropicToolChoice = { type: "tool", name: ((toolChoice as Record<string, unknown>).function as Record<string, unknown>).name };
    }
  }

  if (
    thinking
    && anthropicToolChoice
    && typeof anthropicToolChoice === "object"
    && (anthropicToolChoice as { type?: string }).type
    && ["any", "tool"].includes((anthropicToolChoice as { type?: string }).type!)
  ) {
    throw new HttpStatusError(
      400,
      "Claude thinking mode only supports tool_choice values of 'auto' or 'none'.",
    );
  }

  const buildCreateParams = () => ({
    model,
    max_tokens: maxTokens,
    ...(systemMessages ? { system: systemMessages } : {}),
    ...thinkingParam,
    messages: chatMessages,
    ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
  });

  const msgId = `msg_${Date.now()}`;

  if (stream) {
    setSseHeaders(res);
    const keepalive = setInterval(() => {
      if (!res.writableEnded) writeAndFlush(res, ": keepalive\n\n");
    }, 5000);
    req.on("close", () => clearInterval(keepalive));

    try {
      const claudeStream = client.messages.stream(buildCreateParams() as Parameters<typeof client.messages.stream>[0]);

      let inputTokens = 0;
      let outputTokens = 0;
      let ttftMs: number | undefined;
      // Track current tool_use block index for streaming
      let currentToolIndex = -1;
      const toolIndexMap = new Map<number, number>(); // content_block index → tool_calls array index
      let toolCallCount = 0;

      for await (const event of claudeStream) {
        if (event.type === "message_start") {
          inputTokens = event.message.usage.input_tokens;
          writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`);

        } else if (event.type === "content_block_start") {
          const block = event.content_block;

          if (block.type === "thinking") {
            continue;
          } else if (block.type === "tool_use") {
            // Map this content block index to tool_calls array index
            currentToolIndex = toolCallCount++;
            toolIndexMap.set(event.index, currentToolIndex);
            if (ttftMs === undefined) ttftMs = Date.now() - startTime;
            // Send tool_call start chunk
            writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { tool_calls: [{ index: currentToolIndex, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] }, finish_reason: null }] })}\n\n`);
          } else if (block.type === "text") {
            continue;
          }

        } else if (event.type === "content_block_delta") {
          const delta = event.delta;

          if (delta.type === "thinking_delta") {
            const cleaned = sanitizeThinkingText(delta.thinking);
            if (cleaned) writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: buildReasoningFields(cleaned), finish_reason: null }] })}\n\n`);
          } else if (delta.type === "text_delta") {
            if (ttftMs === undefined) ttftMs = Date.now() - startTime;
            writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }] })}\n\n`);
          } else if (delta.type === "input_json_delta") {
            // Tool argument streaming
            const toolIdx = toolIndexMap.get(event.index) ?? currentToolIndex;
            writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { tool_calls: [{ index: toolIdx, function: { arguments: delta.partial_json } }] }, finish_reason: null }] })}\n\n`);
          }

        } else if (event.type === "message_delta") {
          outputTokens = event.usage.output_tokens;
          const stopReason = event.delta.stop_reason;
          const finishReason = stopReason === "tool_use" ? "tool_calls" : (stopReason ?? "stop");
          writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens } })}\n\n`);
        }
      }

      writeAndFlush(res, "data: [DONE]\n\n");
      res.end();
      return { promptTokens: inputTokens, completionTokens: outputTokens, ttftMs };
    } finally {
      clearInterval(keepalive);
    }

  } else {
    // Non-streaming — some models (e.g. claude-opus-4) require streaming;
    // detect the error and transparently upgrade to stream + collect.
    let result: Anthropic.Message;
    try {
      result = await client.messages.create(buildCreateParams() as Parameters<typeof client.messages.create>[0]);
    } catch (nonStreamErr: unknown) {
      const errMsg = nonStreamErr instanceof Error ? nonStreamErr.message : String(nonStreamErr);
      if (/streaming.*required|requires.*stream/i.test(errMsg)) {
        req.log.warn("Claude model requires streaming — upgrading to stream+collect for non-stream request");
        const claudeStream = client.messages.stream(buildCreateParams() as Parameters<typeof client.messages.stream>[0]);
        const collected = await claudeStream.finalMessage();
        result = collected;
      } else {
        throw nonStreamErr;
      }
    }

    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    const toolCalls: OAIToolCall[] = [];

    for (const block of result.content) {
      if (block.type === "thinking") {
        const rawThinking = sanitizeThinkingText((block as { type: "thinking"; thinking: string }).thinking);
        if (rawThinking) reasoningParts.push(rawThinking);
      } else if (block.type === "text") {
        textParts.push((block as { type: "text"; text: string }).text);
      } else if (block.type === "tool_use") {
        const toolBlock = block as { type: "tool_use"; id: string; name: string; input: unknown };
        toolCalls.push({
          id: toolBlock.id,
          type: "function",
          function: {
            name: toolBlock.name,
            arguments: JSON.stringify(toolBlock.input),
          },
        });
      }
    }

    const text = textParts.join("\n\n");
    const reasoningText = reasoningParts.join("\n\n");
    const stopReason = result.stop_reason;
    const finishReason = stopReason === "tool_use" ? "tool_calls" : (stopReason ?? "stop");

    res.json({
      id: result.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(reasoningText ? buildReasoningFields(reasoningText) : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      }],
      usage: {
        prompt_tokens: result.usage.input_tokens,
        completion_tokens: result.usage.output_tokens,
        total_tokens: result.usage.input_tokens + result.usage.output_tokens,
      },
    });
    return { promptTokens: result.usage.input_tokens, completionTokens: result.usage.output_tokens };
  }
}

export default router;
