import { type Request, type Response } from "express";

type ModelCapability = "chat" | "image";

export interface RequestLog {
  id: number;
  time: string;
  method: string;
  path: string;
  model?: string;
  capability?: ModelCapability;
  backend?: string;
  status: number;
  duration: number;
  stream: boolean;
  promptTokens?: number;
  completionTokens?: number;
  level: "info" | "warn" | "error";
  error?: string;
}

const REQUEST_LOG_MAX = 200;
const requestLogs: RequestLog[] = [];
let logIdCounter = 0;
const logSSEClients: Set<Response> = new Set();

export function pushRequestLog(entry: Omit<RequestLog, "id" | "time">): void {
  const log: RequestLog = { id: ++logIdCounter, time: new Date().toISOString(), ...entry };
  requestLogs.push(log);
  if (requestLogs.length > REQUEST_LOG_MAX) requestLogs.shift();

  const data = `data: ${JSON.stringify(log)}\n\n`;
  for (const client of logSSEClients) {
    try {
      client.write(data);
    } catch {
      logSSEClients.delete(client);
    }
  }
}

export function sendLogs(_req: Request, res: Response): void {
  res.json({ logs: requestLogs });
}

export function streamLogs(req: Request, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  logSSEClients.add(res);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    logSSEClients.delete(res);
  });
}
