# AI Proxy Gateway — Complete Build & Deployment Guide

> This document describes the full architecture and contains a copy-pasteable Replit Agent prompt to reproduce this project from scratch.

---

## Overview

A self-hosted OpenAI-compatible AI proxy running on Replit. Routes requests to multiple backends (Replit's own OpenAI/Anthropic integrations + up to 20 "friend" proxy nodes) with automatic round-robin load balancing, health checking, and a management web portal.

---

## Architecture

```
pnpm monorepo
├── artifacts/
│   ├── api-server/        Express + TypeScript — the actual proxy API
│   └── api-portal/        React + Vite — management portal UI
├── lib/
│   ├── api-zod/           Shared Zod schemas
│   └── integrations-*/    Replit AI integration client wrappers
└── pnpm-workspace.yaml
```

Two Replit workflows:
- `artifacts/api-server: API Server` — `pnpm --filter @workspace/api-server run dev`
- `artifacts/api-portal: web` — `pnpm --filter @workspace/api-portal run dev`

Both bind to `$PORT` (assigned automatically by Replit per artifact).

---

## Environment Setup

### Secrets (Replit Secrets tab)

| Key | Purpose |
|---|---|
| `PROXY_API_KEY` | Shared auth key for all proxy clients |
| `SESSION_SECRET` | Express session signing |

### Environment Variables (shared)

| Key | Example Value | Purpose |
|---|---|---|
| `FRIEND_PROXY_URL` | `https://friend1.replit.app` | Friend node #1 |
| `FRIEND_PROXY_URL_2` … `FRIEND_PROXY_URL_20` | `https://friend2.replit.app` | Additional friend nodes (auto-scanned) |
| `VITE_BASE_URL` | `https://your-app.replit.app` | Canonical public URL shown in portal UI |

### Replit AI Integrations (auto-provisioned)

Enable both integrations in Replit project settings. They inject:

| Key | Source |
|---|---|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Replit OpenAI integration |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Replit OpenAI integration |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Replit Anthropic integration |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Replit Anthropic integration |

---

## API Server

### Stack
- Express 4 + TypeScript
- `openai` SDK (local OpenAI / Anthropic calls only — **not** used for friend proxy calls)
- `@anthropic-ai/sdk` (local Claude calls)
- `pino` / `pino-http` (structured logging)
- `cors`, `express.json` (50 MB body limit)

### Server setup (`src/app.ts`)

```typescript
app.use(pinoHttp({ logger }));
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/api", router);   // health check at /api/healthz
app.use(proxyRouter);      // all /v1/* routes
```

### Routes

#### `GET /api/healthz`
No auth. Returns `{ status: "ok" }`. Used by the portal status badge.

#### `GET /v1/models`
Auth required. OpenAI-format model list plus `_meta` backend health summary.

```json
{
  "object": "list",
  "data": [{ "id": "gpt-4.1", "object": "model", "created": 1700000000, "owned_by": "replit-proxy" }],
  "_meta": {
    "active_backends": 3,
    "local": "healthy",
    "friends": [{ "label": "FRIEND", "url": "https://...", "status": "healthy" }]
  }
}
```

#### `POST /v1/chat/completions`
Auth required. Main proxy route. Standard OpenAI request body. Returns OpenAI response or SSE stream when `stream: true`.

#### `GET /v1/stats`
Auth required. Per-backend statistics (resets on server restart).

```json
{
  "stats": {
    "local": {
      "calls": 42, "errors": 0,
      "promptTokens": 10000, "completionTokens": 5000, "totalTokens": 15000,
      "avgDurationMs": 1200, "avgTtftMs": 450,
      "health": "healthy", "url": null, "dynamic": false
    }
  },
  "uptimeSeconds": 3600
}
```

#### `GET /v1/admin/backends`
Auth required. Lists env-defined + dynamic backends.

#### `POST /v1/admin/backends`
Auth required. `{ "url": "https://..." }` → adds dynamic backend at runtime without restart.

#### `DELETE /v1/admin/backends/:label`
Auth required. Removes a dynamic backend by label.

---

### Authentication Middleware

Accepts `PROXY_API_KEY` via:
1. `Authorization: Bearer <key>` — recommended
2. `x-goog-api-key: <key>` — Gemini-format clients
3. `?key=<key>` — URL query parameter

---

### Backend Pool & Round-Robin

```typescript
type Backend =
  | { kind: "local" }
  | { kind: "friend"; label: string; url: string; apiKey: string };

// Pool built on every request:
// 1. Add "local" if AI_INTEGRATIONS vars are set
// 2. Add each friend not cached as "down"
// 3. Add dynamic backends from dynamic_backends.json
// 4. Fallback to local-only if pool is empty

let counter = 0;
function pickBackend() { return pool[counter++ % pool.length]; }
```

**Health checking:**
- Probe: `GET /v1/models` with auth, 5s timeout
- Cache TTL: 30 seconds
- Schedule: startup (+2s) + every 30s
- Network error during real request → immediately marks friend as down

**Dynamic backends** persisted to `dynamic_backends.json` in `process.cwd()`. Survives restarts; resets on redeploy.

---

### Routing Logic (`POST /v1/chat/completions`)

```
backend = pickBackend()

if backend.kind === "friend":
    → handleFriendProxy() — raw fetch, bypasses OpenAI SDK

else if model starts with "claude-":
    → Anthropic SDK (local integration)
    → Strip -thinking / -thinking-visible suffix
    → Convert OpenAI messages → Anthropic format
    → Add thinking param if suffix was present

else:
    → OpenAI SDK (local integration), pass through directly
```

---

### Friend Proxy Handler (`handleFriendProxy`)

**Critical design: uses raw `fetch` instead of the OpenAI SDK.**

The OpenAI SDK's SSE iterator does not reliably expose `chunk.usage` when the upstream is a proxy (rather than OpenAI directly), causing token counts to always show 0. Raw fetch + manual SSE line parsing solves this.

```typescript
async function handleFriendProxy({ backend, model, messages, stream, maxTokens, ... }) {
  const body = { model, messages, stream };
  if (maxTokens) body["max_tokens"] = maxTokens;
  if (stream)    body["stream_options"] = { include_usage: true };

  const fetchRes = await fetch(`${backend.url}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  // ── Streaming ──
  if (stream) {
    setSseHeaders(res);
    const reader = fetchRes.body.getReader();
    let buf = "", promptTokens = 0, completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { writeAndFlush(res, "data: [DONE]\n\n"); continue; }
        const chunk = JSON.parse(data);
        // Capture usage from ANY chunk that carries it
        if (chunk.usage) {
          promptTokens   = chunk.usage.prompt_tokens   ?? promptTokens;
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
        }
        writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
      }
    }
    res.end();
    return { promptTokens, completionTokens };
  }

  // ── Non-streaming ──
  const json = await fetchRes.json();
  res.json(json);
  return {
    promptTokens:     json.usage?.prompt_tokens     ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
  };
}
```

---

### Claude Handling

#### Suffix stripping
```typescript
const thinkingVisible = model.endsWith("-thinking-visible");
const thinkingEnabled  = thinkingVisible || model.endsWith("-thinking");
const actualModel = thinkingVisible
  ? model.replace(/-thinking-visible$/, "")
  : thinkingEnabled
    ? model.replace(/-thinking$/, "")
    : model;
```

#### Max tokens per model
```typescript
const CLAUDE_MODEL_MAX: Record<string, number> = {
  "claude-haiku-4-5":  8096,
  "claude-sonnet-4-5": 64000,
  "claude-sonnet-4-6": 64000,
  "claude-opus-4-1":   64000,
  "claude-opus-4-5":   64000,
  "claude-opus-4-6":   64000,
  // default fallback: 32000
};
// thinking enabled → max(modelMax, 32000)
```

#### Thinking parameter
```typescript
{ thinking: { type: "enabled", budget_tokens: 16000 } }
```

#### SSE streaming (Claude → OpenAI format)

| Anthropic event | OpenAI SSE chunk emitted |
|---|---|
| `message_start` | `{ delta: { role: "assistant", content: "" } }` |
| `content_block_start` (thinking) | `<thinking>\n` as content |
| `content_block_start` (text, after thinking) | `\n</thinking>\n\n` as content |
| `content_block_delta` thinking_delta | thinking text as content |
| `content_block_delta` text_delta | text as content (records TTFT) |
| `message_delta` | finish_reason + usage |

Keepalive: `: keepalive\n\n` every 5s via `setInterval`, cleared on `req.close`.

Non-streaming: collect blocks, wrap thinking in `<thinking>…</thinking>`, join with `\n\n`, return as OpenAI JSON.

---

### Model Registry

#### OpenAI (→ local or friend)
```
gpt-5.2, gpt-5.1, gpt-5, gpt-5-mini, gpt-5-nano
gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
gpt-4o, gpt-4o-mini
o4-mini, o3, o3-mini
(o-series also get -thinking aliases, e.g. o3-thinking)
```

#### Anthropic (→ local)
```
claude-opus-4-6, claude-opus-4-5, claude-opus-4-1
claude-sonnet-4-6, claude-sonnet-4-5
claude-haiku-4-5
(each gets -thinking and -thinking-visible variants)
```

#### Gemini (listed; route via friend proxies)
```
gemini-3.1-pro-preview, gemini-3-flash-preview
gemini-2.5-pro, gemini-2.5-flash
(each gets -thinking and -thinking-visible variants)
```

#### OpenRouter (listed; route via friend proxies)
```
x-ai/grok-4.20, x-ai/grok-4.1-fast, x-ai/grok-4-fast
meta-llama/llama-4-maverick, meta-llama/llama-4-scout
deepseek/deepseek-v3.2, deepseek/deepseek-r1, deepseek/deepseek-r1-0528
mistralai/mistral-small-2603, qwen/qwen3.5-122b-a10b
google/gemini-2.5-pro, anthropic/claude-opus-4.6
```

---

## Portal (`api-portal`)

### Stack
- React 18 + Vite 7
- **Inline styles only** (no Tailwind classes, no shadcn imports)
- Dark background: `hsl(222, 47%, 11%)`

### URL strategy
```typescript
const baseUrl    = window.location.origin;                                                    // for fetch() calls
const displayUrl = (import.meta.env.VITE_BASE_URL as string | undefined) ?? window.location.origin;  // shown in UI
```

### Page sections

1. **Header** — Logo, title, live status badge (polls `/api/healthz` every 30s)
2. **Feature cards** — 6 cards in a responsive grid
3. **BASE URL card** — shows `displayUrl` with copy button
4. **API Endpoints card** — 5 routes with method badge + copy-full-URL button
5. **Auth section** — 3 auth method examples
6. **Tool calling card** — curl example with `tools` array
7. **Quick test card** — `curl GET /v1/models`
8. **Model list card** — 4 collapsible `ModelGroup` sections with badges
9. **SillyTavern guide** — step-by-step setup instructions
10. **Stats panel** — API key input, polls `/v1/stats` every 15s
11. **Add backend panel** — URL form + dynamic backend list with remove buttons

---

## Replit Agent Build Prompt

Copy and paste the following into Replit Agent to reproduce this project from scratch:

```
Build an OpenAI-compatible AI proxy gateway on Replit as a pnpm monorepo with two artifacts:
- artifacts/api-server  (Express + TypeScript backend)
- artifacts/api-portal  (React + Vite frontend)

━━━ API SERVER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Stack: Express, TypeScript, openai SDK, @anthropic-ai/sdk, pino-http, cors.
Bind to $PORT. Body limit 50 MB. Enable CORS globally.

Enable both Replit AI integrations (OpenAI + Anthropic) in project settings.
They inject: AI_INTEGRATIONS_OPENAI_API_KEY, AI_INTEGRATIONS_OPENAI_BASE_URL,
AI_INTEGRATIONS_ANTHROPIC_API_KEY, AI_INTEGRATIONS_ANTHROPIC_BASE_URL.

Secrets: PROXY_API_KEY (auth key for all clients), SESSION_SECRET.
Env: FRIEND_PROXY_URL, FRIEND_PROXY_URL_2 … FRIEND_PROXY_URL_20 (friend node base URLs).
Env: VITE_BASE_URL = https://your-app.replit.app (your deployed URL, shown in portal).

── Auth middleware ──
Accept PROXY_API_KEY via: Authorization Bearer header, x-goog-api-key header, ?key= query param.
Return 401 if missing/wrong.

── Routes ──
GET  /api/healthz                    → { status: "ok" } (no auth)
GET  /v1/models                      → OpenAI-format model list + _meta.friends health
POST /v1/chat/completions            → proxy with round-robin + SSE streaming
GET  /v1/stats                       → per-backend usage stats
GET  /v1/admin/backends              → list all backends
POST /v1/admin/backends              → add dynamic backend { url }
DELETE /v1/admin/backends/:label     → remove dynamic backend

── Backend pool ──
Build on every request:
1. Add "local" backend if AI_INTEGRATIONS_OPENAI_* vars are set
2. Scan FRIEND_PROXY_URL … FRIEND_PROXY_URL_20 → add each not cached as "down"
3. Merge dynamic backends from dynamic_backends.json (file-persisted, survives restart)
4. Fallback to local-only if pool is empty
Round-robin: counter++ % pool.length

Health check each friend: GET /v1/models with Bearer PROXY_API_KEY, 5s timeout.
Cache result 30s. Run on startup (+2s) + every 30s via setInterval.
On network error during real request → immediately mark that friend as down.

── Routing inside POST /v1/chat/completions ──

if friend backend:
    IMPORTANT: do NOT use the OpenAI SDK for friend proxy calls.
    Use raw fetch() instead, then parse SSE lines manually.
    This is the only way to reliably capture token usage from a proxy backend.

    async function handleFriendProxy({ backend, model, messages, stream, maxTokens, res, startTime }):
      Build request body: { model, messages, stream }
        add max_tokens if provided
        add stream_options: { include_usage: true } if stream=true
      fetch(`${backend.url}/v1/chat/completions`, { method: POST, Authorization Bearer, body })
      If response not ok → throw Error with status + body text

      Streaming path:
        setSseHeaders(res)
        Read body as ReadableStream with getReader()
        Decode chunks with TextDecoder, accumulate in buffer
        Split buffer on "\n", keep incomplete last line in buffer
        For each complete line starting with "data:":
          trim and slice off "data: " prefix
          if "[DONE]" → writeAndFlush "data: [DONE]\n\n", continue
          JSON.parse the data
          if chunk.usage exists → capture prompt_tokens + completion_tokens
          if first chunk with choices[0].delta.content → record TTFT
          writeAndFlush the chunk as "data: <JSON>\n\n"
        After loop: res.end(), return { promptTokens, completionTokens, ttftMs }

      Non-streaming path:
        fetchRes.json() → res.json(body)
        return usage from body.usage.prompt_tokens / completion_tokens

else if model matches any claude-* base model:
    Strip suffix before calling Anthropic:
      -thinking-visible → remove, set thinkingVisible=true
      -thinking         → remove, set thinkingEnabled=true
    Max tokens: haiku-4-5=8096; sonnet-4-5/4-6=64000; opus-4-1/4-5/4-6=64000; default=32000
    If thinking: add { thinking: { type: "enabled", budget_tokens: 16000 } }
    Convert messages: extract system role → Anthropic system string;
                      convert image_url parts → Anthropic image blocks (base64 + URL).
    Streaming: emit SSE in OpenAI chunk format.
      message_start             → { delta: { role: "assistant", content: "" } }
      content_block_start (thinking) → emit "<thinking>\n" as content
      content_block_delta thinking_delta → emit thinking text
      content_block_start (text, after thinking) → emit "\n</thinking>\n\n"
      content_block_delta text_delta → emit text; record TTFT on first
      message_delta             → emit finish_reason + usage
      keepalive: ": keepalive\n\n" every 5s via setInterval, clear on req.close
    Non-streaming: collect blocks, wrap thinking in <thinking> tags, join \n\n,
                   return as OpenAI chat completion JSON with usage.

else:
    new OpenAI({ apiKey: AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: AI_INTEGRATIONS_OPENAI_BASE_URL })
    Pass through directly using openai SDK.
    Streaming: stream_options: { include_usage: true }, for-await chunks, capture chunk.usage.
    Non-streaming: return result directly, capture result.usage.

── Stats ──
Per backend label track in-memory (resets on restart):
  calls, errors, promptTokens, completionTokens, totalDurationMs, totalTtftMs, streamingCalls
Expose via GET /v1/stats with uptimeSeconds.
avgTtftMs = totalTtftMs / streamingCalls (null if no streaming calls yet)

── Dynamic backends ──
Persist to dynamic_backends.json in process.cwd(). Load on startup.
POST: validate URL starts with http, reject duplicates, assign label DYNAMIC_N,
      save, probe health immediately.
DELETE: filter from list, save.

── Model list ──
OpenAI: gpt-5.2, gpt-5.1, gpt-5, gpt-5-mini, gpt-5-nano,
        gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-4o, gpt-4o-mini,
        o4-mini, o3, o3-mini
        (o-series also get -thinking aliases, e.g. o3-thinking, o4-mini-thinking)

Anthropic: claude-opus-4-6, claude-opus-4-5, claude-opus-4-1,
           claude-sonnet-4-6, claude-sonnet-4-5, claude-haiku-4-5
           (each gets -thinking and -thinking-visible variants)

Gemini: gemini-3.1-pro-preview, gemini-3-flash-preview,
        gemini-2.5-pro, gemini-2.5-flash
        (each gets -thinking and -thinking-visible variants)

OpenRouter: x-ai/grok-4.20, x-ai/grok-4.1-fast, x-ai/grok-4-fast,
            meta-llama/llama-4-maverick, meta-llama/llama-4-scout,
            deepseek/deepseek-v3.2, deepseek/deepseek-r1, deepseek/deepseek-r1-0528,
            mistralai/mistral-small-2603, qwen/qwen3.5-122b-a10b,
            google/gemini-2.5-pro, anthropic/claude-opus-4.6

━━━ API PORTAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Stack: React 18, Vite 7. Bind to $PORT.
IMPORTANT: Use inline styles only. No Tailwind utility classes. No shadcn component imports.
Dark background: hsl(222, 47%, 11%). Font: Inter / -apple-system.

Two URL constants in App.tsx:
  const baseUrl    = window.location.origin;
  const displayUrl = (import.meta.env.VITE_BASE_URL as string | undefined) ?? window.location.origin;
Use displayUrl for all text/copy shown to users. Use baseUrl for all fetch() calls.

── Page sections (top to bottom) ──

1. Header
   Purple gradient logo box (⚡ emoji), "AI Proxy Gateway" h1.
   Status badge (right-aligned): polls GET /api/healthz every 30s.
   States: green "在线" / red "离线" / grey "检测中".

2. Feature cards (CSS grid auto-fill minmax 260px, 6 cards)
   Multi-backend routing / Multi-format compat / Tool calling /
   Extended thinking / Multi-auth / SSE streaming.

3. BASE URL card
   Displays displayUrl in monospace code box with copy button.

4. API Endpoints card
   5 rows: method badge (GET=green, POST=indigo, DELETE=red), path, description, copy button.

5. Auth section — 3 examples: Bearer token / x-goog-api-key / ?key= query param.

6. Tool calling card — curl example showing tools array request.

7. Quick test card — curl GET /v1/models.

8. Model list card
   4 collapsible ModelGroup sections (OpenAI / Anthropic / Gemini / OpenRouter).
   Each row: model ID (monospace, copyable), description, context window tag, badge:
     tools=yellow / thinking=purple / thinking-visible=green / reasoning=pink.

9. SillyTavern setup guide — numbered steps for Base URL + API key config.

10. Stats panel
    API key input (persist to localStorage "proxy_api_key").
    Polls GET /v1/stats every 15s when key is entered.
    Per-backend: calls, errors, prompt/completion tokens, avg latency, avg TTFT, health dot.

11. Add backend panel
    URL input form → POST /v1/admin/backends with auth.
    List existing dynamic backends, each with 移除 button → DELETE /v1/admin/backends/:label.
    Refresh stats after add/remove.
```

---

## Client Usage

### SillyTavern
- Connection type: **OpenAI**
- Base URL: `https://your-app.replit.app`
- API Key: your `PROXY_API_KEY`

### CherryStudio / any OpenAI-compatible client
- API Base URL: `https://your-app.replit.app/v1`
- API Key: your `PROXY_API_KEY`

### curl — Chat
```bash
curl https://your-app.replit.app/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4.1","messages":[{"role":"user","content":"Hello"}]}'
```

### curl — List models
```bash
curl https://your-app.replit.app/v1/models \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY"
```

### curl — Add a friend node
```bash
curl https://your-app.replit.app/v1/admin/backends \
  -X POST \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://friend-proxy.replit.app"}'
```

### curl — View stats
```bash
curl https://your-app.replit.app/v1/stats \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY"
```

---

## Changelog

| Version | Change |
|---|---|
| v1 | Initial build: round-robin, health check, Claude thinking, dynamic backends |
| v2 | Expanded model list (GPT-5 series, Claude opus/sonnet 4-x, Gemini, OpenRouter) |
| v3 | New portal UI (inline styles, model registry with badges, SillyTavern guide) |
| v4 | `VITE_BASE_URL` env var so portal always shows correct deployed address |
| v5 | Friend proxy handler switched to raw `fetch` + manual SSE parsing to fix token tracking (was always 0 with SDK) |
