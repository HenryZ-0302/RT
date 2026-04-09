import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/setup-status", (_req, res) => {
  const configured = !!process.env.PROXY_API_KEY;
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
});

export default router;
