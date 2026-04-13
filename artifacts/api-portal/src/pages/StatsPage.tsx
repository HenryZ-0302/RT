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

const DEFAULT_PRICING = { input: 3, output: 15 };

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5": { input: 2.5, output: 10 },
  "gpt-5-turbo": { input: 1.5, output: 6 },
  "gpt-5-mini": { input: 0.15, output: 0.6 },
  "gpt-5-nano": { input: 0.075, output: 0.3 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o4-mini": { input: 1.1, output: 4.4 },
  "o3": { input: 10, output: 40 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 3, output: 12 },
  "o1-pro": { input: 150, output: 600 },
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-opus-4-5": { input: 15, output: 75 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.8, output: 4 },
  "claude-3-7-sonnet": { input: 3, output: 15 },
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-opus": { input: 15, output: 75 },
  "claude-3-sonnet": { input: 3, output: 15 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "gemini-3-pro": { input: 1.25, output: 10 },
  "gemini-3.1-pro": { input: 1.25, output: 10 },
  "gemini-3-flash": { input: 0.15, output: 0.6 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "gemini-1.5-flash-8b": { input: 0.0375, output: 0.15 },
  "grok-4": { input: 3, output: 15 },
  "grok-4.1": { input: 3, output: 15 },
  "grok-4.20": { input: 3, output: 15 },
  "llama-4": { input: 0.2, output: 0.8 },
  "deepseek-v3": { input: 0.27, output: 1.1 },
  "deepseek-r1": { input: 0.55, output: 2.19 },
  "mistral-small": { input: 0.1, output: 0.3 },
  "qwen3": { input: 0.3, output: 1.2 },
  "command-a": { input: 2.5, output: 10 },
  "nova-premier": { input: 2.5, output: 10 },
  "ernie-4.5": { input: 1, output: 4 },
};

function getModelPrice(model: string): { input: number; output: number } {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  const stripped = model.replace(/^[a-z0-9_-]+\//, "");
  if (MODEL_PRICING[stripped]) return MODEL_PRICING[stripped];
  const base = stripped.replace(/-(thinking|latest|preview)$/g, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (MODEL_PRICING[base]) return MODEL_PRICING[base];
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (stripped.startsWith(key) || base.startsWith(key)) return val;
  }
  return DEFAULT_PRICING;
}

function estimateModelCost(model: string, prompt: number, completion: number): number {
  const p = getModelPrice(model);
  return (prompt * p.input + completion * p.output) / 1_000_000;
}

function inferProvider(model: string): string {
  const normalized = model.toLowerCase();
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
    ? chatModelEntries.reduce((sum, [model, ms]) => sum + estimateModelCost(model, ms.promptTokens, ms.completionTokens), 0)
    : null;

  const totalModelInputCost = modelStats
    ? chatModelEntries.reduce((sum, [model, ms]) => sum + (ms.promptTokens * getModelPrice(model).input) / 1_000_000, 0)
    : null;

  const totalModelOutputCost = modelStats
    ? chatModelEntries.reduce((sum, [model, ms]) => sum + (ms.completionTokens * getModelPrice(model).output) / 1_000_000, 0)
    : null;

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

  const estimateCostFallback = (prompt: number, completion: number) => {
    return (prompt * DEFAULT_PRICING.input + completion * DEFAULT_PRICING.output) / 1_000_000;
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
                <div className="text-xs text-muted-foreground mb-1">输入 (Prompt)</div>
                <div className="text-2xl font-bold font-mono tracking-tight text-emerald-400">{fmt(totals!.promptTokens)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">输出 (Completion)</div>
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
                      strokeDasharray={`${((totals!.calls - totals!.errors) / totals!.calls) * 150.7} 150.7`}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground">
                  {totals!.calls > 0 ? `${Math.round(((totals!.calls - totals!.errors) / totals!.calls) * 100)}%` : "--"}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-2 h-2 rounded-full bg-blue-500" />成功 <span className="font-bold text-foreground ml-auto">{totals!.calls - totals!.errors}</span></div>
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
              <DollarSign size={16} /> 预估开销
            </div>
            <div className="flex flex-col gap-4 justify-between h-full">
              <div>
                <div className="text-3xl font-bold font-mono tracking-tight text-amber-500">
                  ${(totalModelCost !== null ? totalModelCost : estimateCostFallback(totals!.promptTokens, totals!.completionTokens)).toFixed(2)}
                </div>
              </div>
              <div className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded-md border border-border/50">
                <div className="flex justify-between mb-1"><span>文本输入:</span> <span>${(totalModelInputCost ?? (totals!.promptTokens * DEFAULT_PRICING.input / 1_000_000)).toFixed(2)}</span></div>
                <div className="flex justify-between"><span>文本输出:</span> <span>${(totalModelOutputCost ?? (totals!.completionTokens * DEFAULT_PRICING.output / 1_000_000)).toFixed(2)}</span></div>
                <div className="flex justify-between mt-1"><span>图片请求:</span> <span>{imageModelEntries.reduce((sum, [, ms]) => sum + ms.calls, 0)}</span></div>
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
                  const totalCost = group.items.reduce((sum, item) => sum + (item.cost ?? 0), 0);
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
                          <span>${totalCost.toFixed(4)}</span>
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
                                  <div className="font-semibold text-foreground">{item.cost === null ? "不计 token 开销" : `$${item.cost.toFixed(4)}`}</div>
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
