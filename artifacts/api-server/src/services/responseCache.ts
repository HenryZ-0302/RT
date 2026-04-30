import { createHash } from "node:crypto";

export interface ResponseCacheSettings {
  enabled: boolean;
  ttlSeconds: number;
}

export interface ResponseCacheStats {
  entries: number;
  maxEntries: number;
}

export interface CachedChatResponse {
  body: unknown;
  promptTokens: number;
  completionTokens: number;
  createdAt: number;
  expiresAt: number;
}

export const RESPONSE_CACHE_DEFAULT_TTL_SECONDS = 3600;
export const RESPONSE_CACHE_MIN_TTL_SECONDS = 30;
export const RESPONSE_CACHE_MAX_TTL_SECONDS = 86_400;
export const RESPONSE_CACHE_MAX_ENTRIES = 200;

const chatResponseCache = new Map<string, CachedChatResponse>();

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function normalizeResponseCacheTtlSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return RESPONSE_CACHE_DEFAULT_TTL_SECONDS;
  return Math.max(
    RESPONSE_CACHE_MIN_TTL_SECONDS,
    Math.min(RESPONSE_CACHE_MAX_TTL_SECONDS, Math.round(parsed)),
  );
}

export function createChatResponseCacheKey(input: {
  model: string;
  messages: unknown;
  maxTokens?: number;
}): string {
  const payload = stableStringify({
    version: 1,
    model: input.model,
    messages: input.messages,
    maxTokens: input.maxTokens ?? null,
  });

  return createHash("sha256").update(payload).digest("hex");
}

export function getCachedChatResponse(key: string): CachedChatResponse | null {
  const cached = chatResponseCache.get(key);
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt) {
    chatResponseCache.delete(key);
    return null;
  }

  // Refresh insertion order so active entries are less likely to be evicted.
  chatResponseCache.delete(key);
  chatResponseCache.set(key, cached);
  return cached;
}

export function setCachedChatResponse(
  settings: ResponseCacheSettings,
  key: string,
  entry: Omit<CachedChatResponse, "createdAt" | "expiresAt">,
): void {
  if (!settings.enabled) return;

  const createdAt = Date.now();
  chatResponseCache.set(key, {
    ...entry,
    createdAt,
    expiresAt: createdAt + normalizeResponseCacheTtlSeconds(settings.ttlSeconds) * 1000,
  });

  while (chatResponseCache.size > RESPONSE_CACHE_MAX_ENTRIES) {
    const oldest = chatResponseCache.keys().next().value as string | undefined;
    if (!oldest) break;
    chatResponseCache.delete(oldest);
  }
}

export function clearResponseCache(): void {
  chatResponseCache.clear();
}

export function getResponseCacheStats(): ResponseCacheStats {
  const now = Date.now();
  for (const [key, entry] of chatResponseCache.entries()) {
    if (now >= entry.expiresAt) chatResponseCache.delete(key);
  }

  return {
    entries: chatResponseCache.size,
    maxEntries: RESPONSE_CACHE_MAX_ENTRIES,
  };
}
