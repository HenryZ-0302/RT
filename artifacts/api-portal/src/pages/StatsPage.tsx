import React, { useState } from "react";
import { 
  Activity, 
  RotateCw, 
  Trash2, 
  Zap, 
  DollarSign, 
  CheckCircle, 
  Server, 
  Settings2, 
  Plus, 
  Copy,
  Check
} from "lucide-react";
import { cn } from "../lib/utils";

type BackendStat = { calls: number; errors: number; streamingCalls: number; promptTokens: number; completionTokens: number; totalTokens: number; avgDurationMs: number; avgTtftMs: number | null; health: string; url?: string; dynamic?: boolean; enabled?: boolean };
type ModelStat = { calls: number; promptTokens: number; completionTokens: number };

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

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card text-card-foreground rounded-xl border border-border/50 shadow-sm p-5", className)}>
      {children}
    </div>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-sm font-bold tracking-widest text-muted-foreground uppercase mb-4", className)}>
      {children}
    </h2>
  );
}

export function StatsPage({
  baseUrl, apiKey, stats, statsError, onRefresh,
  addUrl, setAddUrl, addState, addMsg, onAddBackend, onRemoveBackend,
  onToggleBackend, onBatchToggle, onBatchRemove,
  routing, onToggleRouting, modelStats,
}: {
  baseUrl: string;
  apiKey: string;
  stats: Record<string, BackendStat> | null;
  statsError: false | "auth" | "server";
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [envPromptCopied, setEnvPromptCopied] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Constants & helper functions
  const ENV_NODE_PROMPT =
    `请在当前项目中添加一个环境变量将子节点注册为永久节点：\n\n` +
    `找没设置的空位：FRIEND_PROXY_URL → FRIEND_PROXY_URL_2 → ...\n` +
    `值为：https://你的子节点地址\n` +
    `然后重启服务器即可生效`;

  const copyEnvPrompt = () => {
    navigator.clipboard.writeText(ENV_NODE_PROMPT).then(() => {
      setEnvPromptCopied(true);
      setTimeout(() => setEnvPromptCopied(false), 2000);
    });
  };

  const resetStats = () => {
    setResetting(true);
    fetch(`${baseUrl}/api/service/metrics/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    }).then(() => { onRefresh(); setResetting(false); })
      .catch(() => setResetting(false));
  };

  const allNodes = stats ? Object.entries(stats) : [];
  const allSubNodes = allNodes.filter(([l]) => l !== "local");
  const dynamicNodes = allSubNodes.filter(([, s]) => s.dynamic);
  const allSelected = allSubNodes.length > 0 && allSubNodes.every(([l]) => selected.has(l));
  const someSelected = selected.size > 0;

  const toggleSelect = (label: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(label) ? s.delete(label) : s.add(label); return s; });

  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(allSubNodes.map(([l]) => l)));

  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();

  const totalModelCost = modelStats
    ? Object.entries(modelStats).reduce((sum, [model, ms]) => sum + estimateModelCost(model, ms.promptTokens, ms.completionTokens), 0)
    : null;

  const totalModelInputCost = modelStats
    ? Object.entries(modelStats).reduce((sum, [model, ms]) => sum + (ms.promptTokens * getModelPrice(model).input) / 1_000_000, 0)
    : null;

  const totalModelOutputCost = modelStats
    ? Object.entries(modelStats).reduce((sum, [model, ms]) => sum + (ms.completionTokens * getModelPrice(model).output) / 1_000_000, 0)
    : null;

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

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header Panel */}
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
      ) : !stats ? (
        <Card><div className="flex justify-center py-6"><Activity size={24} className="animate-pulse text-muted-foreground" /></div></Card>
      ) : (
        <>
          {/* Main Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            
            {/* API Calls */}
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

            {/* Tokens */}
            <Card className="flex flex-col border-emerald-500/10 shadow-sm border-t-2 border-t-emerald-500">
              <div className="flex items-center gap-2 text-emerald-500 mb-4 font-semibold text-sm">
                <Zap size={16} /> Token 用量
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">输入 (Prompt)</div>
                  <div className="text-2xl font-bold font-mono tracking-tight text-emerald-400">{fmt(totals!.promptTokens)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">输出 (Completion)</div>
                  <div className="text-2xl font-bold font-mono tracking-tight text-emerald-300">{fmt(totals!.completionTokens)}</div>
                </div>
              </div>
            </Card>

            {/* Success Rate */}
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
                        className="stroke-blue-500 fill-none" strokeWidth="6" strokeLinecap="round"
                        strokeDasharray={`${((totals!.calls - totals!.errors) / totals!.calls) * 150.7} 150.7`}
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground">
                    {totals!.calls > 0 ? `${Math.round(((totals!.calls - totals!.errors) / totals!.calls) * 100)}%` : "--"}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-2 h-2 rounded-full bg-blue-500"/>成功 <span className="font-bold text-foreground ml-auto">{totals!.calls - totals!.errors}</span></div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-2 h-2 rounded-full bg-destructive"/>失败 <span className="font-bold text-foreground ml-auto">{totals!.errors}</span></div>
                </div>
              </div>
            </Card>

            {/* Performance Indicators */}
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

             {/* Cost Estimate */}
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
                  <div className="flex justify-between mb-1"><span>输入开销:</span> <span>${(totalModelInputCost !== null ? totalModelInputCost : ((totals!.promptTokens * DEFAULT_PRICING.input / 1_000_000))).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>输出开销:</span> <span>${(totalModelOutputCost !== null ? totalModelOutputCost : ((totals!.completionTokens * DEFAULT_PRICING.output / 1_000_000))).toFixed(2)}</span></div>
                </div>
              </div>
            </Card>

             {/* 按模型开销 */}
             <Card className="flex flex-col border-purple-500/10 shadow-sm border-t-2 border-t-purple-500 lg:col-span-1">
              <div className="flex items-center gap-2 text-purple-500 mb-4 font-semibold text-sm">
                <Settings2 size={16} /> 按模型开销
              </div>
              {(() => {
                if (!modelStats || Object.keys(modelStats).length === 0) {
                  return <div className="text-xs text-muted-foreground flex-1 flex items-center justify-center">暂无数据</div>;
                }
                const sorted = Object.entries(modelStats)
                  .filter(([, ms]) => ms.calls > 0)
                  .map(([model, ms]) => ({ model, cost: estimateModelCost(model, ms.promptTokens, ms.completionTokens), calls: ms.calls }))
                  .sort((a, b) => b.cost - a.cost);
                if (sorted.length === 0) return <div className="text-xs text-muted-foreground flex-1 flex items-center justify-center">暂无数据</div>;
                return (
                  <div className="flex flex-col gap-2 max-h-[140px] overflow-y-auto pr-1">
                    {sorted.map(({ model, cost, calls }) => (
                      <div key={model} className="flex justify-between items-center text-[11px] gap-3">
                        <span className="text-muted-foreground font-mono truncate flex-1" title={model}>{model}</span>
                        <span className="text-foreground shrink-0">{calls}次</span>
                        <span className="text-amber-500 font-semibold shrink-0">${cost.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>

          </div>

          {/* Node Cards */}
          <div className="mt-8">
            <SectionTitle>节点统计与管理</SectionTitle>
            
            {allNodes.length === 0 ? (
              <Card className="py-12 border-dashed bg-transparent shadow-none border-border">
                <div className="flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-muted-foreground mb-3"><Server size={24} /></div>
                  <h3 className="font-semibold text-foreground mb-1">暂无额外节点</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mb-4">通过输入您的其他部署 URL，即可随时挂载节点实现自动负载均衡。</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                 {/* Bulk Actions */}
                 {someSelected && (
                    <div className="flex items-center gap-2 mb-3 bg-secondary/40 p-2 rounded-md border border-border">
                      <span className="text-xs text-muted-foreground font-medium px-2">已选 {selected.size} 项</span>
                      <button onClick={() => { onBatchToggle([...selected], true); setSelected(new Set()); }} className="text-xs px-3 py-1.5 rounded bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors border border-emerald-500/20">启用</button>
                      <button onClick={() => { onBatchToggle([...selected], false); setSelected(new Set()); }} className="text-xs px-3 py-1.5 rounded bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors border border-amber-500/20">禁用</button>
                      {[...selected].some((l) => dynamicNodes.find(([dl]) => dl === l)) && (
                         <button onClick={() => { onBatchRemove([...selected].filter((l) => dynamicNodes.find(([dl]) => dl === l))); setSelected(new Set()); }} className="text-xs px-3 py-1.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors border border-destructive/20 ml-auto mr-1">移除动态节点</button>
                      )}
                    </div>
                 )}

                {allNodes.map(([label, s]) => {
                  const isEnabled = s.enabled !== false;
                  const isChecked = selected.has(label);
                  const isHealthy = s.health === "healthy";
                  const isLocal = label === "local";
                  
                  return (
                    <div 
                       key={label}
                       onClick={() => !isLocal && toggleSelect(label)}
                       className={cn(
                         "group relative bg-card border rounded-xl overflow-hidden transition-all duration-200 shadow-sm flex flex-col",
                         isLocal ? "border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.05)] bg-indigo-500/5 cursor-default" : "cursor-pointer",
                         isChecked ? "border-primary ring-1 ring-primary/20 bg-primary/5" : "hover:border-border/80 border-border/60",
                         !isEnabled && "opacity-60 bg-muted/30 hover:bg-muted/50"
                       )}
                    >
                      {/* Top Bar */}
                      <div className="p-4 pb-3 flex flex-col md:flex-row md:items-center gap-4">
                        {/* Title Row */}
                        <div className="flex items-center gap-3 w-full md:w-auto">
                           {!isLocal ? (
                             <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(label)} onClick={e => e.stopPropagation()} className="w-4 h-4 rounded text-primary focus:ring-primary/20 cursor-pointer" />
                           ) : (
                             <div className="w-4 h-4" />
                           )}
                           <div className={cn("w-2 h-2 rounded-full flex-shrink-0 animate-in zoom-in", !isEnabled ? "bg-muted-foreground" : isHealthy ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.4)]")}/>
                           <div className="flex items-center gap-2 overflow-hidden flex-1 md:w-48">
                              <span className={cn("font-mono font-bold text-sm truncate", isLocal && "text-indigo-500")}>{label}</span>
                              {isLocal ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex-shrink-0">本地进程</span>
                              ) : s.dynamic ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 flex-shrink-0">动态</span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex-shrink-0">ENV</span>
                              )}
                           </div>
                        </div>

                        {/* URL row */}
                        <div className="font-mono text-xs text-muted-foreground truncate flex-1 md:max-w-xs xl:max-w-md hidden md:block">
                           {s.url ?? label}
                        </div>
                           
                        {/* Actions */}
                        <div className="flex items-center gap-1.5 ml-auto mt-2 md:mt-0">
                          {!isLocal && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleBackend(label, !isEnabled); }}
                              className={cn(
                                "px-2.5 py-1 text-xs rounded-md border transition-colors",
                                isEnabled ? "bg-amber-500/10 border-amber-500/20 text-amber-600 hover:bg-amber-500/20" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20"
                              )}
                            >
                              {isEnabled ? "禁用" : "启用"}
                            </button>
                          )}
                          {s.dynamic && !isLocal && (
                             <button
                               onClick={(e) => { e.stopPropagation(); onRemoveBackend(label); }}
                               className="p-1.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive hover:bg-destructive/20 transition-colors"
                             >
                               <Trash2 size={13} />
                             </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Stats Grid */}
                      <div className="px-5 py-3 md:pt-4 md:pb-4 border-t border-border/40 bg-secondary/10 grid grid-cols-4 md:grid-cols-4 xl:grid-cols-8 gap-y-4 gap-x-3 items-center">
                         <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">请求</span>
                           <span className="text-sm font-mono font-medium text-indigo-500 dark:text-indigo-400">{s.calls}</span>
                         </div>
                         <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">流式</span>
                           <span className="text-sm font-mono font-medium text-blue-500 dark:text-blue-400">{s.streamingCalls ?? 0}</span>
                         </div>
                         <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">错误</span>
                           <span className={cn("text-sm font-mono font-medium", s.errors > 0 ? "text-destructive" : "text-green-500 dark:text-green-400")}>{s.errors}</span>
                         </div>
                         <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">输入 Token</span>
                           <span className="text-sm font-mono font-medium text-emerald-500 dark:text-emerald-400">{fmt(s.promptTokens)}</span>
                         </div>
                         <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">输出 Token</span>
                           <span className="text-sm font-mono font-medium text-emerald-500 dark:text-emerald-400">{fmt(s.completionTokens)}</span>
                         </div>
                         <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">均耗时</span>
                           <span className="text-sm font-mono font-medium text-foreground text-opacity-80">{s.calls > 0 ? `${s.avgDurationMs}ms` : "--"}</span>
                         </div>
                         <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">首 Token</span>
                           <span className="text-sm font-mono font-medium text-foreground text-opacity-80">{s.avgTtftMs ? `${s.avgTtftMs}ms` : "--"}</span>
                         </div>
                         <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">开销</span>
                           <span className="text-sm font-mono font-medium text-amber-500 dark:text-amber-400">${((s.promptTokens * DEFAULT_PRICING.input + s.completionTokens * DEFAULT_PRICING.output) / 1_000_000).toFixed(2)}</span>
                         </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <div className="h-4" />

      {apiKey && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Add node widget */}
          <Card className="flex flex-col h-full shadow-sm">
            <SectionTitle className="flex items-center gap-2"><Plus size={16} /> 添加节点</SectionTitle>
            <p className="text-[13px] text-muted-foreground mb-4 flex-1">填入另一台部署在不同域名的相关节点地址，即可无缝水平扩展并智能分流请求。</p>
            
            <form onSubmit={onAddBackend} className="flex gap-2">
              <input
                type="url" required
                value={addUrl} onChange={(e) => setAddUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-foreground"
              />
              <button 
                type="submit" disabled={addState === "loading"} 
                className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shadow-sm border border-transparent blur-0"
              >
                {addState === "loading" ? "添加中…" : "添加"}
              </button>
            </form>
            {(addState === "ok" || addState === "err") && (
              <div className={cn("mt-3 text-xs p-2 rounded-md border", addState === "ok" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-destructive/10 text-destructive border-destructive/20")}>
                {addMsg}
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-border">
              <div className="text-xs font-semibold text-muted-foreground mb-2 flex justify-between items-center">
                 <span>通过环境变量添加 (ENV 永久节点)</span>
                 <button onClick={copyEnvPrompt} className="text-[10px] text-primary hover:underline flex items-center gap-1">
                    {envPromptCopied ? <Check size={10} /> : <Copy size={10} />}
                    {envPromptCopied ? "已复制" : "复制指引"}
                 </button>
              </div>
              <div className="text-[11px] text-muted-foreground/80 leading-relaxed font-mono bg-muted/40 p-2.5 rounded-lg border border-border/50 select-all border-dashed whitespace-pre-wrap">
                 {ENV_NODE_PROMPT}
              </div>
            </div>
          </Card>

          {/* Routing Settings */}
          <Card className="flex flex-col h-full shadow-sm">
             <SectionTitle className="flex items-center gap-2"><Settings2 size={16} /> 路由策略</SectionTitle>
             <p className="text-[13px] text-muted-foreground mb-4">主号(当前节点)兜底控制。子节点永远享受优先被调用的特权，用以分摊主号负载。</p>
             <div className="flex flex-col gap-3">
                {([
                  { field: "localEnabled" as const, label: "启用主号请求", desc: "关闭后，所有请求强制要求子节点执行，当前机器充当纯路由节点" },
                  { field: "localFallback" as const, label: "主号自动兜底", desc: "子节点全挂或超载时，是否回退到主号尝试执行" },
                  { field: "fakeStream" as const, label: "强制模拟流式输出", desc: "部分模型或提供商无法流式返回时，引擎在本地将其强行拉成流式动画响应" },
                ]).map(({ field, label, desc }) => (
                  <div key={field} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/60 hover:bg-secondary/50 transition-colors">
                     <div className="pr-4">
                        <div className="font-medium text-[13px] text-foreground mb-0.5">{label}</div>
                        <div className="text-[11px] text-muted-foreground leading-snug">{desc}</div>
                     </div>
                     <button
                        onClick={() => onToggleRouting(field, !routing[field])}
                        className={cn(
                          "w-10 h-5 rounded-full transition-all flex-shrink-0 relative outline-none",
                          routing[field] ? "bg-primary" : "bg-muted-foreground/30"
                        )}
                        aria-label={`Toggle ${label}`}
                     >
                        <div className={cn(
                          "w-3.5 h-3.5 bg-background rounded-full absolute top-[3px] transition-all shadow-sm",
                          routing[field] ? "left-[23px]" : "left-[3px]"
                        )} />
                     </button>
                  </div>
                ))}
             </div>
          </Card>
        </div>
      )}
      <div className="h-8" />
    </div>
  );
}
