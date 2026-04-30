import { Router, type IRouter, type Request, type Response } from "express";
import { readJson, writeJson } from "../lib/cloudPersist";
import { ensureApiKey } from "../middleware/auth";
import {
  RESPONSE_CACHE_DEFAULT_TTL_SECONDS,
  clearResponseCache,
  getResponseCacheStats,
  normalizeResponseCacheTtlSeconds,
  type ResponseCacheSettings,
} from "../services/responseCache";

const router: IRouter = Router();

const SETTINGS_FILE = "server_settings.json";

interface ServerSettings {
  sillyTavernMode: boolean;
  responseCache: ResponseCacheSettings;
}

const DEFAULT_SETTINGS: ServerSettings = {
  sillyTavernMode: false,
  responseCache: {
    enabled: false,
    ttlSeconds: RESPONSE_CACHE_DEFAULT_TTL_SECONDS,
  },
};

const settings: ServerSettings = {
  ...DEFAULT_SETTINGS,
  responseCache: { ...DEFAULT_SETTINGS.responseCache },
};

export const settingsReady: Promise<void> = readJson<ServerSettings>(SETTINGS_FILE)
  .then((saved) => {
    if (saved && typeof saved.sillyTavernMode === "boolean") {
      settings.sillyTavernMode = saved.sillyTavernMode;
    }
    if (saved?.responseCache && typeof saved.responseCache === "object") {
      settings.responseCache = {
        enabled: saved.responseCache.enabled === true,
        ttlSeconds: normalizeResponseCacheTtlSeconds(saved.responseCache.ttlSeconds),
      };
    }
  })
  .catch(() => {
    // Keep defaults if persisted settings cannot be loaded.
  });

async function saveSettings(): Promise<void> {
  await writeJson(SETTINGS_FILE, settings);
}

export function getSillyTavernMode(): boolean {
  return settings.sillyTavernMode;
}

export function getResponseCacheSettings(): ResponseCacheSettings {
  return { ...settings.responseCache };
}

function checkApiKey(req: Request, res: Response): boolean {
  return ensureApiKey(req, res);
}

function getCompatibilitySettings(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;
  res.json({ enabled: settings.sillyTavernMode });
}

function getCacheSettings(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;
  res.json({ ...settings.responseCache, ...getResponseCacheStats() });
}

async function updateCompatibilitySettings(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;

  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: { message: "enabled must be a boolean", type: "invalid_request_error" } });
    return;
  }

  settings.sillyTavernMode = enabled;
  await saveSettings().catch(() => null);
  res.json({ enabled: settings.sillyTavernMode });
}

async function updateCacheSettings(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;

  const body = req.body as { enabled?: unknown; ttlSeconds?: unknown; clear?: unknown };
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    res.status(400).json({ error: { message: "enabled must be a boolean", type: "invalid_request_error" } });
    return;
  }

  if (body.enabled !== undefined) {
    settings.responseCache.enabled = body.enabled;
    if (!body.enabled) clearResponseCache();
  }

  if (body.ttlSeconds !== undefined) {
    settings.responseCache.ttlSeconds = normalizeResponseCacheTtlSeconds(body.ttlSeconds);
  }

  if (body.clear === true) {
    clearResponseCache();
  }

  await saveSettings().catch(() => null);
  res.json({ ...settings.responseCache, ...getResponseCacheStats() });
}

for (const path of ["/settings/sillytavern", "/service/settings/compatibility"]) {
  router.get(path, getCompatibilitySettings);
  router.post(path, (req, res) => {
    void updateCompatibilitySettings(req, res);
  });
}

for (const path of ["/settings/cache", "/service/settings/cache"]) {
  router.get(path, getCacheSettings);
  router.post(path, (req, res) => {
    void updateCacheSettings(req, res);
  });
}

export default router;
