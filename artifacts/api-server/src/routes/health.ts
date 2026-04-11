import { Router, type IRouter, type Request, type Response } from "express";
import { getServiceAccessKey } from "../lib/serviceConfig";

const router: IRouter = Router();

function sendHealth(_req: Request, res: Response) {
  res.json({ status: "ok" });
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

for (const path of ["/setup-status", "/service/bootstrap"]) {
  router.get(path, sendBootstrap);
}

export default router;
