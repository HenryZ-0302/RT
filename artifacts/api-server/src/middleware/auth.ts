import { type NextFunction, type Request, type Response } from "express";
import { getServiceAccessKey } from "../lib/serviceConfig";
import { pushRequestLog } from "../services/requestLogs";

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const serviceKey = getServiceAccessKey();
  if (!serviceKey) {
    pushRequestLog({
      method: req.method,
      path: req.path,
      status: 500,
      duration: 0,
      stream: false,
      level: "error",
      error: "Service access key is not configured",
    });
    res.status(500).json({ error: { message: "Service access key is not configured", type: "server_error" } });
    return;
  }

  const authHeader = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];
  const xGoogApiKey = req.headers["x-goog-api-key"];

  let providedKey: string | undefined;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    providedKey = authHeader.slice(7);
  } else if (typeof xApiKey === "string") {
    providedKey = xApiKey;
  } else if (typeof xGoogApiKey === "string") {
    providedKey = xGoogApiKey;
  }

  if (!providedKey) {
    pushRequestLog({
      method: req.method,
      path: req.path,
      status: 401,
      duration: 0,
      stream: false,
      level: "warn",
      error: "Missing access key",
    });
    res.status(401).json({
      error: {
        message: "Missing access key (provide Authorization: Bearer <key>, x-api-key, x-goog-api-key, or ?key=...)",
        type: "invalid_request_error",
      },
    });
    return;
  }

  if (providedKey !== serviceKey) {
    pushRequestLog({
      method: req.method,
      path: req.path,
      status: 401,
      duration: 0,
      stream: false,
      level: "warn",
      error: "Invalid access key",
    });
    res.status(401).json({ error: { message: "Invalid access key", type: "invalid_request_error" } });
    return;
  }

  next();
}

export function requireApiKeyWithQuery(req: Request, res: Response, next: NextFunction): void {
  const queryKey = req.query["key"];
  if (typeof queryKey === "string" && queryKey) {
    req.headers["authorization"] = `Bearer ${queryKey}`;
  }

  requireApiKey(req, res, next);
}
