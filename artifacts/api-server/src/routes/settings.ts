import { Router, type IRouter, type Request, type Response } from "express";
import { readJson, writeJson } from "../lib/cloudPersist";
import { getServiceAccessKey } from "../lib/serviceConfig";

const router: IRouter = Router();

const SETTINGS_FILE = "server_settings.json";

interface ServerSettings {
  sillyTavernMode: boolean;
}

const DEFAULT_SETTINGS: ServerSettings = {
  sillyTavernMode: false,
};

const settings: ServerSettings = { ...DEFAULT_SETTINGS };

export const settingsReady: Promise<void> = readJson<ServerSettings>(SETTINGS_FILE)
  .then((saved) => {
    if (saved && typeof saved.sillyTavernMode === "boolean") {
      settings.sillyTavernMode = saved.sillyTavernMode;
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

function checkApiKey(req: Request, res: Response): boolean {
  const serviceKey = getServiceAccessKey();
  if (!serviceKey) {
    res.status(500).json({ error: { message: "Service access key is not configured", type: "server_error" } });
    return false;
  }

  const authHeader = req.headers.authorization;
  const xApiKey = req.headers["x-api-key"];
  let provided: string | undefined;

  if (authHeader?.startsWith("Bearer ")) provided = authHeader.slice(7);
  else if (typeof xApiKey === "string") provided = xApiKey;

  if (!provided || provided !== serviceKey) {
    res.status(401).json({ error: { message: "Unauthorized", type: "invalid_request_error" } });
    return false;
  }

  return true;
}

function getCompatibilitySettings(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;
  res.json({ enabled: settings.sillyTavernMode });
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

for (const path of ["/settings/sillytavern", "/service/settings/compatibility"]) {
  router.get(path, getCompatibilitySettings);
  router.post(path, (req, res) => {
    void updateCompatibilitySettings(req, res);
  });
}

export default router;
