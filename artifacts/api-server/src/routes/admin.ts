import { Router, type IRouter, type Request, type Response } from "express";
import { parseRequestBody } from "../lib/validation";
import { requireApiKey, requireApiKeyWithQuery } from "../middleware/auth";
import {
  batchUpdateBackendsBodySchema,
  createBackendBodySchema,
  updateBackendBodySchema,
  updateModelsBodySchema,
  updateRoutingBodySchema,
} from "../schemas/admin";
import {
  type RoutingSettings,
  batchUpdateDynamicBackends,
  createDynamicBackend,
  deleteDynamicBackend,
  getAllFriendProxyConfigs,
  getCachedHealth,
  getRoutingSettings,
  isDynamicBackendLabel,
  updateDynamicBackend,
  updateRoutingSettings,
} from "../services/backendPool";
import { ALL_MODELS, MODEL_REGISTRY, isModelEnabled, updateModelAvailability } from "../services/modelRegistry";
import { sendLogs, streamLogs } from "../services/requestLogs";
import { type BackendStat, type ModelStat } from "../services/stats";

export function createAdminRouter(deps: {
  clearStats: () => void;
  getModelStatsObject: () => Record<string, ModelStat>;
  getStat: (label: string) => BackendStat;
}): IRouter {
  const router = Router();

  function sendMetrics(_req: Request, res: Response) {
    const allConfigs = getAllFriendProxyConfigs();
    const allLabels = ["local", ...allConfigs.map((config) => config.label)];
    const result: Record<string, unknown> = {};

    for (const label of allLabels) {
      const stat = deps.getStat(label);
      const cfg = allConfigs.find((config) => config.label === label);
      result[label] = {
        calls: stat.calls,
        errors: stat.errors,
        streamingCalls: stat.streamingCalls,
        promptTokens: stat.promptTokens,
        completionTokens: stat.completionTokens,
        totalTokens: stat.promptTokens + stat.completionTokens,
        avgDurationMs: stat.calls > 0 ? Math.round(stat.totalDurationMs / stat.calls) : 0,
        avgTtftMs: stat.streamingCalls > 0 ? Math.round(stat.totalTtftMs / stat.streamingCalls) : null,
        health: label === "local" ? "healthy" : getCachedHealth(cfg?.url ?? "") === false ? "down" : "healthy",
        url: label === "local" ? null : cfg?.url ?? null,
        dynamic: isDynamicBackendLabel(label),
        enabled: cfg ? cfg.enabled : true,
      };
    }

    res.json({
      stats: result,
      modelStats: deps.getModelStatsObject(),
      uptimeSeconds: Math.round(process.uptime()),
      routing: getRoutingSettings(),
    });
  }

  function resetMetrics(_req: Request, res: Response) {
    deps.clearStats();
    res.json({ ok: true });
  }

  function listBackends(_req: Request, res: Response) {
    const allConfigs = getAllFriendProxyConfigs();
    res.json({
      local: { url: null, source: "local" },
      env: allConfigs
        .filter((config) => !isDynamicBackendLabel(config.label))
        .map((config) => ({
          label: config.label,
          url: config.url,
          source: "env",
          health: getCachedHealth(config.url) === false ? "down" : "healthy",
        })),
      dynamic: allConfigs
        .filter((config) => isDynamicBackendLabel(config.label))
        .map((config) => ({
          label: config.label,
          url: config.url,
          enabled: config.enabled,
          source: "dynamic",
          health: getCachedHealth(config.url) === false ? "down" : "healthy",
        })),
    });
  }

  function createBackend(req: Request, res: Response) {
    const body = parseRequestBody(res, createBackendBodySchema, req.body);
    if (!body) return;
    const { url } = body;

    try {
      res.json(createDynamicBackend(url));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create backend";
      res.status(message === "URL already in pool" ? 409 : 500).json({ error: message });
    }
  }

  function deleteBackend(req: Request, res: Response) {
    const { label } = req.params;
    if (!deleteDynamicBackend(label)) {
      res.status(404).json({ error: "Dynamic backend not found" });
      return;
    }

    res.json({ deleted: true, label });
  }

  function updateBackend(req: Request, res: Response) {
    const { label } = req.params;
    const body = parseRequestBody(res, updateBackendBodySchema, req.body);
    if (!body) return;
    const { enabled } = body;

    const target = updateDynamicBackend(label, enabled);
    if (!target) {
      res.status(404).json({ error: "Dynamic backend not found" });
      return;
    }

    res.json({ label, enabled });
  }

  function batchUpdateBackends(req: Request, res: Response) {
    const body = parseRequestBody(res, batchUpdateBackendsBodySchema, req.body);
    if (!body) return;
    const { labels, enabled } = body;

    const updated = batchUpdateDynamicBackends(labels, enabled);
    res.json({ updated, enabled });
  }

  function getRouting(_req: Request, res: Response) {
    res.json(getRoutingSettings());
  }

  function updateRouting(req: Request, res: Response) {
    const patch = parseRequestBody(res, updateRoutingBodySchema, req.body) as Partial<RoutingSettings> | null;
    if (!patch) return;
    res.json(updateRoutingSettings(patch));
  }

  function listModels(_req: Request, res: Response) {
    const models = ALL_MODELS.map((model) => ({
      id: model.id,
      description: model.description,
      provider: MODEL_REGISTRY.get(model.id)?.provider ?? "openrouter",
      capability: MODEL_REGISTRY.get(model.id)?.capability ?? "chat",
      group: MODEL_REGISTRY.get(model.id)?.group ?? "openrouter",
      testMode: MODEL_REGISTRY.get(model.id)?.testMode ?? "chat",
      enabled: isModelEnabled(model.id),
    }));

    const summary: Record<string, { total: number; enabled: number }> = {};
    for (const model of models) {
      if (!summary[model.group]) summary[model.group] = { total: 0, enabled: 0 };
      summary[model.group].total++;
      if (model.enabled) summary[model.group].enabled++;
    }

    res.json({ models, summary });
  }

  function updateModels(req: Request, res: Response) {
    const body = parseRequestBody(res, updateModelsBodySchema, req.body);
    if (!body) return;
    const { ids, group, provider, enabled } = body;

    const targets = updateModelAvailability({ ids, group, provider, enabled });
    if (!targets) return;

    res.json({ updated: targets.length, enabled, ids: targets });
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

  for (const path of ["/v1/admin/backends", "/service/backends"]) {
    router.get(path, requireApiKey, listBackends);
    router.post(path, requireApiKey, createBackend);
    router.patch(path, requireApiKey, batchUpdateBackends);
  }

  for (const path of ["/v1/admin/backends/:label", "/service/backends/:label"]) {
    router.delete(path, requireApiKey, deleteBackend);
    router.patch(path, requireApiKey, updateBackend);
  }

  for (const path of ["/v1/admin/routing", "/service/routing"]) {
    router.get(path, requireApiKey, getRouting);
    router.patch(path, requireApiKey, updateRouting);
  }

  for (const path of ["/v1/admin/models", "/service/models"]) {
    router.get(path, requireApiKeyWithQuery, listModels);
    router.patch(path, requireApiKey, updateModels);
  }

  return router;
}
