import { readJson, writeJson } from "../lib/cloudPersist";
import { getServiceAccessKey } from "../lib/serviceConfig";

export type Backend =
  | { kind: "local" }
  | { kind: "friend"; label: string; url: string; apiKey: string };

export interface DynamicBackend {
  label: string;
  url: string;
  enabled?: boolean;
}

export interface RoutingSettings {
  localEnabled: boolean;
  localFallback: boolean;
  fakeStream: boolean;
}

type FriendProxyConfig = { label: string; url: string; apiKey: string };

interface HealthEntry {
  healthy: boolean;
  checkedAt: number;
}

const healthCache = new Map<string, HealthEntry>();
const HEALTH_TTL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 15_000;

let dynamicBackends: DynamicBackend[] = [];
let routingSettings: RoutingSettings = { localEnabled: true, localFallback: true, fakeStream: true };
let requestCounter = 0;

function saveDynamicBackends(list: DynamicBackend[]): void {
  writeJson("dynamic_backends.json", list).catch((err) => {
    console.error("[persist] failed to save dynamic_backends:", err);
  });
}

function normalizeSubNodeUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  if (!url) return url;
  return /\/api$/i.test(url) ? url : `${url}/api`;
}

function loadEnvBackends(apiKey: string): FriendProxyConfig[] {
  const configs: FriendProxyConfig[] = [];
  const envKeys = ["FRIEND_PROXY_URL", ...Array.from({ length: 19 }, (_, i) => `FRIEND_PROXY_URL_${i + 2}`)];

  for (const key of envKeys) {
    const raw = process.env[key];
    if (raw) {
      configs.push({
        label: key.replace("FRIEND_PROXY_URL", "FRIEND"),
        url: normalizeSubNodeUrl(raw),
        apiKey,
      });
    }
  }

  return configs;
}

export const initReady: Promise<void> = (async () => {
  const [savedBackends, savedRouting] = await Promise.all([
    readJson<DynamicBackend[]>("dynamic_backends.json").catch(() => null),
    readJson<Partial<RoutingSettings>>("routing_settings.json").catch(() => null),
  ]);

  if (Array.isArray(savedBackends)) {
    dynamicBackends = savedBackends;
    console.log(`[init] loaded ${dynamicBackends.length} dynamic backend(s)`);
  }

  if (savedRouting && typeof savedRouting === "object") {
    if (typeof savedRouting.localEnabled === "boolean") routingSettings.localEnabled = savedRouting.localEnabled;
    if (typeof savedRouting.localFallback === "boolean") routingSettings.localFallback = savedRouting.localFallback;
    if (typeof savedRouting.fakeStream === "boolean") routingSettings.fakeStream = savedRouting.fakeStream;
  }

  console.log("[init] routing settings:", JSON.stringify(routingSettings));
})();

function saveRoutingSettings(): void {
  writeJson("routing_settings.json", routingSettings).catch((err) => {
    console.error("[routing] failed to save settings:", err);
  });
}

export function getFriendProxyConfigs(): FriendProxyConfig[] {
  const apiKey = getServiceAccessKey() ?? "";
  const configs = loadEnvBackends(apiKey);
  const knownUrls = new Set(configs.map((config) => config.url));

  for (const backend of dynamicBackends) {
    const url = normalizeSubNodeUrl(backend.url);
    if (!knownUrls.has(url) && backend.enabled !== false) {
      configs.push({ label: backend.label, url, apiKey });
    }
  }

  return configs;
}

export function getAllFriendProxyConfigs(): Array<FriendProxyConfig & { enabled: boolean }> {
  const apiKey = getServiceAccessKey() ?? "";
  const configs = loadEnvBackends(apiKey).map((config) => ({ ...config, enabled: true }));
  const knownUrls = new Set(configs.map((config) => config.url));

  for (const backend of dynamicBackends) {
    const url = normalizeSubNodeUrl(backend.url);
    if (!knownUrls.has(url)) {
      configs.push({ label: backend.label, url, apiKey, enabled: backend.enabled !== false });
    }
  }

  return configs;
}

export function getDynamicBackends(): DynamicBackend[] {
  return dynamicBackends;
}

export function isDynamicBackendLabel(label: string): boolean {
  return dynamicBackends.some((backend) => backend.label === label);
}

async function probeHealth(url: string, apiKey: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const response = await fetch(`${url}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

export function getCachedHealth(url: string): boolean | null {
  const entry = healthCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.checkedAt < HEALTH_TTL_MS) return entry.healthy;
  return null;
}

export function setHealth(url: string, healthy: boolean): void {
  healthCache.set(url, { healthy, checkedAt: Date.now() });
}

function refreshHealthAsync(): void {
  const configs = getFriendProxyConfigs();
  for (const { url, apiKey } of configs) {
    if (getCachedHealth(url) === null) {
      probeHealth(url, apiKey).then((ok) => setHealth(url, ok)).catch(() => setHealth(url, false));
    }
  }
}

setTimeout(refreshHealthAsync, 2_000);
setInterval(refreshHealthAsync, HEALTH_TTL_MS);

export function buildBackendPool(): Backend[] {
  const friends: Backend[] = [];

  for (const { label, url, apiKey } of getFriendProxyConfigs()) {
    const healthy = getCachedHealth(url);
    if (healthy !== false) {
      friends.push({ kind: "friend", label, url, apiKey });
    }
  }

  if (friends.length > 0) return friends;
  if (routingSettings.localFallback && routingSettings.localEnabled) return [{ kind: "local" }];
  return [];
}

export function pickBackend(): Backend | null {
  const pool = buildBackendPool();
  if (pool.length === 0) return null;

  const backend = pool[requestCounter % pool.length];
  requestCounter++;
  return backend;
}

export function pickBackendExcluding(exclude: Set<string>): Backend | null {
  const friends = buildBackendPool().filter((backend) => backend.kind === "friend" && !exclude.has(backend.url));
  if (friends.length > 0) return friends[requestCounter % friends.length];
  if (routingSettings.localFallback && routingSettings.localEnabled) return { kind: "local" };
  return null;
}

export function getRequestCounter(): number {
  return requestCounter;
}

export function getRoutingSettings(): RoutingSettings {
  return { ...routingSettings };
}

export function updateRoutingSettings(patch: Partial<RoutingSettings>): RoutingSettings {
  if (typeof patch.localEnabled === "boolean") routingSettings.localEnabled = patch.localEnabled;
  if (typeof patch.localFallback === "boolean") routingSettings.localFallback = patch.localFallback;
  if (typeof patch.fakeStream === "boolean") routingSettings.fakeStream = patch.fakeStream;

  saveRoutingSettings();
  return getRoutingSettings();
}

export function createDynamicBackend(url: string): { label: string; url: string; source: "dynamic" } {
  const cleanUrl = url.replace(/\/+$/, "");
  const normalizedUrl = normalizeSubNodeUrl(cleanUrl);
  const allUrls = getFriendProxyConfigs().map((config) => config.url);

  if (allUrls.includes(normalizedUrl)) {
    throw new Error("URL already in pool");
  }

  const label = `DYNAMIC_${dynamicBackends.length + 1}`;
  dynamicBackends.push({ label, url: cleanUrl });
  saveDynamicBackends(dynamicBackends);

  const apiKey = getServiceAccessKey() ?? "";
  probeHealth(normalizedUrl, apiKey).then((ok) => setHealth(normalizedUrl, ok)).catch(() => setHealth(normalizedUrl, false));

  return { label, url: cleanUrl, source: "dynamic" };
}

export function deleteDynamicBackend(label: string): boolean {
  const before = dynamicBackends.length;
  dynamicBackends = dynamicBackends.filter((backend) => backend.label !== label);
  if (dynamicBackends.length === before) return false;

  saveDynamicBackends(dynamicBackends);
  return true;
}

export function updateDynamicBackend(label: string, enabled: boolean): DynamicBackend | null {
  const target = dynamicBackends.find((backend) => backend.label === label);
  if (!target) return null;

  target.enabled = enabled;
  saveDynamicBackends(dynamicBackends);
  return target;
}

export function batchUpdateDynamicBackends(labels: string[], enabled: boolean): number {
  const selected = new Set(labels);
  let updated = 0;

  for (const backend of dynamicBackends) {
    if (selected.has(backend.label)) {
      backend.enabled = enabled;
      updated++;
    }
  }

  saveDynamicBackends(dynamicBackends);
  return updated;
}
