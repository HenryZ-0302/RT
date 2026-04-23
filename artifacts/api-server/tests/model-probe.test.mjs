import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarkdownReport,
  classifyProbeFailure,
  loadRegisteredCandidatesFromSource,
  mergeCandidateSets,
} from "../scripts/probe-replit-models.mjs";

test("loadRegisteredCandidatesFromSource expands derived thinking aliases", () => {
  const source = `
    export const OPENAI_CHAT_MODELS = ["o3", "gpt-5.4"];
    const OPENAI_IMAGE_MODELS = ["gpt-image-1"];
    const ANTHROPIC_BASE_MODELS = ["claude-opus-4-7"];
    export const GEMINI_BASE_MODELS = ["gemini-2.5-pro"];
    export const GEMINI_IMAGE_MODELS = ["gemini-2.5-flash-image"];
    const OPENROUTER_FEATURED = ["openai/gpt-4o-search-preview"];
  `;
  const candidates = loadRegisteredCandidatesFromSource(source);
  const ids = candidates.map((item) => item.modelId);

  assert.ok(ids.includes("o3-thinking"));
  assert.ok(ids.includes("claude-opus-4-7-thinking"));
  assert.ok(ids.includes("gemini-2.5-pro-thinking"));
  assert.ok(ids.includes("gpt-image-1"));
  assert.ok(ids.includes("openai/gpt-4o-search-preview"));
});

test("mergeCandidateSets deduplicates and keeps source metadata", () => {
  const merged = mergeCandidateSets(
    [{ provider: "openrouter", modelId: "qwen/test", probeKind: "chat", registered: true, sources: ["registry"] }],
    [{ provider: "openrouter", modelId: "qwen/test", probeKind: "chat", registered: false, sources: ["supplemental"] }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].registered, true);
  assert.deepEqual(merged[0].sources.sort(), ["registry", "supplemental"]);
});

test("classifyProbeFailure maps unsupported and no-access errors", () => {
  assert.equal(
    classifyProbeFailure({ errorCode: "UNSUPPORTED_MODEL", errorMessage: "Model is unsupported" }),
    "unsupported",
  );
  assert.equal(
    classifyProbeFailure({ errorCode: null, errorMessage: "404 Publisher Model not found" }),
    "no_access",
  );
  assert.equal(
    classifyProbeFailure({ errorCode: null, errorMessage: "socket hang up" }),
    "error",
  );
});

test("buildMarkdownReport renders key sections", () => {
  const markdown = buildMarkdownReport({
    generatedAt: "2026-04-22T00:00:00.000Z",
    configuredProviders: ["openai", "gemini"],
    notes: ["OpenRouter directory fetch failed: HTTP 500"],
    providerStats: {
      openai: { total: 1, available: 1, unsupported: 0, noAccess: 0, unconfigured: 0, error: 0 },
      anthropic: { total: 1, available: 0, unsupported: 1, noAccess: 0, unconfigured: 0, error: 0 },
      gemini: { total: 1, available: 0, unsupported: 0, noAccess: 0, unconfigured: 0, error: 1 },
      openrouter: { total: 0, available: 0, unsupported: 0, noAccess: 0, unconfigured: 0, error: 0 },
    },
    results: [
      { provider: "openai", modelId: "gpt-5.4", probeKind: "chat", status: "available", registered: false, httpStatus: 200, errorCode: null, errorMessage: null },
      { provider: "anthropic", modelId: "claude-x", probeKind: "chat", status: "unsupported", registered: true, httpStatus: 404, errorCode: null, errorMessage: "Unknown model" },
      { provider: "gemini", modelId: "gemini-y", probeKind: "chat", status: "error", registered: false, httpStatus: 502, errorCode: null, errorMessage: "upstream timeout" },
    ],
  });

  assert.match(markdown, /新发现可用模型/);
  assert.match(markdown, /当前注册但已不可用模型/);
  assert.match(markdown, /探测失败待复核模型/);
  assert.match(markdown, /OpenRouter directory fetch failed/);
});
