import { Router, type IRouter, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { createAdminRouter } from "./admin";
import { createAnthropicRouter, handleClaude } from "./anthropic";
import catalogRouter from "./catalog";
import { createChatRouter } from "./chat";
import { createGeminiRouter } from "./gemini";
import { createImagesRouter } from "./images";
import {
  getRequestCounter,
  getRoutingSettings,
  initReady as backendPoolReady,
  pickBackend,
  pickBackendExcluding,
  setHealth,
} from "../services/backendPool";
import { handleFriendChatProxy } from "../services/friendProxy";
import {
  MODEL_REGISTRY,
  type ModelCapability,
  getRegisteredModel,
  hasRegisteredModel,
  isChatModel,
  isImageModel,
  isModelEnabled,
  modelRegistryReady,
  resolveClaudeThinkingModel,
} from "../services/modelRegistry";
import { pushRequestLog } from "../services/requestLogs";
import { FriendProxyHttpError, HttpStatusError, setSseHeaders, writeAndFlush } from "../services/routeSupport";
import { createStatsTracker } from "../services/stats";
import { type CacheTokenStats } from "../services/stats";
import { getPromptCacheSettings, getSillyTavernMode } from "./settings";

const router: IRouter = Router();
router.use(catalogRouter);

const {
  statsReady,
  getStat,
  getModelStatsObject,
  recordCallStat,
  recordImageCallStat,
  recordErrorStat,
  clearStats,
} = createStatsTracker((model) => MODEL_REGISTRY.get(model)?.capability ?? "chat");
router.use(createAdminRouter({ clearStats, getModelStatsObject, getStat }));

export const initReady: Promise<void> = (async () => {
  await Promise.all([backendPoolReady, modelRegistryReady]);
})();

export { statsReady };

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

function sanitizeThinkingText(raw: string): string {
  return raw.replace(/<\/?think>/g, "");
}

function buildReasoningFields(reasoning: string): { reasoning: string; reasoning_content: string } {
  return {
    reasoning,
    reasoning_content: reasoning,
  };
}

function estimateTokensFromValue(value: unknown): number {
  const visited = new Set<unknown>();

  const walk = (current: unknown): number => {
    if (current === null || current === undefined) return 0;
    if (typeof current === "string") return current.length;
    if (typeof current === "number" || typeof current === "boolean") return String(current).length;
    if (typeof current !== "object") return 0;
    if (visited.has(current)) return 0;
    visited.add(current);

    if (Array.isArray(current)) return current.reduce<number>((sum, item) => sum + walk(item), 0);

    return Object.values(current as Record<string, unknown>).reduce<number>((sum, item) => sum + walk(item), 0);
  };

  return Math.max(1, Math.ceil(walk(value) / 4));
}

function estimateTokensFromChars(chars: number): number {
  return chars > 0 ? Math.ceil(chars / 4) : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

function sumGeminiBillableOutputTokens(usage: {
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
} | undefined): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;

  let total = 0;
  let hasValue = false;

  if (typeof usage.candidatesTokenCount === "number") {
    total += usage.candidatesTokenCount;
    hasValue = true;
  }
  if (typeof usage.thoughtsTokenCount === "number") {
    total += usage.thoughtsTokenCount;
    hasValue = true;
  }

  return hasValue ? total : undefined;
}

function extractGeminiTextAndReasoning(source: unknown): { text: string; reasoning: string } {
  const candidates = asRecordArray(asRecord(source)?.["candidates"]);
  const content = asRecord(candidates[0]?.["content"]);
  const parts = asRecordArray(content?.["parts"]);
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

function cacheStatsFromOpenAIUsage(usage: unknown): CacheTokenStats {
  if (!usage || typeof usage !== "object") return {};
  const details = (usage as Record<string, unknown>)["prompt_tokens_details"];
  if (!details || typeof details !== "object") return {};
  return {
    cacheReadTokens: Number((details as Record<string, unknown>)["cached_tokens"]) || 0,
  };
}

async function fakeStreamResponse(
  res: Response,
  json: Record<string, unknown>,
  startTime: number,
): Promise<{ promptTokens: number; completionTokens: number; ttftMs: number; cache?: CacheTokenStats }> {
  const id = (json["id"] as string) ?? `chatcmpl-fake-${Date.now()}`;
  const model = (json["model"] as string) ?? "unknown";
  const created = (json["created"] as number) ?? Math.floor(Date.now() / 1000);
  const choices = asRecordArray(json["choices"]);
  const usage = json["usage"] as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  setSseHeaders(res);

  const roleChunk = {
    id, object: "chat.completion.chunk", created, model,
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
  };
  writeAndFlush(res, `data: ${JSON.stringify(roleChunk)}\n\n`);
  const ttftMs = Date.now() - startTime;

  const message = asRecord(choices[0]?.["message"]);
  const fullContent = typeof message?.["content"] === "string" ? message["content"] : "";
  const fullReasoning = (typeof message?.["reasoning_content"] === "string" ? message["reasoning_content"] : undefined)
    ?? (typeof message?.["reasoning"] === "string" ? message["reasoning"] : undefined)
    ?? "";
  const toolCalls = message?.["tool_calls"];

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
    cache: cacheStatsFromOpenAIUsage(usage),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

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
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

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

router.use(createImagesRouter({
  getLocalOpenAIConfig,
  makeLocalGemini,
  pickBackend,
  pickBackendExcluding,
  setHealth,
  hasRegisteredModel,
  getRegisteredModel,
  isModelEnabled,
  recordImageCallStat,
  recordErrorStat,
  pushRequestLog,
  sendApiError,
}));

router.use(createGeminiRouter({
  makeLocalGemini,
  pickBackend,
  pickBackendExcluding,
  setHealth,
  recordCallStat,
  recordErrorStat,
  pushRequestLog,
  sendApiError,
}));

router.use(createAnthropicRouter({
  makeLocalAnthropic,
  getPromptCacheSettings,
  recordCallStat,
  recordErrorStat,
  pushRequestLog,
}));

router.use(createChatRouter({
  pickBackend,
  pickBackendExcluding,
  setHealth,
  getRequestCounter,
  getProviderForModel: (id) => MODEL_REGISTRY.get(id)?.provider ?? "openai",
  isChatModel,
  isImageModel,
  isModelEnabled,
  resolveClaudeThinkingModel,
  getSillyTavernMode,
  getPromptCacheSettings,
  makeLocalAnthropic,
  makeLocalOpenAI,
  makeLocalOpenRouter,
  handleFriendProxy: (args) => handleFriendChatProxy({
    req: { log: { info: (message: string) => args.req.log.info(message) } },
    res: args.res,
    backend: args.backend,
    model: args.model,
    messages: args.messages.map((message) => ({ content: message.content })),
    stream: args.stream,
    maxTokens: args.maxTokens,
    tools: args.tools,
    toolChoice: args.toolChoice,
    startTime: args.startTime,
    fakeStreamEnabled: getRoutingSettings().fakeStream,
    fakeStreamResponse,
  }),
  handleOpenAI,
  handleGemini,
  handleClaude,
  isFriendProxyHttpError: (err): err is FriendProxyHttpError => err instanceof FriendProxyHttpError,
  isHttpStatusError: (err): err is { status: number } => err instanceof HttpStatusError,
  writeAndFlush,
  recordCallStat,
  recordErrorStat,
  pushRequestLog,
}));

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
}): Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number; cache?: CacheTokenStats }> {
  const params: Parameters<typeof client.chat.completions.create>[0] = {
    model,
    messages: messages as Parameters<typeof client.chat.completions.create>[0]["messages"],
    stream,
  };
  if (maxTokens) (params as unknown as Record<string, unknown>)["max_completion_tokens"] = maxTokens;
  if (tools?.length) (params as unknown as Record<string, unknown>)["tools"] = tools;
  if (toolChoice !== undefined) (params as unknown as Record<string, unknown>)["tool_choice"] = toolChoice;

  if (stream) {
    try {
      setSseHeaders(res);
      let ttftMs: number | undefined;
      let promptTokens = 0;
      let completionTokens = 0;
      let cache: CacheTokenStats = {};
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
          cache = cacheStatsFromOpenAIUsage(chunk.usage);
        }
        writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
      }
      writeAndFlush(res, "data: [DONE]\n\n");
      res.end();
      return { promptTokens, completionTokens, ttftMs, cache };
    } catch (streamErr) {
      if (res.headersSent || !getRoutingSettings().fakeStream) throw streamErr;
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
      cache: cacheStatsFromOpenAIUsage(result.usage),
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
      let outputChars = 0;
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
          promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
          completionTokens = sumGeminiBillableOutputTokens(chunk.usageMetadata) ?? completionTokens;
        }
        outputChars += text.length + reasoning.length;
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
      if (promptTokens === 0) promptTokens = estimateTokensFromValue({ contents, systemInstruction });
      if (completionTokens === 0) completionTokens = estimateTokensFromChars(outputChars);
      return { promptTokens, completionTokens, ttftMs };
    } catch (streamErr) {
      if (res.headersSent || !getRoutingSettings().fakeStream) throw streamErr;
      req.log.warn({ err: streamErr }, "Gemini streaming failed, falling back to fake-stream");
      const response = await client.models.generateContent({
        model, contents,
        config: { ...config, ...(systemInstruction ? { systemInstruction } : {}) },
      });
      const { text, reasoning } = extractGeminiTextAndReasoning(response);
      const pTokens = response.usageMetadata?.promptTokenCount ?? estimateTokensFromValue({ contents, systemInstruction });
      const cTokens = sumGeminiBillableOutputTokens(response.usageMetadata) ?? estimateTokensFromChars(text.length + reasoning.length);
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
    const promptTokens = response.usageMetadata?.promptTokenCount ?? estimateTokensFromValue({ contents, systemInstruction });
    const completionTokens = sumGeminiBillableOutputTokens(response.usageMetadata) ?? estimateTokensFromChars(text.length + reasoning.length);

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

export default router;
