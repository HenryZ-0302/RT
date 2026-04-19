import { type Response } from "express";
import { type Backend } from "./backendPool";
import { FriendProxyHttpError, HttpStatusError, setSseHeaders, writeAndFlush } from "./routeSupport";

export async function handleFriendJsonProxy({
  backend,
  path,
  body,
  timeoutMs = 180_000,
}: {
  backend: Extract<Backend, { kind: "friend" }>;
  path: string;
  body: unknown;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> {
  const fetchRes = await fetch(`${backend.url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!fetchRes.ok) {
    const errText = await fetchRes.text().catch(() => "unknown");
    throw new FriendProxyHttpError(fetchRes.status, `Peer backend error ${fetchRes.status}: ${errText}`);
  }
  return await fetchRes.json() as Record<string, unknown>;
}

export async function handleFriendSseProxy({
  backend,
  path,
  body,
  res,
  timeoutMs = 180_000,
}: {
  backend: Extract<Backend, { kind: "friend" }>;
  path: string;
  body: unknown;
  res: Response;
  timeoutMs?: number;
}): Promise<void> {
  const fetchRes = await fetch(`${backend.url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!fetchRes.ok) {
    const errText = await fetchRes.text().catch(() => "unknown");
    throw new FriendProxyHttpError(fetchRes.status, `Peer backend error ${fetchRes.status}: ${errText}`);
  }
  if (!fetchRes.body) {
    throw new HttpStatusError(502, "Peer backend returned no stream body.");
  }

  setSseHeaders(res);
  const reader = fetchRes.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) writeAndFlush(res, decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) writeAndFlush(res, tail);
  } finally {
    reader.releaseLock();
  }

  res.end();
}
