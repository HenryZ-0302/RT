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

  const allSubNodes = stats ? Object.entries(stats).filter(([l]) => l !== "local") : [];
  const dynamicNodes = allSubNodes.filter(([, s]) => s.dynamic);
  const allSelected = allSubNodes.length > 0 && allSubNodes.every(([l]) => selected.has(l));
  const someSelected = selected.size > 0;

  const toggleSelect = (label: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(label) ? s.delete(label) : s.add(label); return s; });

  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(allSubNodes.map(([l]) => l)));

  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();

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
             <Card className="flex flex-col border-amber-500/10 shadow-sm border-t-2 border-t-amber-500 lg:col-span-2">
              <div className="flex items-center gap-2 text-amber-500 mb-4 font-semibold text-sm">
                <DollarSign size={16} /> 预估总开销
              </div>
              <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-8 justify-between h-full">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">总计 (近似)</div>
                  <div className="text-3xl font-bold font-mono tracking-tight text-amber-500">
                    ${(estimateCostFallback(totals!.promptTokens, totals!.completionTokens)).toFixed(2)}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mb-1 md:text-right w-full max-w-[200px] bg-secondary/50 p-2 rounded-md border border-border/50">
                  <div className="flex justify-between mb-1"><span>输入开销:</span> <span>${((totals!.promptTokens * DEFAULT_PRICING.input / 1_000_000)).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>输出开销:</span> <span>${((totals!.completionTokens * DEFAULT_PRICING.output / 1_000_000)).toFixed(2)}</span></div>
                </div>
              </div>
            </Card>

          </div>

          {/* Node Cards */}
          <div className="mt-8">
            <SectionTitle>节点统计与管理</SectionTitle>
            
            {allSubNodes.length === 0 ? (
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

                {allSubNodes.map(([label, s]) => {
                  const isEnabled = s.enabled !== false;
                  const isChecked = selected.has(label);
                  const isHealthy = s.health === "healthy";
                  return (
                    <div 
                       key={label}
                       onClick={() => toggleSelect(label)}
                       className={cn(
                         "group relative bg-card border rounded-xl overflow-hidden transition-all duration-200 cursor-pointer shadow-sm",
                         isChecked ? "border-primary ring-1 ring-primary/20 bg-primary/5" : "border-border/60 hover:border-border",
                         !isEnabled && "opacity-60 bg-muted/30 hover:bg-muted/50"
                       )}
                    >
                      <div className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                        {/* Title Row */}
                        <div className="flex items-center gap-3 w-full md:w-auto">
                           <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(label)} onClick={e => e.stopPropagation()} className="w-4 h-4 rounded text-primary focus:ring-primary/20 cursor-pointer" />
                           <div className={cn("w-2 h-2 rounded-full flex-shrink-0 animate-in zoom-in", !isEnabled ? "bg-muted-foreground" : isHealthy ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.4)]")}/>
                           <div className="flex items-center gap-2 overflow-hidden flex-1 md:w-48">
                              <span className="font-mono font-bold text-sm truncate">{label}</span>
                              {s.dynamic ? (
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

                        {/* Minimal Stats */}
                        <div className="flex items-center gap-6 ml-auto mt-2 md:mt-0 text-sm pl-7 md:pl-0">
                           <div className="flex flex-col items-end">
                             <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Calls</span>
                             <span className="font-mono font-medium">{s.calls}</span>
                           </div>
                           <div className="flex flex-col items-end hidden sm:flex">
                             <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Errors</span>
                             <span className={cn("font-mono font-medium", s.errors > 0 ? "text-destructive" : "text-muted-foreground")}>{s.errors}</span>
                           </div>
                           
                           {/* Actions */}
                           <div className="flex items-center gap-1.5 ml-2">
                             <button
                               onClick={(e) => { e.stopPropagation(); onToggleBackend(label, !isEnabled); }}
                               className={cn(
                                 "px-2.5 py-1 text-xs rounded-md border transition-colors",
                                 isEnabled ? "bg-amber-500/10 border-amber-500/20 text-amber-600 hover:bg-amber-500/20" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20"
                               )}
                             >
                               {isEnabled ? "禁用" : "启用"}
                             </button>
                             {s.dynamic && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onRemoveBackend(label); }}
                                  className="p-1.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive hover:bg-destructive/20 transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                             )}
                           </div>
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
