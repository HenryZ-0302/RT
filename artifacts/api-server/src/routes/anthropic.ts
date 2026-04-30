import Anthropic from "@anthropic-ai/sdk";
import { Router, type IRouter, type Request, type Response } from "express";
import { parseRequestBody } from "../lib/validation";
import { requireApiKey } from "../middleware/auth";
import { anthropicMessagesBodySchema } from "../schemas/anthropic";
import {
  CLAUDE_ADAPTIVE_THINKING_MODELS,
  CLAUDE_DEFAULT_THINKING_BUDGET,
  CLAUDE_MIN_THINKING_BUDGET,
  normalizeClaudeThinkingDisplay,
  resolveClaudeThinkingModel,
  shouldForceClaudeSummarizedThinking,
} from "../services/modelRegistry";
import { type RequestLog } from "../services/requestLogs";
import { HttpStatusError, setSseHeaders, writeAndFlush } from "../services/routeSupport";
import { type PromptCacheSettings } from "./settings";
import { type CacheTokenStats } from "../services/stats";

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

type AnthropicImageSource =
  | { type: "base64"; media_type: string; data: string }
  | { type: "url"; url: string };

type AnthropicContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: AnthropicImageSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContentPart[] };

type PushRequestLog = (entry: Omit<RequestLog, "id" | "time">) => void;
type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

const ANTHROPIC_NATIVE_TOOL_TYPE_ALIASES: Record<string, string> = {
  web_search_20260209: "web_search_20250305",
};

function sanitizeThinkingText(raw: string): string {
  return raw.replace(/<\/?think>/g, "");
}

function buildReasoningFields(reasoning: string): { reasoning: string; reasoning_content: string } {
  return {
    reasoning,
    reasoning_content: reasoning,
  };
}

function buildPromptCacheParam(settings: PromptCacheSettings | undefined): Record<string, unknown> {
  if (!settings?.enabled) return {};
  return {
    cache_control: {
      type: "ephemeral",
      ttl: settings.ttl,
    },
  };
}

function totalAnthropicInputTokens(usage: AnthropicUsage | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens ?? 0)
    + (usage.cache_creation_input_tokens ?? 0)
    + (usage.cache_read_input_tokens ?? 0);
}

function buildOpenAIUsageFromAnthropic(usage: AnthropicUsage): Record<string, unknown> {
  const promptTokens = totalAnthropicInputTokens(usage);
  const completionTokens = usage.output_tokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: {
      cached_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
      input_tokens: usage.input_tokens ?? 0,
    },
  };
}

function cacheStatsFromAnthropicUsage(usage: AnthropicUsage | undefined): CacheTokenStats {
  return {
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

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

  const result: AnthropicMessage[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const entry = message as Record<string, unknown>;
    const role = entry.role === "assistant" ? "assistant" : "user";
    const content = entry.content;

    if (typeof content === "string") {
      result.push({ role, content });
      continue;
    }

    if (!Array.isArray(content)) {
      result.push({ role, content: "" });
      continue;
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

    result.push({
      role,
      content: filteredContent,
    });
  }

  return result;
}

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
      }
      return { type: "image", source: { type: "url", url } };
    }
    if (part.type === "text") {
      return { type: "text", text: (part as { type: "text"; text: string }).text };
    }
    return { type: "text", text: JSON.stringify(part) };
  });
}

function convertToolsForClaude(tools: OAITool[]): { name: string; description: string; input_schema: unknown }[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? "",
    input_schema: tool.function.parameters ?? { type: "object", properties: {} },
  }));
}

function convertMessagesForClaude(messages: OAIMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "assistant") {
      const assistantMsg = msg as Extract<OAIMessage, { role: "assistant" }>;
      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
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
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {}
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
      const toolMsg = msg as Extract<OAIMessage, { role: "tool" }>;
      result.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolMsg.tool_call_id, content: toolMsg.content }],
      });
    } else {
      result.push({
        role: "user",
        content: convertContentForClaude(msg.content as string | OAIContentPart[]),
      });
    }
  }

  return result;
}

export async function handleClaude(args: {
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
  promptCache?: PromptCacheSettings;
}): Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number; cache?: CacheTokenStats }> {
  const { req, res, client, model, messages, stream, maxTokens, thinking = false, tools, toolChoice, startTime, promptCache } = args;

  const systemMessages = messages
    .filter((message) => message.role === "system")
    .map((message) => (
      typeof message.content === "string"
        ? message.content
        : (message.content as OAIContentPart[])
          .map((part) => (part.type === "text" ? (part as { type: "text"; text: string }).text : ""))
          .join("")
    ))
    .join("\n");

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

  const anthropicTools = tools?.length ? convertToolsForClaude(tools) : undefined;
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
    throw new HttpStatusError(400, "Claude thinking mode only supports tool_choice values of 'auto' or 'none'.");
  }

  const buildCreateParams = () => ({
    model,
    max_tokens: maxTokens,
    ...(systemMessages ? { system: systemMessages } : {}),
    ...buildPromptCacheParam(promptCache),
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
      let cache: CacheTokenStats = {};
      let ttftMs: number | undefined;
      let currentToolIndex = -1;
      const toolIndexMap = new Map<number, number>();
      let toolCallCount = 0;

      for await (const event of claudeStream) {
        if (event.type === "message_start") {
          inputTokens = totalAnthropicInputTokens(event.message.usage as AnthropicUsage);
          cache = cacheStatsFromAnthropicUsage(event.message.usage as AnthropicUsage);
          writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`);
        } else if (event.type === "content_block_start") {
          const block = event.content_block;

          if (block.type === "thinking") {
            continue;
          } else if (block.type === "tool_use") {
            currentToolIndex = toolCallCount++;
            toolIndexMap.set(event.index, currentToolIndex);
            if (ttftMs === undefined) ttftMs = Date.now() - startTime;
            writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { tool_calls: [{ index: currentToolIndex, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] }, finish_reason: null }] })}\n\n`);
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta;

          if (delta.type === "thinking_delta") {
            const cleaned = sanitizeThinkingText(delta.thinking);
            if (cleaned) {
              writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: buildReasoningFields(cleaned), finish_reason: null }] })}\n\n`);
            }
          } else if (delta.type === "text_delta") {
            if (ttftMs === undefined) ttftMs = Date.now() - startTime;
            writeAndFlush(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }] })}\n\n`);
          } else if (delta.type === "input_json_delta") {
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
      return { promptTokens: inputTokens, completionTokens: outputTokens, ttftMs, cache };
    } finally {
      clearInterval(keepalive);
    }
  }

  let result: Anthropic.Message;
  try {
    result = await client.messages.create(buildCreateParams() as Parameters<typeof client.messages.create>[0]) as Anthropic.Message;
  } catch (nonStreamErr: unknown) {
    const errMsg = nonStreamErr instanceof Error ? nonStreamErr.message : String(nonStreamErr);
    if (/streaming.*required|requires.*stream/i.test(errMsg)) {
      req.log.warn("Claude model requires streaming — upgrading to stream+collect for non-stream request");
      const claudeStream = client.messages.stream(buildCreateParams() as Parameters<typeof client.messages.stream>[0]);
      result = await claudeStream.finalMessage() as Anthropic.Message;
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
    usage: buildOpenAIUsageFromAnthropic(result.usage as AnthropicUsage),
  });

  return {
    promptTokens: totalAnthropicInputTokens(result.usage as AnthropicUsage),
    completionTokens: result.usage.output_tokens,
    cache: cacheStatsFromAnthropicUsage(result.usage as AnthropicUsage),
  };
}

export function createAnthropicRouter(deps: {
  makeLocalAnthropic: () => Anthropic;
  getPromptCacheSettings: () => PromptCacheSettings;
  recordCallStat: (
    label: string,
    durationMs: number,
    prompt: number,
    completion: number,
    ttftMs?: number,
    model?: string,
    cache?: CacheTokenStats,
  ) => void;
  recordErrorStat: (label: string) => void;
  pushRequestLog: PushRequestLog;
}): IRouter {
  const router = Router();

  async function handleAnthropicMessages(req: Request, res: Response) {
    const parsedBody = parseRequestBody(res, anthropicMessagesBodySchema, req.body);
    if (!parsedBody) return;
    const rawBody = sanitizeAnthropicNativeValue(parsedBody) as {
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
            : {
              type: "enabled" as const,
              budget_tokens: Math.max(
                CLAUDE_MIN_THINKING_BUDGET,
                Math.min(CLAUDE_DEFAULT_THINKING_BUDGET, resolvedMaxTokens - 1),
              ),
              ...(shouldForceClaudeSummarizedThinking(actualModel) ? { display: "summarized" as const } : {}),
            }
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

      const client = deps.makeLocalAnthropic();

      const createParams = {
        model: actualModel,
        max_tokens: resolvedMaxTokens,
        messages,
        ...(system ? { system } : {}),
        ...buildPromptCacheParam(deps.getPromptCacheSettings()),
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
        let cache: CacheTokenStats = {};

        try {
          const claudeStream = client.messages.stream(createParams as Parameters<typeof client.messages.stream>[0]);

          for await (const event of claudeStream) {
            if (event.type === "message_start") {
              inputTokens = totalAnthropicInputTokens(event.message.usage as AnthropicUsage);
              cache = cacheStatsFromAnthropicUsage(event.message.usage as AnthropicUsage);
            } else if (event.type === "message_delta") {
              outputTokens = event.usage.output_tokens;
            }
            writeAndFlush(res, `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
          writeAndFlush(res, "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
          res.end();
          const dur = Date.now() - startTime;
          deps.recordCallStat("local", dur, inputTokens, outputTokens, undefined, selectedModel, cache);
          deps.pushRequestLog({
            method: req.method,
            path: req.path,
            model: selectedModel,
            backend: "local",
            status: 200,
            duration: dur,
            stream: true,
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            level: "info",
          });
        } finally {
          clearInterval(keepalive);
        }
      } else {
        const result = await client.messages.create(createParams);
        const usage = ((result as { usage?: AnthropicUsage }).usage ?? {});
        const dur = Date.now() - startTime;
        deps.recordCallStat("local", dur, totalAnthropicInputTokens(usage), usage.output_tokens ?? 0, undefined, selectedModel, cacheStatsFromAnthropicUsage(usage));
        deps.pushRequestLog({
          method: req.method,
          path: req.path,
          model: selectedModel,
          backend: "local",
          status: 200,
          duration: dur,
          stream: false,
          promptTokens: totalAnthropicInputTokens(usage),
          completionTokens: usage.output_tokens ?? 0,
          level: "info",
        });
        res.json(result);
      }
    } catch (err: unknown) {
      deps.recordErrorStat("local");
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      const status = err instanceof HttpStatusError
        ? err.status
        : (err != null && typeof (err as Record<string, unknown>).status === "number")
          ? (err as Record<string, unknown>).status as number
          : 500;
      req.log.error({ err }, "/v1/messages request failed");
      deps.pushRequestLog({
        method: req.method,
        path: req.path,
        model: selectedModel,
        backend: "local",
        status,
        duration: Date.now() - startTime,
        stream: shouldStream,
        level: "error",
        error: errMsg,
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

  return router;
}
