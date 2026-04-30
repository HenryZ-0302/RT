import { type Response } from "express";
import { type Backend } from "./backendPool";
import { FriendProxyHttpError, HttpStatusError, setSseHeaders, writeAndFlush } from "./routeSupport";

function estimateTokensFromChars(chars: number): number {
  return chars > 0 ? Math.ceil(chars / 4) : 0;
}

function extractUsageCounts(payload: Record<string, unknown>): {
  promptTokens?: number;
  completionTokens?: number;
} {
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  const usage = payload["usage"] as { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } | undefined;
  if (usage && typeof usage === "object") {
    if (typeof usage.prompt_tokens === "number") promptTokens = usage.prompt_tokens;
    if (typeof usage.completion_tokens === "number") completionTokens = usage.completion_tokens;
    if (promptTokens === undefined && typeof usage.input_tokens === "number") promptTokens = usage.input_tokens;
    if (completionTokens === undefined && typeof usage.output_tokens === "number") completionTokens = usage.output_tokens;
  }

  const usageMetadata = payload["usageMetadata"] as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  } | undefined;
  if (usageMetadata && typeof usageMetadata === "object") {
    if (promptTokens === undefined && typeof usageMetadata.promptTokenCount === "number") {
      promptTokens = usageMetadata.promptTokenCount;
    }
    if (completionTokens === undefined) {
      let billableOutputTokens = 0;
      let hasBillableOutput = false;

      if (typeof usageMetadata.candidatesTokenCount === "number") {
        billableOutputTokens += usageMetadata.candidatesTokenCount;
        hasBillableOutput = true;
      }
      if (typeof usageMetadata.thoughtsTokenCount === "number") {
        billableOutputTokens += usageMetadata.thoughtsTokenCount;
        hasBillableOutput = true;
      }

      if (hasBillableOutput) completionTokens = billableOutputTokens;
    }
  }

  const message = payload["message"] as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined;
  if (message?.usage) {
    if (promptTokens === undefined && typeof message.usage.input_tokens === "number") {
      promptTokens = message.usage.input_tokens;
    }
    if (completionTokens === undefined && typeof message.usage.output_tokens === "number") {
      completionTokens = message.usage.output_tokens;
    }
  }

  return { promptTokens, completionTokens };
}

function countStreamOutputChars(payload: Record<string, unknown>): number {
  const deltaContent = (payload["choices"] as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content;
  if (typeof deltaContent === "string" && deltaContent) return deltaContent.length;

  const messageContent = (payload["choices"] as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content;
  if (typeof messageContent === "string" && messageContent) return messageContent.length;

  const delta = payload["delta"] as { text?: string; thinking?: string } | undefined;
  if (typeof delta?.text === "string" && delta.text) return delta.text.length;
  if (typeof delta?.thinking === "string" && delta.thinking) return delta.thinking.length;

  const candidates = payload["candidates"] as Array<{ content?: { parts?: Array<Record<string, unknown>> } }> | undefined;
  if (!Array.isArray(candidates)) return 0;

  let chars = 0;
  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      if (typeof part?.text === "string") chars += part.text.length;
    }
  }

  return chars;
}

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
  startTime,
  timeoutMs = 180_000,
}: {
  backend: Extract<Backend, { kind: "friend" }>;
  path: string;
  body: unknown;
  res: Response;
  startTime?: number;
  timeoutMs?: number;
}): Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number; outputChars: number }> {
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
  let promptTokens = 0;
  let completionTokens = 0;
  let ttftMs: number | undefined;
  let outputChars = 0;
  let parseBuffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      const text = decoder.decode(value, { stream: true });
      writeAndFlush(res, text);
      parseBuffer += text;

      const lines = parseBuffer.split("\n");
      parseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const payload = JSON.parse(data) as Record<string, unknown>;
          const usage = extractUsageCounts(payload);
          if (typeof usage.promptTokens === "number") promptTokens = usage.promptTokens;
          if (typeof usage.completionTokens === "number") completionTokens = usage.completionTokens;

          const chunkChars = countStreamOutputChars(payload);
          outputChars += chunkChars;
          if (ttftMs === undefined && startTime !== undefined && chunkChars > 0) {
            ttftMs = Date.now() - startTime;
          }
        } catch {}
      }
    }
    const tail = decoder.decode();
    if (tail) {
      writeAndFlush(res, tail);
      parseBuffer += tail;
    }
  } finally {
    reader.releaseLock();
  }

  res.end();
  return {
    promptTokens,
    completionTokens: completionTokens || estimateTokensFromChars(outputChars),
    ttftMs,
    outputChars,
  };
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
  ) => Promise<{ promptTokens: number; completionTokens: number; ttftMs: number; cache?: unknown }>;
}): Promise<{ promptTokens: number; completionTokens: number; ttftMs?: number; cache?: unknown }> {
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
    const usage = extractUsageCounts(json);
    let promptTokens = usage.promptTokens ?? 0;
    let completionTokens = usage.completionTokens ?? 0;
    if (promptTokens === 0 || completionTokens === 0) {
      const inputChars = messages.reduce((acc, message) => {
        if (typeof message.content === "string") return acc + message.content.length;
        if (Array.isArray(message.content)) {
          return acc + message.content
            .filter((part) => part.type === "text")
            .reduce((sum, part) => sum + (part.text?.length ?? 0), 0);
        }
        return acc;
      }, 0);
      const outputChars = countStreamOutputChars(json);
      if (promptTokens === 0) promptTokens = estimateTokensFromChars(inputChars);
      if (completionTokens === 0) completionTokens = estimateTokensFromChars(outputChars);
    }
    return { promptTokens, completionTokens };
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
    let promptTokens = result.promptTokens;
    let completionTokens = result.completionTokens;
    if (promptTokens === 0 || completionTokens === 0) {
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
      if (promptTokens === 0) promptTokens = Math.ceil(inputChars / 4);
      if (completionTokens === 0) completionTokens = Math.ceil(outputContent / 4);
    }
    return { promptTokens, completionTokens, ttftMs: result.ttftMs };
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

  if (promptTokens === 0 || completionTokens === 0) {
    const inputChars = messages.reduce((acc, message) => {
      if (typeof message.content === "string") return acc + message.content.length;
      if (Array.isArray(message.content)) {
        return acc + message.content
          .filter((part) => part.type === "text")
          .reduce((sum, part) => sum + (part.text?.length ?? 0), 0);
      }
      return acc;
    }, 0);
    if (promptTokens === 0) promptTokens = Math.ceil(inputChars / 4);
    if (completionTokens === 0) completionTokens = Math.ceil(outputChars / 4);
  }

  return { promptTokens, completionTokens, ttftMs };
}
