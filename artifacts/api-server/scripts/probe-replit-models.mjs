import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SERVER_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = resolve(API_SERVER_ROOT, "..", "..");
const REGISTRY_PATH = resolve(API_SERVER_ROOT, "src", "services", "modelRegistry.ts");
const CANDIDATES_PATH = resolve(API_SERVER_ROOT, "config", "model-probe-candidates.json");
const REPORTS_DIR = resolve(API_SERVER_ROOT, "reports");
const JSON_REPORT_PATH = resolve(REPORTS_DIR, "model-probe.latest.json");
const MARKDOWN_REPORT_PATH = resolve(REPORTS_DIR, "model-probe.latest.md");
const OPENROUTER_DIRECTORY_URL = "https://openrouter.ai/api/v1/models";
const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 180_000;

const PROVIDERS = ["openai", "anthropic", "gemini", "openrouter"];
const SUPPORTED_PROBE_KINDS = new Set(["chat", "image", "audio"]);
const PROVIDER_ENV = {
  openai: {
    apiKey: "AI_INTEGRATIONS_OPENAI_API_KEY",
    baseUrl: "AI_INTEGRATIONS_OPENAI_BASE_URL",
  },
  anthropic: {
    apiKey: "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
    baseUrl: "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
  },
  gemini: {
    apiKey: "AI_INTEGRATIONS_GEMINI_API_KEY",
    baseUrl: "AI_INTEGRATIONS_GEMINI_BASE_URL",
  },
  openrouter: {
    apiKey: "AI_INTEGRATIONS_OPENROUTER_API_KEY",
    baseUrl: "AI_INTEGRATIONS_OPENROUTER_BASE_URL",
  },
};

function parseStringArray(source, constName) {
  const match = source.match(new RegExp(`(?:export\\s+const|const)\\s+${constName}\\s*=\\s*\\[(.*?)\\];`, "s"));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function makeCandidate(provider, modelId, probeKind, options = {}) {
  return {
    provider,
    modelId,
    probeKind,
    registered: options.registered ?? false,
    sources: [...new Set(options.sources ?? [])],
  };
}

export function loadRegisteredCandidatesFromSource(source) {
  const openAiChat = parseStringArray(source, "OPENAI_CHAT_MODELS");
  const openAiImage = parseStringArray(source, "OPENAI_IMAGE_MODELS");
  const anthropicBase = parseStringArray(source, "ANTHROPIC_BASE_MODELS");
  const geminiBase = parseStringArray(source, "GEMINI_BASE_MODELS");
  const geminiImage = parseStringArray(source, "GEMINI_IMAGE_MODELS");
  const openRouterFeatured = parseStringArray(source, "OPENROUTER_FEATURED");
  const candidates = [];

  for (const modelId of openAiChat) {
    candidates.push(makeCandidate("openai", modelId, "chat", { registered: true, sources: ["registry"] }));
    if (modelId.startsWith("o")) {
      candidates.push(makeCandidate("openai", `${modelId}-thinking`, "chat", { registered: true, sources: ["registry"] }));
    }
  }

  for (const modelId of openAiImage) {
    candidates.push(makeCandidate("openai", modelId, "image", { registered: true, sources: ["registry"] }));
  }

  for (const modelId of anthropicBase) {
    candidates.push(makeCandidate("anthropic", modelId, "chat", { registered: true, sources: ["registry"] }));
    candidates.push(makeCandidate("anthropic", `${modelId}-thinking`, "chat", { registered: true, sources: ["registry"] }));
  }

  for (const modelId of geminiBase) {
    candidates.push(makeCandidate("gemini", modelId, "chat", { registered: true, sources: ["registry"] }));
    candidates.push(makeCandidate("gemini", `${modelId}-thinking`, "chat", { registered: true, sources: ["registry"] }));
  }

  for (const modelId of geminiImage) {
    candidates.push(makeCandidate("gemini", modelId, "image", { registered: true, sources: ["registry"] }));
  }

  for (const modelId of openRouterFeatured) {
    candidates.push(makeCandidate("openrouter", modelId, "chat", { registered: true, sources: ["registry"] }));
  }

  return candidates;
}

async function loadRegisteredCandidates() {
  const source = await readFile(REGISTRY_PATH, "utf8");
  return loadRegisteredCandidatesFromSource(source);
}

async function loadSupplementalCandidates() {
  const raw = await readFile(CANDIDATES_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const candidates = [];

  for (const provider of PROVIDERS) {
    const providerConfig = parsed?.[provider];
    if (!providerConfig || typeof providerConfig !== "object") continue;

    for (const [probeKind, modelIds] of Object.entries(providerConfig)) {
      if (!SUPPORTED_PROBE_KINDS.has(probeKind) || !Array.isArray(modelIds)) continue;
      for (const modelId of modelIds) {
        if (typeof modelId !== "string" || !modelId.trim()) continue;
        candidates.push(makeCandidate(provider, modelId.trim(), probeKind, { registered: false, sources: ["supplemental"] }));
      }
    }
  }

  return candidates;
}

async function fetchOpenRouterDirectoryCandidates() {
  const response = await fetch(OPENROUTER_DIRECTORY_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "RT-Model-Prober",
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter directory fetch failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const models = Array.isArray(payload?.data) ? payload.data : [];
  return models
    .map((item) => item?.id)
    .filter((item) => typeof item === "string" && item.length > 0)
    .map((modelId) => makeCandidate("openrouter", modelId, "chat", { registered: false, sources: ["openrouter-directory"] }));
}

export function mergeCandidateSets(...candidateSets) {
  const merged = new Map();

  for (const candidateSet of candidateSets) {
    for (const candidate of candidateSet) {
      const key = `${candidate.provider}:${candidate.probeKind}:${candidate.modelId}`;
      const existing = merged.get(key);
      if (existing) {
        existing.registered = existing.registered || candidate.registered;
        existing.sources = [...new Set([...existing.sources, ...(candidate.sources ?? [])])];
        continue;
      }
      merged.set(key, {
        provider: candidate.provider,
        modelId: candidate.modelId,
        probeKind: candidate.probeKind,
        registered: !!candidate.registered,
        sources: [...new Set(candidate.sources ?? [])],
      });
    }
  }

  return [...merged.values()].sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider, "en");
    if (a.probeKind !== b.probeKind) return a.probeKind.localeCompare(b.probeKind, "en");
    return a.modelId.localeCompare(b.modelId, "en");
  });
}

function extractErrorDetails(error) {
  const httpStatus = typeof error?.status === "number"
    ? error.status
    : typeof error?.statusCode === "number"
      ? error.statusCode
      : typeof error?.response?.status === "number"
        ? error.response.status
        : null;
  const code = error?.code
    ?? error?.error?.code
    ?? error?.error?.type
    ?? error?.type
    ?? null;
  const message = error?.error?.message
    ?? error?.response?.data?.error?.message
    ?? error?.response?.data?.message
    ?? error?.message
    ?? String(error);

  return {
    httpStatus,
    errorCode: typeof code === "string" ? code : code === null ? null : String(code),
    errorMessage: typeof message === "string" ? message : JSON.stringify(message),
  };
}

export function classifyProbeFailure(details) {
  const haystack = `${details.errorCode ?? ""} ${details.errorMessage ?? ""}`.toLowerCase();
  const unsupportedPhrases = [
    "unsupported_model",
    "unsupported model",
    "not a valid model id",
    "unknown model",
    "deployment not exist",
  ];
  const noAccessPhrases = [
    "publisher model not found",
  ];

  if (noAccessPhrases.some((phrase) => haystack.includes(phrase))) return "no_access";
  if (unsupportedPhrases.some((phrase) => haystack.includes(phrase))) return "unsupported";
  return "error";
}

async function probeOpenAI(runtime, candidate) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseUrl });
  if (candidate.probeKind === "image") {
    await client.images.generate({
      model: candidate.modelId,
      prompt: "Generate a simple blue square icon.",
      n: 1,
    });
    return;
  }

  if (candidate.probeKind === "audio") {
    await client.audio.speech.create({
      model: candidate.modelId,
      voice: "alloy",
      input: "Say OK.",
    });
    return;
  }

  await client.chat.completions.create({
    model: candidate.modelId,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
    max_tokens: 16,
  });
}

async function probeAnthropic(runtime, candidate) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: runtime.apiKey, baseURL: runtime.baseUrl });
  await client.messages.create({
    model: candidate.modelId,
    max_tokens: 16,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  });
}

async function probeGemini(runtime, candidate) {
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({
    apiKey: runtime.apiKey,
    httpOptions: {
      apiVersion: "",
      baseUrl: runtime.baseUrl,
    },
  });

  if (candidate.probeKind === "image") {
    const modelApi = client.models;
    if (typeof modelApi.generateImages === "function") {
      await modelApi.generateImages({
        model: candidate.modelId,
        prompt: "Generate a simple blue square icon.",
      });
      return;
    }

    await client.models.generateContent({
      model: candidate.modelId,
      contents: "Generate a simple blue square icon.",
      config: {
        responseModalities: ["IMAGE"],
      },
    });
    return;
  }

  await client.models.generateContent({
    model: candidate.modelId,
    contents: "Reply with exactly: OK",
  });
}

async function probeOpenRouter(runtime, candidate) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseUrl });
  await client.chat.completions.create({
    model: candidate.modelId,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
    max_tokens: 16,
  });
}

async function probeCandidate(candidate, runtimes) {
  const checkedAt = new Date().toISOString();
  const runtime = runtimes[candidate.provider];

  if (!runtime.configured) {
    return {
      provider: candidate.provider,
      modelId: candidate.modelId,
      probeKind: candidate.probeKind,
      status: "unconfigured",
      httpStatus: null,
      errorCode: null,
      errorMessage: `Missing ${PROVIDER_ENV[candidate.provider].apiKey} or ${PROVIDER_ENV[candidate.provider].baseUrl}.`,
      checkedAt,
      registered: candidate.registered,
      sources: candidate.sources,
    };
  }

  try {
    if (candidate.provider === "openai") await probeOpenAI(runtime, candidate);
    else if (candidate.provider === "anthropic") await probeAnthropic(runtime, candidate);
    else if (candidate.provider === "gemini") await probeGemini(runtime, candidate);
    else await probeOpenRouter(runtime, candidate);

    return {
      provider: candidate.provider,
      modelId: candidate.modelId,
      probeKind: candidate.probeKind,
      status: "available",
      httpStatus: 200,
      errorCode: null,
      errorMessage: null,
      checkedAt,
      registered: candidate.registered,
      sources: candidate.sources,
    };
  } catch (error) {
    const details = extractErrorDetails(error);
    return {
      provider: candidate.provider,
      modelId: candidate.modelId,
      probeKind: candidate.probeKind,
      status: classifyProbeFailure(details),
      httpStatus: details.httpStatus,
      errorCode: details.errorCode,
      errorMessage: details.errorMessage,
      checkedAt,
      registered: candidate.registered,
      sources: candidate.sources,
    };
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runOne() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => runOne());
  await Promise.all(workers);
  return results;
}

function buildProviderStats(results) {
  return Object.fromEntries(PROVIDERS.map((provider) => {
    const providerResults = results.filter((item) => item.provider === provider);
    return [provider, {
      total: providerResults.length,
      available: providerResults.filter((item) => item.status === "available").length,
      unsupported: providerResults.filter((item) => item.status === "unsupported").length,
      noAccess: providerResults.filter((item) => item.status === "no_access").length,
      unconfigured: providerResults.filter((item) => item.status === "unconfigured").length,
      error: providerResults.filter((item) => item.status === "error").length,
    }];
  }));
}

function formatResultLine(result) {
  const suffix = [];
  if (result.httpStatus !== null) suffix.push(`HTTP ${result.httpStatus}`);
  if (result.errorCode) suffix.push(result.errorCode);
  if (result.errorMessage) suffix.push(result.errorMessage);
  return `- \`${result.modelId}\` (${result.provider}/${result.probeKind})${suffix.length > 0 ? ` — ${suffix.join(" · ")}` : ""}`;
}

export function buildMarkdownReport({ generatedAt, configuredProviders, results, notes, providerStats }) {
  const newAvailable = results.filter((item) => item.status === "available" && !item.registered);
  const registeredUnavailable = results.filter((item) => item.registered && (item.status === "unsupported" || item.status === "no_access"));
  const reviewNeeded = results.filter((item) => item.status === "error");
  const lines = [
    "# Replit AI Integrations 模型探活报告",
    "",
    `- 生成时间: ${generatedAt}`,
    `- 已配置 provider: ${configuredProviders.length > 0 ? configuredProviders.map((item) => `\`${item}\``).join(", ") : "无"}`,
    `- 总探测数: ${results.length}`,
  ];

  if (notes.length > 0) {
    lines.push("", "## 运行备注", "");
    for (const note of notes) lines.push(`- ${note}`);
  }

  lines.push("", "## 新发现可用模型", "");
  if (newAvailable.length === 0) lines.push("- 无");
  else newAvailable.forEach((result) => lines.push(formatResultLine(result)));

  lines.push("", "## 当前注册但已不可用模型", "");
  if (registeredUnavailable.length === 0) lines.push("- 无");
  else registeredUnavailable.forEach((result) => lines.push(formatResultLine(result)));

  lines.push("", "## 探测失败待复核模型", "");
  if (reviewNeeded.length === 0) lines.push("- 无");
  else reviewNeeded.forEach((result) => lines.push(formatResultLine(result)));

  lines.push("", "## 每家 Provider 统计", "");
  for (const provider of PROVIDERS) {
    const stats = providerStats[provider];
    lines.push(`- \`${provider}\`: 总计 ${stats.total}，可用 ${stats.available}，未收录 ${stats.unsupported}，无权限 ${stats.noAccess}，未配置 ${stats.unconfigured}，异常 ${stats.error}`);
  }

  return `${lines.join("\n")}\n`;
}

function encodeWorkerPayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function decodeWorkerPayload(payload) {
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
}

function buildProbeErrorResult(candidate, message, checkedAt, extra = {}) {
  return {
    provider: candidate.provider,
    modelId: candidate.modelId,
    probeKind: candidate.probeKind,
    status: "error",
    httpStatus: null,
    errorCode: null,
    errorMessage: message,
    checkedAt,
    registered: candidate.registered,
    sources: candidate.sources,
    ...extra,
  };
}

async function probeCandidateIsolated(candidate, runtimes) {
  const checkedAt = new Date().toISOString();
  const runtime = runtimes[candidate.provider];
  if (!runtime?.configured) {
    return buildProbeErrorResult(candidate, `Missing ${PROVIDER_ENV[candidate.provider].apiKey} or ${PROVIDER_ENV[candidate.provider].baseUrl}.`, checkedAt, {
      status: "unconfigured",
      errorMessage: `Missing ${PROVIDER_ENV[candidate.provider].apiKey} or ${PROVIDER_ENV[candidate.provider].baseUrl}.`,
    });
  }

  const payload = encodeWorkerPayload({ candidate });
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [__filename, "--worker", payload], {
      cwd: WORKSPACE_ROOT,
      env: process.env,
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    });
    const output = stdout.trim();
    if (!output) {
      return buildProbeErrorResult(candidate, stderr.trim() ? `Worker produced no JSON. stderr: ${stderr.trim()}` : "Worker produced no JSON output.", checkedAt);
    }
    try {
      return JSON.parse(output);
    } catch (error) {
      const parseMessage = error instanceof Error ? error.message : String(error);
      return buildProbeErrorResult(candidate, `Worker returned invalid JSON: ${parseMessage}${stderr.trim() ? ` | stderr: ${stderr.trim()}` : ""}`, checkedAt);
    }
  } catch (error) {
    const details = extractErrorDetails(error);
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const message = stderr || details.errorMessage || "Probe worker failed";
    return buildProbeErrorResult(candidate, message, checkedAt, {
      httpStatus: details.httpStatus,
      errorCode: details.errorCode,
    });
  }
}

async function runWorkerMode() {
  const encoded = process.argv[3];
  if (!encoded) throw new Error("Missing worker payload.");
  const { candidate } = decodeWorkerPayload(encoded);
  const runtimes = Object.fromEntries(PROVIDERS.map((provider) => {
    const envConfig = PROVIDER_ENV[provider];
    const apiKey = process.env[envConfig.apiKey]?.trim() ?? "";
    const baseUrl = process.env[envConfig.baseUrl]?.trim() ?? "";
    return [provider, {
      apiKey,
      baseUrl,
      configured: Boolean(apiKey && baseUrl),
    }];
  }));
  const result = await probeCandidate(candidate, runtimes);
  process.stdout.write(JSON.stringify(result));
}

async function main() {
  console.log("[probe:models] starting model probe run");
  const registeredCandidates = await loadRegisteredCandidates();
  const supplementalCandidates = await loadSupplementalCandidates();
  const notes = [];
  let openRouterDirectoryCandidates = [];

  try {
    openRouterDirectoryCandidates = await fetchOpenRouterDirectoryCandidates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`OpenRouter directory fetch failed: ${message}`);
  }

  const candidates = mergeCandidateSets(registeredCandidates, supplementalCandidates, openRouterDirectoryCandidates);
  console.log(`[probe:models] candidate count: ${candidates.length}`);
  const runtimes = Object.fromEntries(PROVIDERS.map((provider) => {
    const envConfig = PROVIDER_ENV[provider];
    const apiKey = process.env[envConfig.apiKey]?.trim() ?? "";
    const baseUrl = process.env[envConfig.baseUrl]?.trim() ?? "";
    return [provider, {
      apiKey,
      baseUrl,
      configured: Boolean(apiKey && baseUrl),
    }];
  }));

  console.log(`[probe:models] configured providers: ${PROVIDERS.filter((provider) => runtimes[provider].configured).join(", ") || "none"}`);
  let completed = 0;
  const results = await runWithConcurrency(candidates, 4, async (candidate) => {
    const result = await probeCandidateIsolated(candidate, runtimes);
    completed++;
    if (completed === 1 || completed % 10 === 0 || completed === candidates.length) {
      console.log(`[probe:models] progress ${completed}/${candidates.length}`);
    }
    return result;
  });
  const generatedAt = new Date().toISOString();
  const configuredProviders = PROVIDERS.filter((provider) => runtimes[provider].configured);
  const providerStats = buildProviderStats(results);
  const jsonPayload = {
    generatedAt,
    configuredProviders,
    notes,
    providerStats,
    results,
  };
  const markdown = buildMarkdownReport({
    generatedAt,
    configuredProviders,
    results,
    notes,
    providerStats,
  });

  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(JSON_REPORT_PATH, `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf8");
  await writeFile(MARKDOWN_REPORT_PATH, markdown, "utf8");

  console.log(`Model probe complete. JSON: ${JSON_REPORT_PATH}`);
  console.log(`Model probe complete. Markdown: ${MARKDOWN_REPORT_PATH}`);
}

process.on("exit", (code) => {
  if (process.argv[2] !== "--worker") {
    console.log(`[probe:models] process exit ${code}`);
  }
});

process.on("unhandledRejection", (error) => {
  console.error("[probe:models] unhandledRejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("[probe:models] uncaughtException:", error);
});

if (process.argv[2] === "--worker") {
  runWorkerMode().catch((error) => {
    console.error("[probe:models:worker] failed:", error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
} else if (resolve(process.argv[1] ?? "") === __filename) {
  main().catch((error) => {
    console.error("[probe:models] failed:", error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
