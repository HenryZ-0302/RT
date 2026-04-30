import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { Router, type IRouter, type Request, type Response } from "express";
import { parseRequestBody } from "../lib/validation";
import { requireApiKey } from "../middleware/auth";
import { chatCompletionBodySchema } from "../schemas/chat";
import { type Backend } from "../services/backendPool";
import { type RequestLog } from "../services/requestLogs";
import { type RegisteredProvider } from "../services/modelRegistry";
import { type FriendProxyHttpError } from "../services/routeSupport";

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

type PushRequestLog = (entry: Omit<RequestLog, "id" | "time">) => void;

export function createChatRouter(deps: {
  pickBackend: () => Backend | null;
  pickBackendExcluding: (exclude: Set<string>) => Backend | null;
  setHealth: (url: string, healthy: boolean) => void;
  getRequestCounter: () => number;
  getProviderForModel: (id: string) => RegisteredProvider;
  isChatModel: (id: string | undefined) => boolean;
  isImageModel: (id: string | undefined) => boolean;
  isModelEnabled: (id: string) => boolean;
  resolveClaudeThinkingModel: (model: string, requestedMaxTokens?: number) => {
    actualModel: string;
    thinkingEnabled: boolean;
    resolvedMaxTokens: number;
  };
  getSillyTavernMode: () => boolean;
  makeLocalAnthropic: () => Anthropic;
  makeLocalOpenAI: () => OpenAI;
  makeLocalOpenRouter: () => OpenAI;
  handleFriendProxy: (args: {
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
  }) => Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number }>;
  handleOpenAI: (args: {
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
  }) => Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number }>;
  handleGemini: (args: {
    req: Request;
    res: Response;
    model: string;
    messages: OAIMessage[];
    stream: boolean;
    maxTokens?: number;
    thinking?: boolean;
    startTime: number;
  }) => Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number }>;
  handleClaude: (args: {
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
  }) => Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number }>;
  isFriendProxyHttpError: (err: unknown) => err is FriendProxyHttpError;
  isHttpStatusError: (err: unknown) => err is { status: number };
  writeAndFlush: (res: Response, data: string) => void;
  recordCallStat: (
    label: string,
    durationMs: number,
    prompt: number,
    completion: number,
    ttftMs?: number,
    model?: string,
  ) => void;
  recordErrorStat: (label: string) => void;
  pushRequestLog: PushRequestLog;
}): IRouter {
  const router = Router();

  async function handleChatCompletions(req: Request, res: Response) {
    const body = parseRequestBody(res, chatCompletionBodySchema, req.body);
    if (!body) return;
    const { model, messages, stream, max_tokens, tools, tool_choice } = body as {
      model?: string;
      messages: OAIMessage[];
      stream?: boolean;
      max_tokens?: number;
      tools?: OAITool[];
      tool_choice?: unknown;
    };

    if (model && !deps.isModelEnabled(model)) {
      res.status(403).json({ error: { message: `Model '${model}' is disabled on this service`, type: "invalid_request_error", code: "model_disabled" } });
      return;
    }
    if (model && deps.isImageModel(model)) {
      res.status(400).json({
        error: {
          message: `Model '${model}' is image-only. Use /v1/images/generations or /v1beta/models/${model}:generateImages instead.`,
          type: "invalid_request_error",
          code: "wrong_model_capability",
        },
      });
      return;
    }

    const selectedModel = model && deps.isChatModel(model) ? model : "gpt-5.2";
    const provider = deps.getProviderForModel(selectedModel);
    const isClaudeModel = provider === "anthropic";
    const isGeminiModel = provider === "gemini";
    const isOpenRouterModel = provider === "openrouter";
    const shouldStream = stream ?? false;
    const startTime = Date.now();

    const finalMessages = (isClaudeModel && deps.getSillyTavernMode() && !tools?.length)
      ? [...messages, { role: "user" as const, content: "继续" }]
      : messages;

    const MAX_FRIEND_RETRIES = 3;
    const triedFriendUrls = new Set<string>();
    let backend = deps.pickBackend();
    if (!backend) {
      res.status(503).json({ error: { message: "No available backends - all sub-nodes are down and local fallback is disabled", type: "service_unavailable" } });
      return;
    }

    for (let attempt = 0; ; attempt++) {
      const backendLabel = backend.kind === "local" ? "local" : backend.label;
      req.log.info({
        model: selectedModel,
        backend: backendLabel,
        attempt,
        counter: deps.getRequestCounter() - 1,
        sillyTavern: isClaudeModel && deps.getSillyTavernMode(),
        toolCount: tools?.length ?? 0,
      }, "Service request");

      try {
        let result: { promptTokens: number; completionTokens: number; ttftMs?: number };
        if (backend.kind === "friend") {
          triedFriendUrls.add(backend.url);
          result = await deps.handleFriendProxy({
            req,
            res,
            backend,
            model: selectedModel,
            messages: finalMessages,
            stream: shouldStream,
            maxTokens: max_tokens,
            tools,
            toolChoice: tool_choice,
            startTime,
          });
        } else if (isClaudeModel) {
          const { actualModel, thinkingEnabled, resolvedMaxTokens } = deps.resolveClaudeThinkingModel(selectedModel, max_tokens);
          const client = deps.makeLocalAnthropic();
          result = await deps.handleClaude({
            req,
            res,
            client,
            model: actualModel,
            messages: finalMessages,
            stream: shouldStream,
            maxTokens: resolvedMaxTokens,
            thinking: thinkingEnabled,
            tools,
            toolChoice: tool_choice,
            startTime,
          });
        } else if (isGeminiModel) {
          const thinkingEnabled = selectedModel.endsWith("-thinking");
          const actualModel = thinkingEnabled ? selectedModel.replace(/-thinking$/, "") : selectedModel;
          result = await deps.handleGemini({
            req,
            res,
            model: actualModel,
            messages: finalMessages,
            stream: shouldStream,
            maxTokens: max_tokens,
            thinking: thinkingEnabled,
            startTime,
          });
        } else if (isOpenRouterModel) {
          const client = deps.makeLocalOpenRouter();
          result = await deps.handleOpenAI({
            req,
            res,
            client,
            model: selectedModel,
            messages: finalMessages,
            stream: shouldStream,
            maxTokens: max_tokens,
            tools,
            toolChoice: tool_choice,
            startTime,
          });
        } else {
          const actualModel = selectedModel.endsWith("-thinking")
            ? selectedModel.replace(/-thinking$/, "")
            : selectedModel;
          const client = deps.makeLocalOpenAI();
          result = await deps.handleOpenAI({
            req,
            res,
            client,
            model: actualModel,
            messages: finalMessages,
            stream: shouldStream,
            maxTokens: max_tokens,
            tools,
            toolChoice: tool_choice,
            startTime,
          });
        }

        if (backend.kind === "friend") deps.setHealth(backend.url, true);
        const duration = Date.now() - startTime;
        deps.recordCallStat(backendLabel, duration, result.promptTokens, result.completionTokens, result.ttftMs, selectedModel);
        deps.pushRequestLog({
          method: req.method,
          path: req.path,
          model: selectedModel,
          backend: backendLabel,
          status: 200,
          duration,
          stream: shouldStream,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          level: "info",
        });
        break;
      } catch (err: unknown) {
        deps.recordErrorStat(backendLabel);

        const is5xx = deps.isFriendProxyHttpError(err) && err.status >= 500;
        const errMsg = err instanceof Error ? err.message : "";
        const isNetworkErr = err instanceof TypeError
          || ["fetch", "aborted", "terminated", "closed", "upstream", "ECONNRESET", "socket hang up", "UND_ERR"]
            .some((kw) => errMsg.includes(kw));

        if (backend.kind === "friend" && (is5xx || isNetworkErr)) {
          deps.setHealth(backend.url, false);
          req.log.warn({ url: backend.url, attempt, is5xx, isNetworkErr }, "Friend backend marked unhealthy, considering retry");

          if (attempt < MAX_FRIEND_RETRIES && !res.headersSent) {
            const next = deps.pickBackendExcluding(triedFriendUrls);
            if (next?.kind === "friend") {
              backend = next;
              continue;
            }
          }
        }

        req.log.error({ err }, "Service request failed");
        const errStatus = (
          deps.isFriendProxyHttpError(err)
            ? err.status
            : deps.isHttpStatusError(err)
              ? err.status
              : undefined
        ) ?? 500;
        const errType = errStatus >= 500 ? "server_error" : "invalid_request_error";
        deps.pushRequestLog({
          method: req.method,
          path: req.path,
          model: selectedModel,
          backend: backendLabel,
          status: errStatus,
          duration: Date.now() - startTime,
          stream: shouldStream,
          level: errStatus >= 500 ? "error" : "warn",
          error: errMsg || "Unknown error",
        });
        if (!res.headersSent) {
          res.status(errStatus).json({ error: { message: errMsg || "Unknown error", type: errType } });
        } else if (!res.writableEnded) {
          deps.writeAndFlush(res, `data: ${JSON.stringify({ error: { message: errMsg || "Unknown error" } })}\n\n`);
          deps.writeAndFlush(res, "data: [DONE]\n\n");
          res.end();
        }
        break;
      }
    }
  }

  for (const path of ["/v1/chat/completions", "/service/chat"]) {
    router.post(path, requireApiKey, handleChatCompletions);
  }

  return router;
}
