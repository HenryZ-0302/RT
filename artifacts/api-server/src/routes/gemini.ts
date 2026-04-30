import { Router, type IRouter, type Request, type Response } from "express";
import { type GoogleGenAI } from "@google/genai";
import { parseRequestBody } from "../lib/validation";
import { requireApiKey } from "../middleware/auth";
import { geminiNativeGenerateContentBodySchema } from "../schemas/gemini";
import { type Backend } from "../services/backendPool";
import { handleFriendJsonProxy, handleFriendSseProxy } from "../services/friendProxy";
import { GEMINI_BASE_MODELS, isModelEnabled } from "../services/modelRegistry";
import { type RequestLog } from "../services/requestLogs";
import { FriendProxyHttpError, HttpStatusError, setSseHeaders, writeAndFlush } from "../services/routeSupport";

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

type PushRequestLog = (entry: Omit<RequestLog, "id" | "time">) => void;

export function createGeminiRouter(deps: {
  makeLocalGemini: () => GoogleGenAI;
  pickBackend: () => Backend | null;
  pickBackendExcluding: (exclude: Set<string>) => Backend | null;
  setHealth: (url: string, healthy: boolean) => void;
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
  sendApiError: (req: Request, res: Response, err: unknown) => void;
}): IRouter {
  const router = Router();

  function firstParam(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? "" : value ?? "";
  }

  function backendLabel(backend: Backend): string {
    return backend.kind === "local" ? "local" : backend.label;
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

  function estimateGeminiNativeTokensFromValue(value: unknown): number {
    const visited = new Set<unknown>();

    const walk = (value: unknown): number => {
      if (value === null || value === undefined) return 0;
      if (typeof value === "string") return value.length;
      if (typeof value === "number" || typeof value === "boolean") return String(value).length;
      if (typeof value !== "object") return 0;
      if (visited.has(value)) return 0;
      visited.add(value);

      if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + walk(item), 0);

      return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + walk(item), 0);
    };

    return Math.max(1, Math.ceil(walk(value) / 4));
  }

  function estimateGeminiNativePromptTokens(body: GeminiNativeGenerateContentRequest): number {
    return estimateGeminiNativeTokensFromValue({
      contents: body.contents,
      systemInstruction: body.systemInstruction,
    });
  }

  function estimateTokensFromChars(chars: number): number {
    return chars > 0 ? Math.ceil(chars / 4) : 0;
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

  function extractGeminiNativeUsage(payload: Record<string, unknown>): {
    promptTokens?: number;
    completionTokens?: number;
  } {
    const usage = payload["usageMetadata"] as {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    } | undefined;
    return {
      promptTokens: usage?.promptTokenCount,
      completionTokens: sumGeminiBillableOutputTokens(usage),
    };
  }

  function countGeminiNativeOutputChars(payload: Record<string, unknown>): number {
    const candidates = payload["candidates"] as Array<{ content?: { parts?: Array<Record<string, unknown>> } }> | undefined;
    if (!Array.isArray(candidates)) return 0;

    let chars = 0;
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part?.text === "string") chars += part.text.length;
      }
    }

    return chars;
  }

  async function handleGeminiNativeGenerateContent(req: Request, res: Response) {
    const body = parseRequestBody(res, geminiNativeGenerateContentBodySchema, req.body) as GeminiNativeGenerateContentRequest | null;
    if (!body) return;
    const selectedModel = getEnabledGeminiNativeChatModel(firstParam(req.params.model));
    const startTime = Date.now();
    let backend = deps.pickBackend();
    if (!backend) throw new HttpStatusError(503, "No available backends - all sub-nodes are down and local fallback is disabled");
    const triedFriendUrls = new Set<string>();

    for (let attempt = 0; ; attempt++) {
      const label = backendLabel(backend);
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
          const client = deps.makeLocalGemini();
          responseJson = await (client.models as unknown as {
            generateContent: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
          }).generateContent(buildGeminiNativeGenerateArgs(selectedModel, body));
        }

        const duration = Date.now() - startTime;
        if (backend.kind === "friend") deps.setHealth(backend.url, true);
        const usage = extractGeminiNativeUsage(responseJson);
        const promptTokens = usage.promptTokens ?? estimateGeminiNativePromptTokens(body);
        const completionTokens = usage.completionTokens ?? estimateTokensFromChars(countGeminiNativeOutputChars(responseJson));
        deps.recordCallStat(
          label,
          duration,
          promptTokens,
          completionTokens,
          undefined,
          selectedModel,
        );
        deps.pushRequestLog({
          method: req.method,
          path: req.path,
          model: selectedModel,
          capability: "chat",
          backend: label,
          status: 200,
          duration,
          stream: false,
          promptTokens,
          completionTokens,
          level: "info",
        });
        res.json(responseJson);
        return;
      } catch (err) {
        const duration = Date.now() - startTime;
        const failedBackend = backend;
        if (backend.kind === "friend") {
          deps.setHealth(backend.url, false);
          const status = err instanceof FriendProxyHttpError ? err.status : 502;
          if (!(err instanceof FriendProxyHttpError) || status >= 500) {
            const nextBackend = deps.pickBackendExcluding(triedFriendUrls);
            if (nextBackend && attempt < 3) {
              backend = nextBackend;
              continue;
            }
          }
        }
        const status = err instanceof HttpStatusError
          ? err.status
          : err instanceof FriendProxyHttpError
            ? err.status
            : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        deps.recordErrorStat(backendLabel(failedBackend));
        deps.pushRequestLog({
          method: req.method,
          path: req.path,
          model: selectedModel,
          capability: "chat",
          backend: backendLabel(failedBackend),
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
    const body = parseRequestBody(res, geminiNativeGenerateContentBodySchema, req.body) as GeminiNativeGenerateContentRequest | null;
    if (!body) return;
    const selectedModel = getEnabledGeminiNativeChatModel(firstParam(req.params.model));
    const startTime = Date.now();
    let backend = deps.pickBackend();
    if (!backend) throw new HttpStatusError(503, "No available backends - all sub-nodes are down and local fallback is disabled");
    const triedFriendUrls = new Set<string>();

    for (let attempt = 0; ; attempt++) {
      const label = backendLabel(backend);
      try {
        let promptTokens = 0;
        let completionTokens = 0;
        let ttftMs: number | undefined;
        let outputChars = 0;

        if (backend.kind === "friend") {
          triedFriendUrls.add(backend.url);
          const streamStats = await handleFriendSseProxy({
            backend,
            path: `/v1beta/models/${selectedModel}:streamGenerateContent`,
            body,
            res,
            startTime,
          });
          promptTokens = streamStats.promptTokens;
          completionTokens = streamStats.completionTokens;
          ttftMs = streamStats.ttftMs;
          outputChars = streamStats.outputChars;
        } else {
          const client = deps.makeLocalGemini();
          const streamResponse = await (client.models as unknown as {
            generateContentStream: (args: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
          }).generateContentStream(buildGeminiNativeGenerateArgs(selectedModel, body));
          setSseHeaders(res);
          for await (const chunk of streamResponse) {
            const usage = extractGeminiNativeUsage(chunk);
            if (typeof usage.promptTokens === "number") promptTokens = usage.promptTokens;
            if (typeof usage.completionTokens === "number") completionTokens = usage.completionTokens;

            const chunkChars = countGeminiNativeOutputChars(chunk);
            outputChars += chunkChars;
            if (ttftMs === undefined && chunkChars > 0) {
              ttftMs = Date.now() - startTime;
            }

            writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
          }
          res.end();
        }

        const duration = Date.now() - startTime;
        if (backend.kind === "friend") deps.setHealth(backend.url, true);
        if (promptTokens === 0) promptTokens = estimateGeminiNativePromptTokens(body);
        if (completionTokens === 0) completionTokens = estimateTokensFromChars(outputChars);
        deps.recordCallStat(
          label,
          duration,
          promptTokens,
          completionTokens,
          ttftMs,
          selectedModel,
        );
        deps.pushRequestLog({
          method: req.method,
          path: req.path,
          model: selectedModel,
          capability: "chat",
          backend: label,
          status: 200,
          duration,
          stream: true,
          promptTokens,
          completionTokens,
          level: "info",
        });
        return;
      } catch (err) {
        const duration = Date.now() - startTime;
        const failedBackend = backend;
        if (backend.kind === "friend") {
          deps.setHealth(backend.url, false);
          const status = err instanceof FriendProxyHttpError ? err.status : 502;
          if (!(err instanceof FriendProxyHttpError) || status >= 500) {
            const nextBackend = deps.pickBackendExcluding(triedFriendUrls);
            if (nextBackend && attempt < 3 && !res.headersSent) {
              backend = nextBackend;
              continue;
            }
          }
        }
        const status = err instanceof HttpStatusError
          ? err.status
          : err instanceof FriendProxyHttpError
            ? err.status
            : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        deps.recordErrorStat(backendLabel(failedBackend));
        deps.pushRequestLog({
          method: req.method,
          path: req.path,
          model: selectedModel,
          capability: "chat",
          backend: backendLabel(failedBackend),
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
    const body = parseRequestBody(res, geminiNativeGenerateContentBodySchema, req.body) as GeminiNativeGenerateContentRequest | null;
    if (!body) return;
    const selectedModel = getEnabledGeminiNativeChatModel(firstParam(req.params.model));
    const startTime = Date.now();
    let backend = deps.pickBackend();
    if (!backend) throw new HttpStatusError(503, "No available backends - all sub-nodes are down and local fallback is disabled");
    const triedFriendUrls = new Set<string>();

    for (let attempt = 0; ; attempt++) {
      const label = backendLabel(backend);
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
          const client = deps.makeLocalGemini();
          const modelApi = client.models as unknown as Record<string, unknown>;
          const countTokens = modelApi["countTokens"];
          if (typeof countTokens === "function") {
            responseJson = await (countTokens as (args: Record<string, unknown>) => Promise<Record<string, unknown>>)({
              model: selectedModel,
              contents: body.contents ?? [],
            });
          } else {
            responseJson = { totalTokens: estimateGeminiNativePromptTokens(body) };
          }
        }

        const duration = Date.now() - startTime;
        if (backend.kind === "friend") deps.setHealth(backend.url, true);
        deps.pushRequestLog({
          method: req.method,
          path: req.path,
          model: selectedModel,
          capability: "chat",
          backend: label,
          status: 200,
          duration,
          stream: false,
          level: "info",
        });
        res.json(responseJson);
        return;
      } catch (err) {
        const duration = Date.now() - startTime;
        const failedBackend = backend;
        if (backend.kind === "friend") {
          deps.setHealth(backend.url, false);
          const status = err instanceof FriendProxyHttpError ? err.status : 502;
          if (!(err instanceof FriendProxyHttpError) || status >= 500) {
            const nextBackend = deps.pickBackendExcluding(triedFriendUrls);
            if (nextBackend && attempt < 3) {
              backend = nextBackend;
              continue;
            }
          }
        }
        const status = err instanceof HttpStatusError
          ? err.status
          : err instanceof FriendProxyHttpError
            ? err.status
            : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        deps.recordErrorStat(backendLabel(failedBackend));
        deps.pushRequestLog({
          method: req.method,
          path: req.path,
          model: selectedModel,
          capability: "chat",
          backend: backendLabel(failedBackend),
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

  router.post("/v1beta/models/:model/generateContent", requireApiKey, async (req, res) => {
    try {
      await handleGeminiNativeGenerateContent(req, res);
    } catch (err) {
      deps.sendApiError(req, res, err);
    }
  });

  router.post(/^\/v1beta\/models\/([^:]+):generateContent$/, requireApiKey, async (req, res) => {
    try {
      req.params.model = firstParam(req.params[0]);
      await handleGeminiNativeGenerateContent(req, res);
    } catch (err) {
      deps.sendApiError(req, res, err);
    }
  });

  router.post("/v1beta/models/:model/streamGenerateContent", requireApiKey, async (req, res) => {
    try {
      await handleGeminiNativeStreamGenerateContent(req, res);
    } catch (err) {
      deps.sendApiError(req, res, err);
    }
  });

  router.post(/^\/v1beta\/models\/([^:]+):streamGenerateContent$/, requireApiKey, async (req, res) => {
    try {
      req.params.model = firstParam(req.params[0]);
      await handleGeminiNativeStreamGenerateContent(req, res);
    } catch (err) {
      deps.sendApiError(req, res, err);
    }
  });

  router.post("/v1beta/models/:model/countTokens", requireApiKey, async (req, res) => {
    try {
      await handleGeminiNativeCountTokens(req, res);
    } catch (err) {
      deps.sendApiError(req, res, err);
    }
  });

  router.post(/^\/v1beta\/models\/([^:]+):countTokens$/, requireApiKey, async (req, res) => {
    try {
      req.params.model = firstParam(req.params[0]);
      await handleGeminiNativeCountTokens(req, res);
    } catch (err) {
      deps.sendApiError(req, res, err);
    }
  });

  return router;
}
