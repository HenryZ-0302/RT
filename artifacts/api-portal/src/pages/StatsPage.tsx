import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  RotateCw,
  Trash2,
  Zap,
  DollarSign,
  CheckCircle,
  Settings2,
  ChevronRight,
} from "lucide-react";
import { cn } from "../lib/utils";

type BackendStat = { calls: number; errors: number; streamingCalls: number; promptTokens: number; completionTokens: number; totalTokens: number; avgDurationMs: number; avgTtftMs: number | null; health: string; url?: string; dynamic?: boolean; enabled?: boolean };
type ModelStat = { calls: number; promptTokens: number; completionTokens: number; capability?: "chat" | "image" };

type ModelPricing = {
  input: number;
  output: number;
  longContextInput?: number;
  longContextOutput?: number;
  longContextThreshold?: number;
};

type ModelCostBreakdown = {
  inputCost: number;
  outputCost: number;
  totalCost: number;
};

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.4": { input: 2, output: 16 },
  "gpt-5.2": { input: 1.75, output: 14 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "o4-mini": { input: 1.1, output: 4.4 },
  "o3": { input: 2, output: 8 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gemini-3.1-pro-preview": { input: 2, output: 12, longContextInput: 4, longContextOutput: 18, longContextThreshold: 200_000 },
  "gemini-3-flash-preview": { input: 0.5, output: 3 },
  "gemini-2.5-pro": { input: 1.25, output: 10, longContextInput: 2.5, longContextOutput: 15, longContextThreshold: 200_000 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

function normalizeModelForPricing(model: string): string {
  return model.toLowerCase().replace(/-thinking$/, "");
}

function getModelPricing(model: string): ModelPricing | null {
  const normalized = normalizeModelForPricing(model);
  return MODEL_PRICING[normalized] ?? null;
}

function estimateModelCost(model: string, prompt: number, completion: number): ModelCostBreakdown | null {
  const pricing = getModelPricing(model);
  if (!pricing) return null;

  const useLongContext = typeof pricing.longContextThreshold === "number" && prompt > pricing.longContextThreshold;
  const inputRate = useLongContext ? (pricing.longContextInput ?? pricing.input) : pricing.input;
  const outputRate = useLongContext ? (pricing.longContextOutput ?? pricing.output) : pricing.output;
  const inputCost = (prompt * inputRate) / 1_000_000;
  const outputCost = (completion * outputRate) / 1_000_000;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

function formatUsd(value: number | null): string {
  if (value === null) return "--";
  if (value === 0) return "$0";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function inferProvider(model: string): string {
  const normalized = model.toLowerCase();
  if (normalized.startsWith("x-ai/")) return "xAI";
  if (normalized.startsWith("meta-llama/")) return "Meta";
  if (normalized.startsWith("mistralai/")) return "Mistral";
  if (normalized.startsWith("google/")) return "Google";
  if (normalized.startsWith("anthropic/")) return "Anthropic";
  if (normalized.startsWith("deepseek/")) return "DeepSeek";
  if (normalized.startsWith("qwen/")) return "Qwen";
  if (normalized.startsWith("cohere/")) return "Cohere";
  if (normalized.startsWith("amazon/")) return "Amazon";
  if (normalized.startsWith("baidu/")) return "Baidu";
  if (normalized.startsWith("gpt") || normalized.startsWith("o1") || normalized.startsWith("o3") || normalized.startsWith("o4")) return "OpenAI";
  if (normalized.startsWith("claude")) return "Anthropic";
  if (normalized.startsWith("gemini")) return "Google";
  if (normalized.startsWith("grok")) return "xAI";
  if (normalized.startsWith("deepseek")) return "DeepSeek";
  if (normalized.startsWith("llama")) return "Meta";
  if (normalized.startsWith("mistral")) return "Mistral";
  if (normalized.startsWith("qwen")) return "Qwen";
  if (normalized.startsWith("command")) return "Cohere";
  if (normalized.startsWith("nova")) return "Amazon";
  if (normalized.startsWith("ernie")) return "Baidu";
  if (normalized.includes("/")) return normalized.split("/")[0];
  return "Other";
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card text-card-foreground rounded-xl border border-border/50 shadow-sm p-5", className)}>
      {children}
    </div>
  );
}

export function StatsPage({
  baseUrl, apiKey, stats, statsError, onRefresh, modelStats,
}: {
  baseUrl: string;
  apiKey: string;
  stats: Record<string, BackendStat> | null;
  statsError: false | "auth" | "server" | "network";
  onRefresh: () => void;
  addUrl: string;
  setAddUrl: (u: string) => void;
  addState: "idle" | "loading" | "ok" | "err";
  addMsg: string;
  onAddBackend: (e: React.FormEvent) => void;
  onRemoveBackend: (label: string) => void;
  onToggleBackend: (label: string, enabled: boolean) => void;
  onBatchToggle: (labels: string[], enabled: boolean) => void;
  onBatchRemove: (labels: string[]) => void;
  routing: { localEnabled: boolean; localFallback: boolean; fakeStream: boolean };
  onToggleRouting: (field: "localEnabled" | "localFallback" | "fakeStream", value: boolean) => void;
  modelStats: Record<string, ModelStat> | null;
}) {
  const [resetting, setResetting] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});

  const resetStats = () => {
    if (!window.confirm("确认要重置全部统计数据吗？此操作会清空当前累计统计。")) return;
    setResetting(true);
    fetch(`${baseUrl}/api/service/metrics/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    }).then(() => { onRefresh(); setResetting(false); })
      .catch(() => setResetting(false));
  };

  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();

  const chatModelEntries = modelStats
    ? Object.entries(modelStats).filter(([, ms]) => (ms.capability ?? "chat") !== "image")
    : [];

  const imageModelEntries = modelStats
    ? Object.entries(modelStats).filter(([, ms]) => ms.capability === "image")
    : [];

  const totalModelCost = modelStats
    ? chatModelEntries.reduce((sum, [model, ms]) => sum + (estimateModelCost(model, ms.promptTokens, ms.completionTokens)?.totalCost ?? 0), 0)
    : null;

  const totalModelInputCost = modelStats
    ? chatModelEntries.reduce((sum, [model, ms]) => sum + (estimateModelCost(model, ms.promptTokens, ms.completionTokens)?.inputCost ?? 0), 0)
    : null;

  const totalModelOutputCost = modelStats
    ? chatModelEntries.reduce((sum, [model, ms]) => sum + (estimateModelCost(model, ms.promptTokens, ms.completionTokens)?.outputCost ?? 0), 0)
    : null;

  const unpricedChatModelCount = chatModelEntries.filter(([model, ms]) => ms.calls > 0 && !getModelPricing(model)).length;

  const hasModelStats = chatModelEntries.some(([, ms]) => ms.calls > 0) || imageModelEntries.some(([, ms]) => ms.calls > 0);

  const groupedModelEntries = useMemo(() => {
    if (!modelStats) return [];

    const allEntries = Object.entries(modelStats)
      .filter(([, ms]) => ms.calls > 0)
      .map(([model, ms]) => {
        const capability = ms.capability ?? "chat";
        return {
          model,
          provider: inferProvider(model),
          capability,
          calls: ms.calls,
          promptTokens: ms.promptTokens,
          completionTokens: ms.completionTokens,
          totalTokens: ms.promptTokens + ms.completionTokens,
          cost: capability === "image" ? null : estimateModelCost(model, ms.promptTokens, ms.completionTokens),
        };
      });

    const grouped = new Map<string, typeof allEntries>();
    for (const entry of allEntries) {
      const items = grouped.get(entry.provider) ?? [];
      items.push(entry);
      grouped.set(entry.provider, items);
    }

    return Array.from(grouped.entries())
      .map(([provider, items]) => ({
        provider,
        items: items.sort((a, b) => {
          if (a.capability !== b.capability) return a.capability === "chat" ? -1 : 1;
          return b.calls - a.calls;
        }),
      }))
      .sort((a, b) => b.items.reduce((sum, item) => sum + item.calls, 0) - a.items.reduce((sum, item) => sum + item.calls, 0));
  }, [modelStats]);

  const toggleProvider = (provider: string) => {
    setExpandedProviders((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const totals = stats ? Object.values(stats).reduce((acc, s) => ({
    calls: acc.calls + s.calls,
    errors: acc.errors + s.errors,
    streamingCalls: acc.streamingCalls + (s.streamingCalls ?? 0),
    promptTokens: acc.promptTokens + s.promptTokens,
    completionTokens: acc.completionTokens + s.completionTokens,
    totalTokens: acc.totalTokens + s.totalTokens,
    totalDuration: acc.totalDuration + (s.avgDurationMs * s.calls),
    totalTtft: acc.totalTtft + ((s.avgTtftMs ?? 0) * (s.streamingCalls ?? 0)),
    totalStreamCalls: acc.totalStreamCalls + (s.streamingCalls ?? 0),
  }), { calls: 0, errors: 0, streamingCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, totalDuration: 0, totalTtft: 0, totalStreamCalls: 0 }) : null;

  const successfulCalls = totals ? Math.max(0, totals.calls - totals.errors) : 0;
  const successRate = totals && totals.calls > 0
    ? Math.max(0, Math.min(1, successfulCalls / totals.calls))
    : null;

  useEffect(() => {
    if (!apiKey) return;
    onRefresh();
  }, [apiKey, onRefresh]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 bg-gradient-to-b from-primary to-primary/50 rounded-full" />
          <h1 className="text-xl font-bold">统计面板</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors border border-border"
          >
            <RotateCw size={14} className="hover:animate-spin" /> 刷新
          </button>
          <button
            onClick={resetStats}
            disabled={resetting || !apiKey}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={14} /> 重置
          </button>
        </div>
      </div>

      {!apiKey ? (
        <Card><p className="text-sm text-muted-foreground m-0">请先在首页填入 API Key 后查看统计。</p></Card>
      ) : statsError === "server" ? (
        <Card><p className="text-sm text-destructive m-0">服务器未配置 SERVICE_ACCESS_KEY — 请运行配置助手完成初始化。</p></Card>
      ) : statsError === "auth" ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <div className="font-semibold text-destructive mb-1">认证失败（API Key 不匹配）</div>
          <div className="text-sm text-muted-foreground mb-2">首页填入的 API Key 需与配置时设定的密码完全一致。</div>
          <div className="text-xs text-muted-foreground/80">
            如果忘记了密码，请在环境 Secrets 面板中查看 <code className="bg-destructive/10 text-destructive px-1 py-0.5 rounded ml-1">SERVICE_ACCESS_KEY</code>
          </div>
        </Card>
      ) : statsError === "network" ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <div className="font-semibold text-amber-600 mb-1">网络波动，统计暂时加载失败</div>
          <div className="text-sm text-muted-foreground">这次失败更像是连接抖动或超时，不代表 API Key 错误。你可以直接点右上角“刷新”再试一次。</div>
        </Card>
      ) : !stats ? (
        <Card><div className="flex justify-center py-6"><Activity size={24} className="animate-pulse text-muted-foreground" /></div></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="flex flex-col border-indigo-500/10 shadow-sm border-t-2 border-t-indigo-500">
            <div className="flex items-center gap-2 text-indigo-500 mb-4 font-semibold text-sm">
              <Activity size={16} /> 使用统计
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">请求次数</div>
                <div className="text-2xl font-bold font-mono tracking-tight text-indigo-400">{totals!.calls}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">流式请求</div>
                <div className="text-2xl font-bold font-mono tracking-tight text-indigo-300">{totals!.streamingCalls}</div>
              </div>
            </div>
          </Card>

            <Card className="flex flex-col border-emerald-500/10 shadow-sm border-t-2 border-t-emerald-500">
            <div className="flex items-center gap-2 text-emerald-500 mb-4 font-semibold text-sm">
              <Zap size={16} /> Token 用量
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">输入</div>
                <div className="text-2xl font-bold font-mono tracking-tight text-emerald-400">{fmt(totals!.promptTokens)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">输出</div>
                <div className="text-2xl font-bold font-mono tracking-tight text-emerald-300">{fmt(totals!.completionTokens)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">总 Token</div>
                <div className="text-2xl font-bold font-mono tracking-tight text-emerald-500">{fmt(totals!.totalTokens)}</div>
              </div>
            </div>
          </Card>

            <Card className="flex flex-col border-blue-500/10 shadow-sm border-t-2 border-t-blue-500">
            <div className="flex items-center gap-2 text-blue-500 mb-4 font-semibold text-sm">
              <CheckCircle size={16} /> 成功率
            </div>
            <div className="flex items-center gap-5">
              <div className="relative w-14 h-14 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="28" cy="28" r="24" className="stroke-secondary fill-none" strokeWidth="6" />
                  {totals!.calls > 0 && (
                    <circle
                      cx="28" cy="28" r="24"
                      className="stroke-blue-500 fill-none"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${(successRate ?? 0) * 150.7} 150.7`}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground">
                  {successRate !== null ? `${Math.round(successRate * 100)}%` : "--"}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-2 h-2 rounded-full bg-blue-500" />成功 <span className="font-bold text-foreground ml-auto">{successfulCalls}</span></div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-2 h-2 rounded-full bg-destructive" />失败 <span className="font-bold text-foreground ml-auto">{totals!.errors}</span></div>
              </div>
            </div>
          </Card>

            <Card className="flex flex-col border-rose-500/10 shadow-sm border-t-2 border-t-rose-500 lg:col-span-1">
            <div className="flex items-center gap-2 text-rose-500 mb-4 font-semibold text-sm">
              <Zap size={16} /> 性能指标
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">平均耗时</div>
                <div className="text-xl font-bold font-mono tracking-tight text-foreground">
                  {totals!.calls > 0 ? `${Math.round(totals!.totalDuration / totals!.calls)}ms` : "--"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">平均 TTFT</div>
                <div className="text-xl font-bold font-mono tracking-tight text-foreground">
                  {totals!.totalStreamCalls > 0 ? `${Math.round(totals!.totalTtft / totals!.totalStreamCalls)}ms` : "--"}
                </div>
              </div>
            </div>
          </Card>

            <Card className="flex flex-col border-amber-500/10 shadow-sm border-t-2 border-t-amber-500 lg:col-span-1">
            <div className="flex items-center gap-2 text-amber-500 mb-4 font-semibold text-sm">
              <DollarSign size={16} /> 计费参考
            </div>
            <div className="flex flex-col gap-4 justify-between h-full">
              <div>
                <div className="text-3xl font-bold font-mono tracking-tight text-amber-500">
                  {formatUsd(totalModelCost)}
                </div>
              </div>
              <div className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded-md border border-border/50">
                <div className="flex justify-between mb-1"><span>文本输入:</span> <span>{formatUsd(totalModelInputCost)}</span></div>
                <div className="flex justify-between"><span>文本输出:</span> <span>{formatUsd(totalModelOutputCost)}</span></div>
                <div className="flex justify-between mt-1"><span>图片请求:</span> <span>{imageModelEntries.reduce((sum, [, ms]) => sum + ms.calls, 0)}</span></div>
                <div className="flex justify-between mt-1"><span>未计价文本模型:</span> <span>{unpricedChatModelCount}</span></div>
                <div className="mt-2 text-[11px] leading-relaxed">
                  Token 统计优先使用 provider 返回的 usage；Gemini thinking token 按计费口径并入输出。缺失时才按字符估算。计费仅按已知官方文本模型单价估算，未计入 cached input、web search、tool 等附加费用；OpenRouter 与未映射模型不强行套统一价格。
                </div>
              </div>
            </div>
          </Card>
          </div>

          <Card>
            <div className="flex items-center gap-2 mb-4 text-primary">
              <Settings2 size={18} />
              <h2 className="text-sm font-bold tracking-widest uppercase">模型明细</h2>
            </div>

            {!groupedModelEntries.length ? (
              <div className="text-sm text-muted-foreground">暂无模型调用数据。</div>
            ) : (
              <div className="space-y-3">
                {groupedModelEntries.map((group) => {
                  const totalCalls = group.items.reduce((sum, item) => sum + item.calls, 0);
                  const totalCost = group.items.reduce((sum, item) => sum + (item.cost?.totalCost ?? 0), 0);
                  const pricedItems = group.items.filter((item) => item.cost !== null).length;
                  const isOpen = !!expandedProviders[group.provider];

                  return (
                    <div key={group.provider} className="rounded-xl border border-border/50 bg-background/50 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleProvider(group.provider)}
                        className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-secondary/40 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <ChevronRight size={16} className={cn("text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                          <div>
                            <div className="font-semibold text-sm">{group.provider}</div>
                            <div className="text-xs text-muted-foreground">{group.items.length} 个模型</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                          <span>{totalCalls} 次调用</span>
                          <span>{pricedItems > 0 ? formatUsd(totalCost) : "未计价"}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-border/50 divide-y divide-border/40">
                          {group.items.map((item) => (
                            <div key={item.model} className="px-4 py-3 bg-card/40">
                              <div className="flex items-center justify-between gap-4 mb-2">
                                <div className="font-mono text-sm text-foreground break-all">{item.model}</div>
                                <span className={cn(
                                  "text-[10px] px-2 py-1 rounded-full border shrink-0",
                                  item.capability === "image"
                                    ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                                )}>
                                  {item.capability === "image" ? "图片" : "文本"}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                                <div>
                                  <div className="text-muted-foreground mb-1">调用次数</div>
                                  <div className="font-semibold text-foreground">{item.calls}</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-1">输入 Token</div>
                                  <div className="font-semibold text-foreground">{fmt(item.promptTokens)}</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-1">输出 Token</div>
                                  <div className="font-semibold text-foreground">{fmt(item.completionTokens)}</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-1">总 Token</div>
                                  <div className="font-semibold text-foreground">{fmt(item.totalTokens)}</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-1">预估开销</div>
                                  <div className="font-semibold text-foreground">
                                    {item.cost === null ? "官方价格缺失" : formatUsd(item.cost.totalCost)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
