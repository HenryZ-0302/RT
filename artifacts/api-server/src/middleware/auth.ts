import { type NextFunction, type Request, type Response } from "express";
import { getServiceAccessKey } from "../lib/serviceConfig";
import { pushRequestLog } from "../services/requestLogs";

type ApiKeyFailure = {
  status: number;
  message: string;
  type: "server_error" | "invalid_request_error";
  logLevel: "error" | "warn";
  logMessage: string;
};

function buildApiKeyFailure(serviceKey: string | undefined, providedKey: string | undefined): ApiKeyFailure | null {
  if (!serviceKey) {
    return {
      status: 500,
      message: "Service access key is not configured",
      type: "server_error",
      logLevel: "error",
      logMessage: "Service access key is not configured",
    };
  }

  if (!providedKey) {
    return {
      status: 401,
      message: "Missing access key (provide Authorization: Bearer <key>, x-api-key, x-goog-api-key, or ?key=...)",
      type: "invalid_request_error",
      logLevel: "warn",
      logMessage: "Missing access key",
    };
  }

  if (providedKey !== serviceKey) {
    return {
      status: 401,
      message: "Invalid access key",
      type: "invalid_request_error",
      logLevel: "warn",
      logMessage: "Invalid access key",
    };
  }

  return null;
}

export function getProvidedApiKey(req: Request, allowQuery = false): string | undefined {
  const authHeader = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];
  const xGoogApiKey = req.headers["x-goog-api-key"];
  const queryKey = allowQuery ? req.query["key"] : undefined;

  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  if (typeof xApiKey === "string") {
    return xApiKey;
  }
  if (typeof xGoogApiKey === "string") {
    return xGoogApiKey;
  }
  if (typeof queryKey === "string" && queryKey) {
    return queryKey;
  }

  return undefined;
}

export function ensureApiKey(
  req: Request,
  res: Response,
  options?: { allowQuery?: boolean; logFailures?: boolean },
): boolean {
  const serviceKey = getServiceAccessKey();
  const providedKey = getProvidedApiKey(req, options?.allowQuery ?? false);
  const failure = buildApiKeyFailure(serviceKey, providedKey);

  if (!failure) {
    return true;
  }

  if (options?.logFailures) {
    pushRequestLog({
      method: req.method,
      path: req.path,
      status: failure.status,
      duration: 0,
      stream: false,
      level: failure.logLevel,
      error: failure.logMessage,
    });
  }

  res.status(failure.status).json({ error: { message: failure.message, type: failure.type } });
  return false;
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!ensureApiKey(req, res, { logFailures: true })) return;
  next();
}

export function requireApiKeyWithQuery(req: Request, res: Response, next: NextFunction): void {
  if (!ensureApiKey(req, res, { allowQuery: true, logFailures: true })) return;
  next();
}
