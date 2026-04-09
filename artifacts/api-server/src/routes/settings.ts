import { Router, type IRouter, type Request, type Response } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { getServiceAccessKey } from "../lib/serviceConfig";

const router: IRouter = Router();

const SETTINGS_FILE = resolve(process.cwd(), "server_settings.json");

interface ServerSettings {
  sillyTavernMode: boolean;
}

function loadSettings(): ServerSettings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as ServerSettings;
    }
  } catch {}
  return { sillyTavernMode: false };
}

function saveSettings(settings: ServerSettings): void {
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch {}
}

const settings: ServerSettings = loadSettings();

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

function updateCompatibilitySettings(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;

  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: { message: "enabled must be a boolean", type: "invalid_request_error" } });
    return;
  }

  settings.sillyTavernMode = enabled;
  saveSettings(settings);
  res.json({ enabled: settings.sillyTavernMode });
}

for (const path of ["/settings/sillytavern", "/service/settings/compatibility"]) {
  router.get(path, getCompatibilitySettings);
  router.post(path, updateCompatibilitySettings);
}

export default router;
