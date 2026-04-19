import { type Response } from "express";

export function setSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
}

export function writeAndFlush(res: Response, data: string): void {
  res.write(data);
  (res as unknown as { flush?: () => void }).flush?.();
}

function isTimeoutLikeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return err instanceof DOMException
    || /timeout|timed out|aborted|aborterror|und_err_connect_timeout/i.test(message);
}

export function normalizeImageError(err: unknown, model: string): unknown {
  if (err instanceof HttpStatusError) return err;
  if (isTimeoutLikeError(err)) {
    return new HttpStatusError(504, `Image generation timed out for '${model}'. Please retry in a moment.`);
  }
  return err;
}

export class HttpStatusError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
  }
}

export class FriendProxyHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "FriendProxyHttpError";
  }
}
