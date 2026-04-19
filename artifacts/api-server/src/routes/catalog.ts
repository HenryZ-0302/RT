import { Router, type IRouter, type Request, type Response } from "express";
import { requireApiKeyWithQuery } from "../middleware/auth";
import { buildBackendPool, getCachedHealth, getFriendProxyConfigs } from "../services/backendPool";
import {
  ALL_MODELS,
  GEMINI_BASE_MODELS,
  GEMINI_IMAGE_MODELS,
  MODEL_REGISTRY,
  isModelEnabled,
} from "../services/modelRegistry";

const router: IRouter = Router();

function sendModelCatalog(_req: Request, res: Response) {
  const pool = buildBackendPool();
  const friendStatuses = getFriendProxyConfigs().map(({ label, url }) => ({
    label,
    url,
    status: getCachedHealth(url) === null ? "unknown" : getCachedHealth(url) ? "healthy" : "down",
  }));

  res.json({
    object: "list",
    data: ALL_MODELS.filter((model) => isModelEnabled(model.id)).map((model) => ({
      id: model.id,
      object: "model",
      created: 1700000000,
      owned_by: MODEL_REGISTRY.get(model.id)?.provider ?? "service-layer",
      description: model.description,
      capability: MODEL_REGISTRY.get(model.id)?.capability ?? "chat",
      group: MODEL_REGISTRY.get(model.id)?.group ?? "openrouter",
    })),
    _meta: {
      active_backends: pool.length,
      local: "healthy",
      friends: friendStatuses,
    },
  });
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

for (const path of ["/v1/models", "/service/catalog"]) {
  router.get(path, requireApiKeyWithQuery, sendModelCatalog);
}

router.get("/v1beta/models", requireApiKeyWithQuery, listGeminiNativeModels);
router.get("/v1beta/models/:model", requireApiKeyWithQuery, getGeminiNativeModel);

export default router;
