import { Router, type IRouter, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { createAdminRouter } from "./admin";
import catalogRouter from "./catalog";
import { requireApiKey } from "../middleware/auth";
import {
  type Backend,
  getRoutingSettings,
  initReady as backendPoolReady,
  pickBackend,
  pickBackendExcluding,
  setHealth,
} from "../services/backendPool";
import {
  CLAUDE_ADAPTIVE_THINKING_MODELS,
  CLAUDE_DEFAULT_THINKING_BUDGET,
  CLAUDE_MIN_THINKING_BUDGET,
  GEMINI_BASE_MODELS,
  MODEL_REGISTRY,
  type ModelCapability,
  getRegisteredModel,
  hasRegisteredModel,
  isChatModel,
  isImageModel,
  isModelEnabled,
  modelRegistryReady,
  normalizeClaudeThinkingDisplay,
  resolveClaudeThinkingModel,
  shouldForceClaudeSummarizedThinking,
} from "../services/modelRegistry";
import { pushRequestLog } from "../services/requestLogs";
import { createStatsTracker } from "../services/stats";
import { getSillyTavernMode } from "./settings";

const router: IRouter = Router();
router.use(catalogRouter);

const ANTHROPIC_NATIVE_TOOL_TYPE_ALIASES: Record<string, string> = {
  web_search_20260209: "web_search_20250305",
};

function sanitizeAnthropicNativeValue(value: unknown): unknown {
  if (value === "[undefined]") return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeAnthropicNativeValue(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(source)) {
      const cleaned = sanitizeAnthropicNativeValue(raw);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    if (typeof result.type === "string" && ANTHROPIC_NATIVE_TOOL_TYPE_ALIASES[result.type]) {
      result.type = ANTHROPIC_NATIVE_TOOL_TYPE_ALIASES[result.type];
    }
    return result;
  }
  return value;
}

function sanitizeAnthropicNativeMessages(messages: unknown): AnthropicMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return null;
      const entry = message as Record<string, unknown>;
      const role = entry.role === "assistant" ? "assistant" : "user";
      const content = entry.content;

      if (typeof content === "string") {
        return { role, content };
      }

      if (!Array.isArray(content)) {
        return { role, content: "" };
      }

      const filteredContent = content.filter((part) => {
        if (!part || typeof part !== "object") return false;
        const item = part as Record<string, unknown>;
        const type = typeof item.type === "string" ? item.type : "";
        if ((type === "thinking" || type === "redacted_thinking") && typeof item.signature !== "string") {
          return false;
        }
        return true;
      }) as AnthropicContentPart[];

      return {
        role,
        content: filteredContent,
      };
    })
    .filter((message): message is AnthropicMessage => message !== null);
}

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
  if (body.model && !hasRegisteredModel(body.model)) {
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
  const rawBody = sanitizeAnthropicNativeValue(req.body) as {
    model?: string;
    messages: unknown;
    system?: string | { type: string; text: string }[];
    stream?: boolean;
    max_tokens?: number;
    temperature?: number;
    thinking?:
      | { type: "adaptive"; display?: "summarized" | "omitted" }
      | { type: "enabled"; budget_tokens: number; display?: "summarized" | "omitted" };
    [key: string]: unknown;
  };
  const body = {
    ...rawBody,
    messages: sanitizeAnthropicNativeMessages(rawBody.messages),
  };

  const { model, messages, system, stream, max_tokens, thinking, ...rest } = body;
  const selectedModel = model ?? "claude-sonnet-4-5";
  const { actualModel, thinkingEnabled, resolvedMaxTokens } = resolveClaudeThinkingModel(selectedModel, max_tokens);
  const effectiveThinking = (
    thinking
    ?? (thinkingEnabled
      ? (
        CLAUDE_ADAPTIVE_THINKING_MODELS.has(actualModel)
          ? {
            type: "adaptive" as const,
            ...(shouldForceClaudeSummarizedThinking(actualModel) ? { display: "summarized" as const } : {}),
          }
          : { type: "enabled" as const, budget_tokens: Math.max(
            CLAUDE_MIN_THINKING_BUDGET,
            Math.min(CLAUDE_DEFAULT_THINKING_BUDGET, resolvedMaxTokens - 1),
          ), ...(shouldForceClaudeSummarizedThinking(actualModel) ? { display: "summarized" as const } : {}) }
      )
      : undefined)
  );
  const normalizedThinking = effectiveThinking
    ? normalizeClaudeThinkingDisplay(actualModel, effectiveThinking)
    : undefined;
  const shouldStream = stream ?? false;
  const startTime = Date.now();

  req.log.info({ model: selectedModel, actualModel, stream: shouldStream, thinking: normalizedThinking }, "Anthropic /v1/messages request");

  try {
    // If the model alias implies thinking AND the client also sent an explicit
    // thinking parameter, just log a note and let the client's value win
    // (effectiveThinking already prefers the client-supplied value).
    if (thinkingEnabled && thinking) {
      req.log.info({ model: selectedModel, actualModel }, "Model alias implies thinking; client also sent explicit thinking param — using client value");
    }
    if (
      normalizedThinking
      && normalizedThinking.type === "enabled"
      && resolvedMaxTokens <= CLAUDE_MIN_THINKING_BUDGET
    ) {
      throw new HttpStatusError(
        400,
        `Thinking mode for '${actualModel}' requires max_tokens greater than ${CLAUDE_MIN_THINKING_BUDGET}. Received ${resolvedMaxTokens}.`,
      );
    }
    if (
      normalizedThinking
      && normalizedThinking.type === "enabled"
      && normalizedThinking.budget_tokens >= resolvedMaxTokens
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
      ...(normalizedThinking ? { thinking: normalizedThinking } : {}),
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
    const status = err instanceof HttpStatusError
      ? err.status
      : (err != null && typeof (err as Record<string, unknown>).status === "number")
        ? (err as Record<string, unknown>).status as number
        : 500;
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
  if (contentType.includes("application/json") && getRoutingSettings().fakeStream) {
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
      if (res.headersSent || !getRoutingSettings().fakeStream) throw streamErr;
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
    | { thinking: { type: "adaptive"; display?: "summarized" | "omitted" } }
    | { thinking: { type: "enabled"; budget_tokens: number; display?: "summarized" | "omitted" } } = {};

  if (thinking) {
    if (CLAUDE_ADAPTIVE_THINKING_MODELS.has(model)) {
      thinkingParam = {
        thinking: normalizeClaudeThinkingDisplay(model, { type: "adaptive" }),
      };
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
        thinking: normalizeClaudeThinkingDisplay(model, {
          type: "enabled",
          budget_tokens: budgetTokens,
        }),
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
