import { Router, type IRouter, type Request, type Response } from "express";
import { getServiceAccessKey } from "../lib/serviceConfig";
import { readLocalVersion } from "../lib/version";

const router: IRouter = Router();

function sendHealth(_req: Request, res: Response) {
  res.json({ status: "ok" });
}

function sendHealthcheck(_req: Request, res: Response) {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    apiServer: {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      version: readLocalVersion(),
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

router.get("/service/status", sendHealth);
router.get("/service/healthcheck", sendHealthcheck);
router.get("/service/bootstrap", sendBootstrap);

export default router;
