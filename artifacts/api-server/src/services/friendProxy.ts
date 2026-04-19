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

export async function handleFriendChatProxy(args: {
  req: { log: { info: (message: string) => void } };
  res: Response;
  backend: Extract<Backend, { kind: "friend" }>;
  model: string;
  messages: Array<{ content: string | Array<{ type: string; text?: string }> | null }>;
  stream: boolean;
  maxTokens?: number;
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters?: unknown } }>;
  toolChoice?: unknown;
  startTime: number;
  fakeStreamEnabled: boolean;
  fakeStreamResponse: (
    res: Response,
    json: Record<string, unknown>,
    startTime: number,
  ) => Promise<{ promptTokens: number; completionTokens: number; ttftMs: number }>;
}): Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number }> {
  const {
    req,
    res,
    backend,
    model,
    messages,
    stream,
    maxTokens,
    tools,
    toolChoice,
    startTime,
    fakeStreamEnabled,
    fakeStreamResponse,
  } = args;

  const body: Record<string, unknown> = { model, messages, stream };
  body["max_tokens"] = maxTokens ?? 16000;
  if (stream) body["stream_options"] = { include_usage: true };
  if (tools?.length) body["tools"] = tools;
  if (toolChoice !== undefined) body["tool_choice"] = toolChoice;

  if (!stream) {
    const fetchRes = await fetch(`${backend.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!fetchRes.ok) {
      const errText = await fetchRes.text().catch(() => "unknown");
      throw new FriendProxyHttpError(fetchRes.status, `Peer backend error ${fetchRes.status}: ${errText}`);
    }
    const json = await fetchRes.json() as Record<string, unknown>;
    res.json(json);
    const usage = json["usage"] as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
    if ((usage?.prompt_tokens ?? 0) === 0) {
      const inputChars = messages.reduce((acc, message) => {
        if (typeof message.content === "string") return acc + message.content.length;
        if (Array.isArray(message.content)) {
          return acc + message.content
            .filter((part) => part.type === "text")
            .reduce((sum, part) => sum + (part.text?.length ?? 0), 0);
        }
        return acc;
      }, 0);
      const outputChars = (json["choices"] as Array<{ message?: { content?: string } }>)?.[0]?.message?.content?.length ?? 0;
      return { promptTokens: Math.ceil(inputChars / 4), completionTokens: Math.ceil(outputChars / 4) };
    }
    return { promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0 };
  }

  const fetchRes = await fetch(`${backend.url}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });

  if (!fetchRes.ok) {
    const errText = await fetchRes.text().catch(() => "unknown");
    throw new FriendProxyHttpError(fetchRes.status, `Peer backend error ${fetchRes.status}: ${errText}`);
  }

  const contentType = fetchRes.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && fakeStreamEnabled) {
    req.log.info("Friend returned JSON for stream request — fake-streaming");
    const json = await fetchRes.json() as Record<string, unknown>;
    const result = await fakeStreamResponse(res, json, startTime);
    if (result.promptTokens === 0) {
      const inputChars = messages.reduce((acc, message) => {
        if (typeof message.content === "string") return acc + message.content.length;
        if (Array.isArray(message.content)) {
          return acc + message.content
            .filter((part) => part.type === "text")
            .reduce((sum, part) => sum + (part.text?.length ?? 0), 0);
        }
        return acc;
      }, 0);
      const outputContent = ((json["choices"] as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ?? "").length;
      return { promptTokens: Math.ceil(inputChars / 4), completionTokens: Math.ceil(outputContent / 4), ttftMs: result.ttftMs };
    }
    return result;
  }

  setSseHeaders(res);
  const keepaliveTimer = setInterval(() => writeAndFlush(res, ": keep-alive\n\n"), 15_000);

  let promptTokens = 0;
  let completionTokens = 0;
  let ttftMs: number | undefined;
  let outputChars = 0;

  try {
    const reader = fetchRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            writeAndFlush(res, "data: [DONE]\n\n");
            continue;
          }
          try {
            const chunk = JSON.parse(data) as Record<string, unknown>;
            const usage = chunk["usage"] as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
            if (usage && typeof usage === "object") {
              promptTokens = usage.prompt_tokens ?? promptTokens;
              completionTokens = usage.completion_tokens ?? completionTokens;
            }
            const deltaContent = (chunk["choices"] as Array<{ delta?: { content?: string } }>)?.[0]?.delta?.content;
            if (deltaContent) {
              if (ttftMs === undefined) ttftMs = Date.now() - startTime;
              outputChars += deltaContent.length;
            }
            writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
          } catch {}
        }
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearInterval(keepaliveTimer);
  }

  res.end();

  if (promptTokens === 0) {
    const inputChars = messages.reduce((acc, message) => {
      if (typeof message.content === "string") return acc + message.content.length;
      if (Array.isArray(message.content)) {
        return acc + message.content
          .filter((part) => part.type === "text")
          .reduce((sum, part) => sum + (part.text?.length ?? 0), 0);
      }
      return acc;
    }, 0);
    promptTokens = Math.ceil(inputChars / 4);
    completionTokens = Math.ceil(outputChars / 4);
  }

  return { promptTokens, completionTokens, ttftMs };
}
