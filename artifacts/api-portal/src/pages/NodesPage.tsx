import React, { useState } from "react";
import {
  Server,
  Settings2,
  Plus,
  Copy,
  Check,
  Trash2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { FleetManager } from "../components/FleetManager";

type BackendStat = {
  calls: number;
  errors: number;
  streamingCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  avgTtftMs: number | null;
  health: string;
  url?: string;
  dynamic?: boolean;
  enabled?: boolean;
};

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

export function NodesPage({
  apiKey,
  stats,
  addUrl,
  setAddUrl,
  addState,
  addMsg,
  onAddBackend,
  onRemoveBackend,
  onToggleBackend,
  onBatchToggle,
  onBatchRemove,
  routing,
  onToggleRouting,
}: {
  apiKey: string;
  stats: Record<string, BackendStat> | null;
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
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [envPromptCopied, setEnvPromptCopied] = useState(false);

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

  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();

  const allNodes = stats ? Object.entries(stats) : [];
  const allSubNodes = allNodes.filter(([label]) => label !== "local");
  const dynamicNodes = allSubNodes.filter(([, value]) => value.dynamic);
  const allSelected = allSubNodes.length > 0 && allSubNodes.every(([label]) => selected.has(label));
  const someSelected = selected.size > 0;
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  const toggleSelect = (label: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(allSubNodes.map(([label]) => label)));

  const toggleExpanded = (label: string) =>
    setExpandedNodes((prev) => ({ ...prev, [label]: !prev[label] }));

  const localNode = allNodes.find(([label]) => label === "local") ?? null;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-1.5 h-6 bg-gradient-to-b from-primary to-primary/50 rounded-full" />
        <h1 className="text-xl font-bold">子节点</h1>
      </div>

      {!apiKey ? (
        <Card>
          <p className="text-sm text-muted-foreground m-0">请先在首页填入 API Key 后管理子节点。</p>
        </Card>
      ) : (
        <>
          <div>
            <SectionTitle>主节点</SectionTitle>

            {localNode ? (
              (() => {
                const [, value] = localNode;
                const isEnabled = value.enabled !== false;
                const isHealthy = value.health === "healthy";
                const expanded = !!expandedNodes.local;
                const successCalls = Math.max(0, value.calls - value.errors);

                return (
                  <div className="rounded-xl border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.05)] bg-indigo-500/5 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleExpanded("local")}
                      className="w-full p-4 text-left"
                    >
                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <div className="flex items-center gap-3 w-full md:w-auto">
                          <div className={cn("w-2 h-2 rounded-full flex-shrink-0", !isEnabled ? "bg-muted-foreground" : isHealthy ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.4)]")} />
                          <div className="flex items-center gap-2 overflow-hidden flex-1 md:w-48">
                            <span className="font-mono font-bold text-sm truncate text-indigo-500">当前节点</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex-shrink-0">本地进程</span>
                          </div>
                        </div>

                        <span className="font-mono text-xs text-muted-foreground truncate flex-1 min-w-[150px]" title={value.url ?? window.location.origin}>
                          {value.url ?? window.location.origin}
                        </span>

                        <div className="flex items-center gap-1.5 ml-auto mt-2 md:mt-0">
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); onToggleBackend("local", !isEnabled); }}
                            className={cn(
                              "px-2.5 py-1 text-xs rounded-md border transition-colors",
                              isEnabled ? "bg-amber-500/10 border-amber-500/20 text-amber-600 hover:bg-amber-500/20" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20",
                            )}
                          >
                            {isEnabled ? "禁用" : "启用"}
                          </button>
                        </div>
                      </div>

                      <div className="px-1 pt-4 grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-3 items-center">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">请求</span>
                          <span className="text-sm font-mono font-medium text-indigo-500 dark:text-indigo-400">{value.calls}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">成功</span>
                          <span className="text-sm font-mono font-medium text-green-500 dark:text-green-400">{successCalls}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">失败</span>
                          <span className={cn("text-sm font-mono font-medium", value.errors > 0 ? "text-destructive" : "text-green-500 dark:text-green-400")}>{value.errors}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">总 Token</span>
                          <span className="text-sm font-mono font-medium text-emerald-500 dark:text-emerald-400">{fmt(value.totalTokens)}</span>
                        </div>
                      </div>
                    </button>

                    {expanded && (
                      <div className="px-5 py-4 border-t border-border/40 bg-secondary/10 grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-3 items-center">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">流式</span>
                          <span className="text-sm font-mono font-medium text-blue-500 dark:text-blue-400">{value.streamingCalls ?? 0}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">输入 Token</span>
                          <span className="text-sm font-mono font-medium text-emerald-500 dark:text-emerald-400">{fmt(value.promptTokens)}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">输出 Token</span>
                          <span className="text-sm font-mono font-medium text-emerald-500 dark:text-emerald-400">{fmt(value.completionTokens)}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">均耗时</span>
                          <span className="text-sm font-mono font-medium text-foreground text-opacity-80">{value.calls > 0 ? `${value.avgDurationMs}ms` : "--"}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">首 Token</span>
                          <span className="text-sm font-mono font-medium text-foreground text-opacity-80">{value.avgTtftMs ? `${value.avgTtftMs}ms` : "--"}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">开销</span>
                          <span className="text-sm font-mono font-medium text-amber-500 dark:text-amber-400">${((value.promptTokens * DEFAULT_PRICING.input + value.completionTokens * DEFAULT_PRICING.output) / 1_000_000).toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <Card>
                <p className="text-sm text-muted-foreground m-0">当前节点信息暂不可用。</p>
              </Card>
            )}
          </div>

          <div>
            <SectionTitle>子节点</SectionTitle>

            {allSubNodes.length === 0 ? (
              <Card className="py-12 border-dashed bg-transparent shadow-none border-border">
                <div className="flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-muted-foreground mb-3"><Server size={24} /></div>
                  <h3 className="font-semibold text-foreground mb-1">暂未添加子节点</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mb-4">通过输入其他部署 URL，即可挂载节点实现自动负载均衡。</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-xs px-3 py-1.5 rounded-md border border-border bg-secondary/40 text-muted-foreground hover:bg-secondary/60 transition-colors"
                  >
                    {allSelected ? "取消全选" : "全选子节点"}
                  </button>
                  {someSelected && (
                    <div className="flex items-center gap-2 bg-secondary/40 p-2 rounded-md border border-border">
                      <span className="text-xs text-muted-foreground font-medium px-2">已选 {selected.size} 项</span>
                      <button onClick={() => { onBatchToggle([...selected], true); setSelected(new Set()); }} className="text-xs px-3 py-1.5 rounded bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors border border-emerald-500/20">启用</button>
                      <button onClick={() => { onBatchToggle([...selected], false); setSelected(new Set()); }} className="text-xs px-3 py-1.5 rounded bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors border border-amber-500/20">禁用</button>
                      {[...selected].some((label) => dynamicNodes.find(([dynamicLabel]) => dynamicLabel === label)) && (
                        <button onClick={() => { onBatchRemove([...selected].filter((label) => dynamicNodes.find(([dynamicLabel]) => dynamicLabel === label))); setSelected(new Set()); }} className="text-xs px-3 py-1.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors border border-destructive/20">移除动态节点</button>
                      )}
                    </div>
                  )}
                </div>

                {allSubNodes.map(([label, value]) => {
                  const isEnabled = value.enabled !== false;
                  const isChecked = selected.has(label);
                  const isHealthy = value.health === "healthy";
                  const expanded = !!expandedNodes[label];
                  const successCalls = Math.max(0, value.calls - value.errors);

                  return (
                    <div
                      key={label}
                      onClick={() => toggleSelect(label)}
                      className={cn(
                        "group relative bg-card border rounded-xl overflow-hidden transition-all duration-200 shadow-sm flex flex-col",
                        "cursor-pointer",
                        isChecked ? "border-primary ring-1 ring-primary/20 bg-primary/5" : "hover:border-border/80 border-border/60",
                        !isEnabled && "opacity-60 bg-muted/30 hover:bg-muted/50",
                      )}
                    >
                      <div className="p-4 pb-3 flex flex-col md:flex-row md:items-center gap-4">
                        <div className="flex items-center gap-3 w-full md:w-auto">
                          <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(label)} onClick={(event) => event.stopPropagation()} className="w-4 h-4 rounded text-primary focus:ring-primary/20 cursor-pointer" />
                          <div className={cn("w-2 h-2 rounded-full flex-shrink-0 animate-in zoom-in", !isEnabled ? "bg-muted-foreground" : isHealthy ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.4)]")} />
                          <div className="flex items-center gap-2 overflow-hidden flex-1 md:w-48">
                            <span className="font-mono font-bold text-sm truncate">{label}</span>
                            {value.dynamic ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 flex-shrink-0">动态</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex-shrink-0">ENV</span>
                            )}
                          </div>
                        </div>

                        <span className="font-mono text-xs text-muted-foreground truncate flex-1 min-w-[150px]" title={value.url}>{value.url ?? label}</span>

                        <div className="flex items-center gap-1.5 ml-auto mt-2 md:mt-0">
                          <button
                            onClick={(event) => { event.stopPropagation(); onToggleBackend(label, !isEnabled); }}
                            className={cn(
                              "px-2.5 py-1 text-xs rounded-md border transition-colors",
                              isEnabled ? "bg-amber-500/10 border-amber-500/20 text-amber-600 hover:bg-amber-500/20" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20",
                            )}
                          >
                            {isEnabled ? "禁用" : "启用"}
                          </button>
                          <button
                            onClick={(event) => { event.stopPropagation(); toggleExpanded(label); }}
                            className="px-2.5 py-1 text-xs rounded-md border border-border bg-secondary/40 text-muted-foreground hover:bg-secondary/60 transition-colors"
                          >
                            {expanded ? "收起" : "详情"}
                          </button>
                          {value.dynamic && (
                            <button
                              onClick={(event) => { event.stopPropagation(); onRemoveBackend(label); }}
                              className="p-1.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive hover:bg-destructive/20 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="px-5 py-3 md:pt-4 md:pb-4 border-t border-border/40 bg-secondary/10 grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-3 items-center">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">请求</span>
                          <span className="text-sm font-mono font-medium text-indigo-500 dark:text-indigo-400">{value.calls}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">成功</span>
                          <span className="text-sm font-mono font-medium text-green-500 dark:text-green-400">{successCalls}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">错误</span>
                          <span className={cn("text-sm font-mono font-medium", value.errors > 0 ? "text-destructive" : "text-green-500 dark:text-green-400")}>{value.errors}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">总 Token</span>
                          <span className="text-sm font-mono font-medium text-emerald-500 dark:text-emerald-400">{fmt(value.totalTokens)}</span>
                        </div>
                      </div>

                      {expanded && (
                        <div className="px-5 py-4 border-t border-border/40 bg-background/40 grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-3 items-center">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">流式</span>
                            <span className="text-sm font-mono font-medium text-blue-500 dark:text-blue-400">{value.streamingCalls ?? 0}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">输入 Token</span>
                            <span className="text-sm font-mono font-medium text-emerald-500 dark:text-emerald-400">{fmt(value.promptTokens)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">输出 Token</span>
                            <span className="text-sm font-mono font-medium text-emerald-500 dark:text-emerald-400">{fmt(value.completionTokens)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">均耗时</span>
                            <span className="text-sm font-mono font-medium text-foreground text-opacity-80">{value.calls > 0 ? `${value.avgDurationMs}ms` : "--"}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">首 Token</span>
                            <span className="text-sm font-mono font-medium text-foreground text-opacity-80">{value.avgTtftMs ? `${value.avgTtftMs}ms` : "--"}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">开销</span>
                            <span className="text-sm font-mono font-medium text-amber-500 dark:text-amber-400">${((value.promptTokens * DEFAULT_PRICING.input + value.completionTokens * DEFAULT_PRICING.output) / 1_000_000).toFixed(2)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="flex flex-col h-full shadow-sm">
              <SectionTitle className="flex items-center gap-2"><Plus size={16} /> 添加节点</SectionTitle>
              <p className="text-[13px] text-muted-foreground mb-4 flex-1">填入另一台部署在不同域名的相关节点地址，即可无缝水平扩展并智能分流请求。</p>

              <form onSubmit={onAddBackend} className="flex gap-2">
                <input
                  type="url"
                  required
                  value={addUrl}
                  onChange={(event) => setAddUrl(event.target.value)}
                  placeholder="https://example.com"
                  className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-foreground"
                />
                <button
                  type="submit"
                  disabled={addState === "loading"}
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
                        routing[field] ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                      aria-label={`Toggle ${label}`}
                    >
                      <div className={cn("w-3.5 h-3.5 bg-background rounded-full absolute top-[3px] transition-all shadow-sm", routing[field] ? "left-[23px]" : "left-[3px]")} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <FleetManager />
        </>
      )}
    </div>
  );
}
