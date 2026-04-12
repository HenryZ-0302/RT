import { Router, type IRouter, type Request, type Response } from "express";
import { getServiceAccessKey } from "../lib/serviceConfig";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const router: IRouter = Router();

function sendHealth(_req: Request, res: Response) {
  res.json({ status: "ok" });
}

function readVersion(): string {
  const candidates = [
    resolve(process.cwd(), "version.json"),
    resolve(process.cwd(), "../../version.json"),
  ];

  for (const file of candidates) {
    try {
      if (existsSync(file)) {
        return (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version ?? "unknown";
      }
    } catch {}
  }

  return "unknown";
}

function sendHealthcheck(_req: Request, res: Response) {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    apiServer: {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      version: readVersion(),
    },
    portal: {
      status: "client_check_required",
      note: "Portal frontend status is checked directly by the API portal client.",
    },
  });
}

function sendBootstrap(_req: Request, res: Response) {
  const configured = !!getServiceAccessKey();
  const integrationsReady =
    !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
    !!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL &&
    !!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY &&
    !!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
    !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY &&
    !!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL &&
    !!process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY &&
    !!process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  const storageReady = !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  res.json({ configured, integrationsReady, storageReady });
}

for (const path of ["/healthz", "/service/status"]) {
  router.get(path, sendHealth);
}

for (const path of ["/healthcheck", "/service/healthcheck"]) {
  router.get(path, sendHealthcheck);
}

for (const path of ["/setup-status", "/service/bootstrap"]) {
  router.get(path, sendBootstrap);
}

export default router;
