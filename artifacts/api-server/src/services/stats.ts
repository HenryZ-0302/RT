import { readJson, writeJson } from "../lib/cloudPersist";

type ModelCapability = "chat" | "image";

export interface BackendStat {
  calls: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  totalDurationMs: number;
  totalTtftMs: number;
  streamingCalls: number;
}

export interface ModelStat {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  capability?: ModelCapability;
}

const STATS_FILE = "usage_stats.json";

const EMPTY_STAT = (): BackendStat => ({
  calls: 0,
  errors: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalDurationMs: 0,
  totalTtftMs: 0,
  streamingCalls: 0,
});

const EMPTY_MODEL_STAT = (): ModelStat => ({
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
});

export function createStatsTracker(resolveCapability: (model: string) => ModelCapability) {
  const statsMap = new Map<string, BackendStat>();
  const modelStatsMap = new Map<string, ModelStat>();

  function statsToObject(): { backends: Record<string, BackendStat>; models: Record<string, ModelStat> } {
    return {
      backends: Object.fromEntries(statsMap.entries()),
      models: Object.fromEntries(modelStatsMap.entries()),
    };
  }

  async function persistStats(): Promise<void> {
    try {
      await writeJson(STATS_FILE, statsToObject());
    } catch {}
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persistStats();
    }, 2_000);
  }

  setInterval(() => {
    void persistStats();
  }, 60_000);

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      console.log(`[stats] ${sig} received, flushing stats…`);
      persistStats().finally(() => process.exit(0));
      setTimeout(() => process.exit(1), 3_000);
    });
  }

  const statsReady: Promise<void> = (async () => {
    try {
      const saved = await readJson<Record<string, unknown>>(STATS_FILE);
      if (saved && typeof saved === "object") {
        const savedRecord = saved as Record<string, unknown>;
        const backendsRaw = savedRecord.backends && typeof savedRecord.backends === "object"
          ? savedRecord.backends as Record<string, unknown>
          : savedRecord;
        const modelsRaw = savedRecord.models && typeof savedRecord.models === "object"
          ? savedRecord.models as Record<string, unknown>
          : undefined;

        for (const [label, raw] of Object.entries(backendsRaw)) {
          if (raw && typeof raw === "object" && "calls" in raw) {
            const item = raw as Record<string, unknown>;
            statsMap.set(label, {
              calls: Number(item.calls) || 0,
              errors: Number(item.errors) || 0,
              promptTokens: Number(item.promptTokens) || 0,
              completionTokens: Number(item.completionTokens) || 0,
              totalDurationMs: Number(item.totalDurationMs) || 0,
              totalTtftMs: Number(item.totalTtftMs) || 0,
              streamingCalls: Number(item.streamingCalls) || 0,
            });
          }
        }

        if (modelsRaw && typeof modelsRaw === "object") {
          for (const [model, raw] of Object.entries(modelsRaw)) {
            if (raw && typeof raw === "object") {
              const item = raw as Record<string, unknown>;
              modelStatsMap.set(model, {
                calls: Number(item.calls) || 0,
                promptTokens: Number(item.promptTokens) || 0,
                completionTokens: Number(item.completionTokens) || 0,
                capability: item.capability === "image" ? "image" : "chat",
              });
            }
          }
        }

        console.log(`[stats] loaded ${statsMap.size} backend(s), ${modelStatsMap.size} model(s) from ${STATS_FILE}`);
      }
    } catch {
      console.warn(`[stats] could not load ${STATS_FILE}, starting fresh`);
    }
  })();

  function getStat(label: string): BackendStat {
    if (!statsMap.has(label)) statsMap.set(label, EMPTY_STAT());
    return statsMap.get(label)!;
  }

  function getModelStat(model: string): ModelStat {
    if (!modelStatsMap.has(model)) {
      modelStatsMap.set(model, {
        ...EMPTY_MODEL_STAT(),
        capability: resolveCapability(model),
      });
    }

    return modelStatsMap.get(model)!;
  }

  function recordCallStat(
    label: string,
    durationMs: number,
    prompt: number,
    completion: number,
    ttftMs?: number,
    model?: string,
  ): void {
    const stat = getStat(label);
    stat.calls++;
    stat.promptTokens += prompt;
    stat.completionTokens += completion;
    stat.totalDurationMs += durationMs;

    if (ttftMs !== undefined) {
      stat.totalTtftMs += ttftMs;
      stat.streamingCalls++;
    }

    if (model) {
      const modelStat = getModelStat(model);
      modelStat.calls++;
      modelStat.promptTokens += prompt;
      modelStat.completionTokens += completion;
      modelStat.capability = resolveCapability(model);
    }

    scheduleSave();
  }

  function recordImageCallStat(label: string, durationMs: number, model: string): void {
    const stat = getStat(label);
    stat.calls++;
    stat.totalDurationMs += durationMs;

    const modelStat = getModelStat(model);
    modelStat.calls++;
    modelStat.capability = "image";

    scheduleSave();
  }

  function recordErrorStat(label: string): void {
    getStat(label).errors++;
    scheduleSave();
  }

  function getModelStatsObject(): Record<string, ModelStat> {
    return Object.fromEntries(modelStatsMap.entries());
  }

  function clearStats(): void {
    statsMap.clear();
    modelStatsMap.clear();
    scheduleSave();
  }

  return {
    statsReady,
    getStat,
    getModelStatsObject,
    recordCallStat,
    recordImageCallStat,
    recordErrorStat,
    clearStats,
  };
}
