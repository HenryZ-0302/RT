import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import router from "./routes";
import proxyRouter from "./routes/proxy";
import { logger } from "./lib/logger";
import { safeVersionHeader } from "./routes/update";

const app: Express = express();

// Read version once at startup and cache it as a safe ASCII-only string.
// safeVersionHeader() strips non-ASCII chars (e.g. Greek α β) that would cause
// Node.js ERR_INVALID_CHAR when writing them into an HTTP response header.
const PROXY_VERSION: string = (() => {
  const candidates = [
    resolve(process.cwd(), "version.json"),
    resolve(process.cwd(), "../../version.json"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const v = (JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? "unknown";
        return safeVersionHeader(v);
      }
    } catch {}
  }
  return "unknown";
})();

// Stamp every response with the sanitized version — safe to set as HTTP header.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Service-Version", PROXY_VERSION);
  res.setHeader("X-Proxy-Version", PROXY_VERSION);
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);
app.use("/api", proxyRouter);

export default app;
