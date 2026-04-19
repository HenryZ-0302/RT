import { Router, type IRouter, type Request, type Response } from "express";
import { type GoogleGenAI } from "@google/genai";
import { parseRequestBody } from "../lib/validation";
import { requireApiKey } from "../middleware/auth";
import { geminiNativeImageBodySchema, openAiImageGenerationBodySchema } from "../schemas/images";
import { type Backend } from "../services/backendPool";
import { handleFriendJsonProxy } from "../services/friendProxy";
import { type RegisteredModel } from "../services/modelRegistry";
import { type RequestLog } from "../services/requestLogs";
import { FriendProxyHttpError, HttpStatusError, normalizeImageError } from "../services/routeSupport";

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

type PushRequestLog = (entry: Omit<RequestLog, "id" | "time">) => void;

export function createImagesRouter(deps: {
  getLocalOpenAIConfig: () => { apiKey: string; baseURL: string };
  makeLocalGemini: () => GoogleGenAI;
  pickBackend: () => Backend | null;
  pickBackendExcluding: (exclude: Set<string>) => Backend | null;
  setHealth: (url: string, healthy: boolean) => void;
  hasRegisteredModel: (id: string) => boolean;
  getRegisteredModel: (id: string | undefined) => RegisteredModel | undefined;
  isModelEnabled: (id: string) => boolean;
  recordImageCallStat: (label: string, durationMs: number, model: string) => void;
  recordErrorStat: (label: string) => void;
  pushRequestLog: PushRequestLog;
  sendApiError: (req: Request, res: Response, err: unknown) => void;
}): IRouter {
  const router = Router();

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

  async function handleOpenAIImage(args: {
    model: string;
    prompt: string;
    imageInputs: string[];
    n?: number;
    size?: string;
  }): Promise<Record<string, unknown>> {
    const { model, prompt, imageInputs, n, size } = args;
    try {
      const { apiKey, baseURL } = deps.getLocalOpenAIConfig();
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

  async function handleGeminiImage(args: {
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
    const { model, prompt, imageInputs, n, size, nativeConfig, nativeContents } = args;
    try {
      const client = deps.makeLocalGemini();
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

  async function generateOpenAICompatibleImageResponse(
    req: Request,
    body: OAIImageGenerationRequest,
  ): Promise<Record<string, unknown>> {
    if (body.model && !deps.hasRegisteredModel(body.model)) {
      throw new HttpStatusError(400, `Unknown model '${body.model}'.`);
    }
    const selectedModel = body.model ?? "gemini-2.5-flash-image";
    const modelInfo = deps.getRegisteredModel(selectedModel);
    if (!modelInfo || modelInfo.capability !== "image") {
      throw new HttpStatusError(400, `Model '${selectedModel}' is not an image generation model.`);
    }
    if (!deps.isModelEnabled(selectedModel)) {
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
    let backend = deps.pickBackend();
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
        } else if (provider === "openai") {
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

        const duration = Date.now() - startTime;
        if (backend.kind === "friend") deps.setHealth(backend.url, true);
        deps.recordImageCallStat(backendLabel, duration, selectedModel);
        deps.pushRequestLog({
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
          deps.setHealth(backend.url, false);
          const status = err instanceof FriendProxyHttpError ? err.status : 502;
          if (!(err instanceof FriendProxyHttpError) || status >= 500) {
            backend = deps.pickBackendExcluding(triedFriendUrls);
            if (backend && attempt < 3) continue;
          }
        }
        const status = err instanceof HttpStatusError
          ? err.status
          : err instanceof FriendProxyHttpError
            ? err.status
            : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        deps.recordErrorStat(backend.kind === "local" ? "local" : backend.label);
        deps.pushRequestLog({
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
    const body = parseRequestBody(res, openAiImageGenerationBodySchema, req.body) as OAIImageGenerationRequest | null;
    if (!body) return;
    if (body.response_format && body.response_format !== "b64_json") {
      throw new HttpStatusError(400, "This service only supports response_format 'b64_json' for image generation.");
    }
    const responseJson = await generateOpenAICompatibleImageResponse(req, body);
    res.json(responseJson);
  }

  async function handleGeminiNativeImage(req: Request, res: Response) {
    const params = parseRequestBody(res, geminiNativeImageBodySchema, req.body) as GeminiNativeImageRequest | null;
    if (!params) return;
    const selectedModel = req.params.model;
    const modelInfo = deps.getRegisteredModel(selectedModel);
    if (!modelInfo || modelInfo.capability !== "image") {
      throw new HttpStatusError(400, `Model '${selectedModel}' is not an image generation model.`);
    }
    if (!deps.isModelEnabled(selectedModel)) {
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
    let backend = deps.pickBackend();
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
        if (backend.kind === "friend") deps.setHealth(backend.url, true);
        deps.recordImageCallStat(backendLabel, duration, selectedModel);
        deps.pushRequestLog({
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
          deps.setHealth(backend.url, false);
          const status = err instanceof FriendProxyHttpError ? err.status : 502;
          if (!(err instanceof FriendProxyHttpError) || status >= 500) {
            backend = deps.pickBackendExcluding(triedFriendUrls);
            if (backend && attempt < 3) continue;
          }
        }
        const status = err instanceof HttpStatusError
          ? err.status
          : err instanceof FriendProxyHttpError
            ? err.status
            : 500;
        const message = err instanceof Error ? err.message : "Unknown error";
        deps.recordErrorStat(backend.kind === "local" ? "local" : backend.label);
        deps.pushRequestLog({
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

  router.post("/v1/images/generations", requireApiKey, async (req, res) => {
    try {
      await handleOpenAIImageGeneration(req, res);
    } catch (err) {
      deps.sendApiError(req, res, err);
    }
  });

  router.post("/v1beta/models/:model/generateImages", requireApiKey, async (req, res) => {
    try {
      await handleGeminiNativeImage(req, res);
    } catch (err) {
      deps.sendApiError(req, res, err);
    }
  });

  router.post(/^\/v1beta\/models\/([^:]+):generateImages$/, requireApiKey, async (req, res) => {
    try {
      req.params.model = req.params[0];
      await handleGeminiNativeImage(req, res);
    } catch (err) {
      deps.sendApiError(req, res, err);
    }
  });

  return router;
}
