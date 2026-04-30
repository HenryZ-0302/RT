import { Router, type IRouter, type Request, type Response } from "express";
import { readJson, writeJson } from "../lib/cloudPersist";
import { ensureApiKey } from "../middleware/auth";

const router: IRouter = Router();

const SETTINGS_FILE = "server_settings.json";

interface ServerSettings {
  sillyTavernMode: boolean;
  promptCache: PromptCacheSettings;
}

export type PromptCacheTtl = "5m" | "1h";

export interface PromptCacheSettings {
  enabled: boolean;
  ttl: PromptCacheTtl;
}

const DEFAULT_SETTINGS: ServerSettings = {
  sillyTavernMode: false,
  promptCache: {
    enabled: true,
    ttl: "5m",
  },
};

const settings: ServerSettings = {
  ...DEFAULT_SETTINGS,
  promptCache: { ...DEFAULT_SETTINGS.promptCache },
};

export const settingsReady: Promise<void> = readJson<ServerSettings>(SETTINGS_FILE)
  .then((saved) => {
    if (saved && typeof saved.sillyTavernMode === "boolean") {
      settings.sillyTavernMode = saved.sillyTavernMode;
    }
    if (saved?.promptCache && typeof saved.promptCache === "object") {
      settings.promptCache = {
        enabled: saved.promptCache.enabled === true,
        ttl: saved.promptCache.ttl === "1h" ? "1h" : "5m",
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

export function getPromptCacheSettings(): PromptCacheSettings {
  return { ...settings.promptCache };
}

function checkApiKey(req: Request, res: Response): boolean {
  return ensureApiKey(req, res);
}

function getCompatibilitySettings(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;
  res.json({ enabled: settings.sillyTavernMode });
}

function getPromptCacheSettingsRoute(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;
  res.json(settings.promptCache);
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

async function updatePromptCacheSettings(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;

  const body = req.body as { enabled?: unknown; ttl?: unknown };
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    res.status(400).json({ error: { message: "enabled must be a boolean", type: "invalid_request_error" } });
    return;
  }
  if (body.ttl !== undefined && body.ttl !== "5m" && body.ttl !== "1h") {
    res.status(400).json({ error: { message: "ttl must be '5m' or '1h'", type: "invalid_request_error" } });
    return;
  }

  if (typeof body.enabled === "boolean") settings.promptCache.enabled = body.enabled;
  if (body.ttl === "5m" || body.ttl === "1h") settings.promptCache.ttl = body.ttl;

  await saveSettings().catch(() => null);
  res.json(settings.promptCache);
}

for (const path of ["/settings/sillytavern", "/service/settings/compatibility"]) {
  router.get(path, getCompatibilitySettings);
  router.post(path, (req, res) => {
    void updateCompatibilitySettings(req, res);
  });
}

for (const path of ["/settings/prompt-cache", "/service/settings/prompt-cache"]) {
  router.get(path, getPromptCacheSettingsRoute);
  router.post(path, (req, res) => {
    void updatePromptCacheSettings(req, res);
  });
}

export default router;
