import { Router, type IRouter, type Request, type Response } from "express";
import { getServiceAccessKey } from "../lib/serviceConfig";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { readJson, writeJson } from "../lib/cloudPersist";

const router: IRouter = Router();
const HEALTH_HISTORY_FILE = "health_history.json";

type HealthHistoryService = "apiServer" | "portal";
type HealthHistoryBucket = {
  hourKey: string;
  label: string;
  checks: number;
  okChecks: number;
  latencyTotalMs: number;
  latencySamples: number;
};
type HealthHistoryStore = Record<HealthHistoryService, HealthHistoryBucket[]>;

const EMPTY_HEALTH_HISTORY: HealthHistoryStore = {
  apiServer: [],
  portal: [],
};

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

function getHourKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}`;
}

function getHourLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

async function loadHealthHistory(): Promise<HealthHistoryStore> {
  const saved = await readJson<Partial<HealthHistoryStore>>(HEALTH_HISTORY_FILE).catch(() => null);
  return {
    apiServer: Array.isArray(saved?.apiServer) ? saved.apiServer : [],
    portal: Array.isArray(saved?.portal) ? saved.portal : [],
  };
}

function trimHealthHistory(store: HealthHistoryStore): HealthHistoryStore {
  const trim = (items: HealthHistoryBucket[]) => items
    .sort((a, b) => a.hourKey.localeCompare(b.hourKey))
    .slice(-24);

  return {
    apiServer: trim(store.apiServer),
    portal: trim(store.portal),
  };
}

function applyHealthEvent(
  store: HealthHistoryStore,
  event: { service: HealthHistoryService; ok: boolean; latencyMs?: number; checkedAt?: string },
): HealthHistoryStore {
  const service = event.service;
  const checkedAt = event.checkedAt ? new Date(event.checkedAt) : new Date();
  const date = Number.isNaN(checkedAt.getTime()) ? new Date() : checkedAt;
  const hourKey = getHourKey(date);
  const label = getHourLabel(date);
  const items = [...store[service]];
  const index = items.findIndex((item) => item.hourKey === hourKey);
  const current = index >= 0
    ? { ...items[index] }
    : { hourKey, label, checks: 0, okChecks: 0, latencyTotalMs: 0, latencySamples: 0 };

  current.checks += 1;
  if (event.ok) current.okChecks += 1;
  if (typeof event.latencyMs === "number" && Number.isFinite(event.latencyMs) && event.latencyMs >= 0) {
    current.latencyTotalMs += event.latencyMs;
    current.latencySamples += 1;
  }

  if (index >= 0) items[index] = current;
  else items.push(current);

  return trimHealthHistory({
    ...store,
    [service]: items,
  });
}

async function sendHealthHistory(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;
  const history = await loadHealthHistory();
  res.json(history);
}

async function recordHealthHistory(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;

  const body = req.body as {
    events?: Array<{ service?: HealthHistoryService; ok?: boolean; latencyMs?: number; checkedAt?: string }>;
  };

  const events = Array.isArray(body?.events) ? body.events : [];
  const validEvents = events.filter((event): event is { service: HealthHistoryService; ok: boolean; latencyMs?: number; checkedAt?: string } =>
    (event?.service === "apiServer" || event?.service === "portal") && typeof event.ok === "boolean"
  );

  if (validEvents.length === 0) {
    res.status(400).json({ error: { message: "events array is required", type: "invalid_request_error" } });
    return;
  }

  let history = await loadHealthHistory();
  for (const event of validEvents) {
    history = applyHealthEvent(history, event);
  }

  await writeJson(HEALTH_HISTORY_FILE, history).catch(() => null);
  res.json(history);
}

router.get("/service/status", sendHealth);
router.get("/service/healthcheck", sendHealthcheck);
router.get("/service/healthcheck/history", sendHealthHistory);
router.post("/service/healthcheck/history", recordHealthHistory);
router.get("/service/bootstrap", sendBootstrap);

export default router;
