import { useState } from "react";
import { 
  Server, 
  Search, 
  Filter, 
  ChevronDown, 
  ChevronRight,
  ShieldAlert,
  Power
} from "lucide-react";
import { cn } from "../lib/utils";

interface ModelStatus { id: string; provider: string; enabled: boolean }
type GroupSummary = { total: number; enabled: number };
type Provider = "openai" | "anthropic" | "gemini" | "openrouter";

interface ModelEntry {
  id: string;
  label: string;
  provider: Provider;
  desc: string;
  badge?: "thinking" | "thinking-visible" | "tools" | "reasoning";
  context?: string;
}

// Model Arrays (Copied from App.tsx context)
export const OPENAI_MODELS: ModelEntry[] = [
  { id: "gpt-5.2", label: "GPT-5.2", provider: "openai", desc: "最新旗舰多模态模型", context: "128K", badge: "tools" },
  { id: "gpt-5.1", label: "GPT-5.1", provider: "openai", desc: "旗舰多模态模型", context: "128K", badge: "tools" },
  { id: "gpt-5", label: "GPT-5", provider: "openai", desc: "旗舰多模态模型", context: "128K", badge: "tools" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai", desc: "高性价比快速模型", context: "128K", badge: "tools" },
  { id: "gpt-5-nano", label: "GPT-5 Nano", provider: "openai", desc: "超轻量边缘模型", context: "128K", badge: "tools" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", desc: "稳定通用旗舰模型", context: "1M", badge: "tools" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai", desc: "均衡速度与质量", context: "1M", badge: "tools" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", provider: "openai", desc: "超高速轻量模型", context: "1M", badge: "tools" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", desc: "多模态旗舰（图文音）", context: "128K", badge: "tools" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", desc: "轻量多模态模型", context: "128K", badge: "tools" },
  { id: "o4-mini", label: "o4 Mini", provider: "openai", desc: "推理模型，快速高效", context: "200K", badge: "reasoning" },
  { id: "o4-mini-thinking", label: "o4 Mini (thinking)", provider: "openai", desc: "o4 Mini 思考别名", context: "200K", badge: "thinking" },
  { id: "o3", label: "o3", provider: "openai", desc: "强推理旗舰模型", context: "200K", badge: "reasoning" },
  { id: "o3-thinking", label: "o3 (thinking)", provider: "openai", desc: "o3 思考别名", context: "200K", badge: "thinking" },
  { id: "o3-mini", label: "o3 Mini", provider: "openai", desc: "高效推理模型", context: "200K", badge: "reasoning" },
  { id: "o3-mini-thinking", label: "o3 Mini (thinking)", provider: "openai", desc: "o3 Mini 思考别名", context: "200K", badge: "thinking" },
];

export const ANTHROPIC_MODELS: ModelEntry[] = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic", desc: "顶级推理与智能体任务", context: "200K", badge: "tools" },
  { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-opus-4-6-thinking-visible", label: "Claude Opus 4.6 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5", provider: "anthropic", desc: "旗舰推理模型", context: "200K", badge: "tools" },
  { id: "claude-opus-4-5-thinking", label: "Claude Opus 4.5 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-opus-4-5-thinking-visible", label: "Claude Opus 4.5 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-opus-4-1", label: "Claude Opus 4.1", provider: "anthropic", desc: "旗舰模型（稳定版）", context: "200K", badge: "tools" },
  { id: "claude-opus-4-1-thinking", label: "Claude Opus 4.1 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-opus-4-1-thinking-visible", label: "Claude Opus 4.1 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", desc: "速度与智能最佳平衡", context: "200K", badge: "tools" },
  { id: "claude-sonnet-4-6-thinking", label: "Claude Sonnet 4.6 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-sonnet-4-6-thinking-visible", label: "Claude Sonnet 4.6 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "anthropic", desc: "均衡性价比旗舰", context: "200K", badge: "tools" },
  { id: "claude-sonnet-4-5-thinking", label: "Claude Sonnet 4.5 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-sonnet-4-5-thinking-visible", label: "Claude Sonnet 4.5 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", desc: "超快速轻量模型", context: "200K", badge: "tools" },
  { id: "claude-haiku-4-5-thinking", label: "Claude Haiku 4.5 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-haiku-4-5-thinking-visible", label: "Claude Haiku 4.5 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
];

export const GEMINI_MODELS: ModelEntry[] = [
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", provider: "gemini", desc: "最新旗舰多模态模型", context: "2M", badge: "tools" },
  { id: "gemini-3.1-pro-preview-thinking", label: "Gemini 3.1 Pro Preview (thinking)", provider: "gemini", desc: "扩展思考（隐藏）", context: "2M", badge: "thinking" },
  { id: "gemini-3.1-pro-preview-thinking-visible", label: "Gemini 3.1 Pro Preview (thinking visible)", provider: "gemini", desc: "扩展思考（可见）", context: "2M", badge: "thinking-visible" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", provider: "gemini", desc: "极速多模态模型", context: "1M", badge: "tools" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "gemini", desc: "推理旗舰，强代码能力", context: "1M", badge: "tools" },
  { id: "gemini-2.5-pro-thinking", label: "Gemini 2.5 Pro (thinking)", provider: "gemini", desc: "扩展思考（隐藏）", context: "1M", badge: "thinking" },
  { id: "gemini-2.5-pro-thinking-visible", label: "Gemini 2.5 Pro (thinking visible)", provider: "gemini", desc: "扩展思考（可见）", context: "1M", badge: "thinking-visible" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini", desc: "速度与质量兼备", context: "1M", badge: "tools" },
  { id: "gemini-2.5-flash-thinking", label: "Gemini 2.5 Flash (thinking)", provider: "gemini", desc: "扩展思考（隐藏）", context: "1M", badge: "thinking" },
  { id: "gemini-2.5-flash-thinking-visible", label: "Gemini 2.5 Flash (thinking visible)", provider: "gemini", desc: "扩展思考（可见）", context: "1M", badge: "thinking-visible" },
];

export const OPENROUTER_MODELS: ModelEntry[] = [
  { id: "x-ai/grok-4.20", label: "Grok 4.20", provider: "openrouter", desc: "xAI 最新旗舰推理模型", badge: "tools" },
  { id: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast", provider: "openrouter", desc: "xAI 高速对话模型", badge: "tools" },
  { id: "x-ai/grok-4-fast", label: "Grok 4 Fast", provider: "openrouter", desc: "xAI 快速模型", badge: "tools" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", provider: "openrouter", desc: "Meta 多模态旗舰" },
  { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout", provider: "openrouter", desc: "Meta 长上下文模型", context: "10M" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", provider: "openrouter", desc: "中文/代码强模型", badge: "tools" },
  { id: "deepseek/deepseek-r1", label: "DeepSeek R1", provider: "openrouter", desc: "开源强推理模型", badge: "reasoning" },
  { id: "deepseek/deepseek-r1-0528", label: "DeepSeek R1 0528", provider: "openrouter", desc: "R1 最新版本", badge: "reasoning" },
  { id: "mistralai/mistral-small-2603", label: "Mistral Small 2603", provider: "openrouter", desc: "轻量高效模型", badge: "tools" },
  { id: "qwen/qwen3.5-122b-a10b", label: "Qwen 3.5 122B", provider: "openrouter", desc: "Alibaba 大参数旗舰" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (OR)", provider: "openrouter", desc: "通过 OpenRouter 的 Gemini" },
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6 (OR)", provider: "openrouter", desc: "通过 OpenRouter 的 Claude", badge: "tools" },
  { id: "cohere/command-a", label: "Command A", provider: "openrouter", desc: "Cohere 企业级模型", badge: "tools" },
  { id: "amazon/nova-premier-v1", label: "Nova Premier V1", provider: "openrouter", desc: "Amazon 旗舰多模态" },
  { id: "baidu/ernie-4.5-300b-a47b", label: "ERNIE 4.5 300B", provider: "openrouter", desc: "百度 MoE 大参数模型" },
];

const PROVIDER_COLORS: Record<Provider, { border: string; bg: string; dot: string; text: string }> = {
  openai: { bg: "bg-blue-500/10", border: "border-blue-500/20", dot: "bg-blue-400", text: "text-blue-500" },
  anthropic: { bg: "bg-orange-500/10", border: "border-orange-500/20", dot: "bg-orange-400", text: "text-orange-500" },
  gemini: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", dot: "bg-emerald-400", text: "text-emerald-500" },
  openrouter: { bg: "bg-purple-500/10", border: "border-purple-500/20", dot: "bg-purple-400", text: "text-purple-500" },
};

function Badge({ variant }: { variant: string }) {
  const styles: Record<string, string> = {
    thinking: "text-purple-500 bg-purple-500/10 border-purple-500/20",
    "thinking-visible": "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
    tools: "text-amber-500 bg-amber-500/10 border-amber-500/20",
    reasoning: "text-rose-500 bg-rose-500/10 border-rose-500/20",
  };
  const labels: Record<string, string> = { thinking: "思考", "thinking-visible": "思考可见", tools: "工具", reasoning: "推理" };
  const s = styles[variant] ?? styles.tools;
  return (
    <span className={cn("text-[10px] font-semibold border rounded px-1.5 py-0.5 flex-shrink-0 inline-flex items-center w-max tracking-wide", s)}>
      {labels[variant] ?? variant}
    </span>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card text-card-foreground rounded-xl border border-border/50 shadow-sm p-5 space-y-4", className)}>
      {children}
    </div>
  );
}

function ModelToggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={cn(
        "w-10 h-5 rounded-full transition-all flex-shrink-0 relative outline-none",
        enabled ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/40"
      )}
      aria-label="Toggle model"
    >
      <div className={cn(
        "w-3.5 h-3.5 bg-background rounded-full absolute top-[3px] transition-all shadow-sm",
        enabled ? "left-[23px]" : "left-[3px]"
      )} />
    </button>
  );
}

export function ModelsPage({
  baseUrl, apiKey, modelStatus, summary, onRefresh, onToggleProvider, onToggleModel,
}: {
  baseUrl: string;
  apiKey: string;
  modelStatus: ModelStatus[];
  summary: Record<string, GroupSummary>;
  onRefresh: () => void;
  onToggleProvider: (provider: string, enabled: boolean) => void;
  onToggleModel: (id: string, enabled: boolean) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    openai: true, anthropic: true, gemini: true, openrouter: true,
  });
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const allGroups = [
    { key: "openai", title: "OpenAI", models: OPENAI_MODELS, provider: "openai" as Provider },
    { key: "anthropic", title: "Anthropic Claude", models: ANTHROPIC_MODELS, provider: "anthropic" as Provider },
    { key: "gemini", title: "Google Gemini", models: GEMINI_MODELS, provider: "gemini" as Provider },
    { key: "openrouter", title: "OpenRouter", models: OPENROUTER_MODELS, provider: "openrouter" as Provider },
  ];

  const statusMap = new Map(modelStatus.map((m) => [m.id, m.enabled]));
  const totalEnabled = modelStatus.filter((m) => m.enabled).length;
  const totalCount = modelStatus.length;

  if (!apiKey) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border-dashed border-2 border-border/50 rounded-xl bg-card/50 min-h-[400px]">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-muted-foreground mb-4">
           <ShieldAlert size={32} />
        </div>
        <h2 className="text-xl font-bold mb-2">需要认证</h2>
        <p className="text-muted-foreground max-w-sm">请先在首页填写 API Key 才能管理模型开关状态。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Top Controls Bar */}
      <Card className="flex flex-col md:flex-row md:items-center gap-4 bg-secondary/20 shadow-none border-border/60">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
             <div className="w-1.5 h-6 bg-gradient-to-b from-primary to-primary/50 rounded-full" />
             <h1 className="text-xl font-bold">模型管理</h1>
          </div>
          <div className="text-xs text-muted-foreground mt-1 ml-3.5">
            已开启 <span className="font-bold text-primary px-1">{totalEnabled}</span> / {totalCount}
            <span className="ml-2 pr-1 hidden sm:inline">· 禁用的模型将不能被客户端通过 API 发现或调用</span>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="搜索模型..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-1.5 bg-background border border-border rounded-lg text-sm w-48 focus:w-64 transition-all focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="flex bg-background border border-border rounded-lg p-1">
            {(["all", "enabled", "disabled"] as const).map((f) => (
              <button 
                key={f} 
                onClick={() => setFilter(f)} 
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  filter === f ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                {f === "all" ? "全部" : f === "enabled" ? "已开启" : "已关闭"}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Group Lists */}
      <div className="space-y-4">
        {allGroups.map(({ key, title, models, provider }) => {
          const c = PROVIDER_COLORS[provider];
          const grpSummary = summary[key] ?? { total: models.length, enabled: models.length };
          const isExpanded = expandedGroups[key];
          const groupEnabled = grpSummary.enabled > 0;
          const allEnabled = grpSummary.enabled === grpSummary.total;

          // Apply filters
          const filteredModels = models.filter((m) => {
            const en = statusMap.get(m.id) ?? true;
            const matchesSearch = m.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                  m.label.toLowerCase().includes(searchQuery.toLowerCase());
            
            if (!matchesSearch) return false;
            if (filter === "enabled") return en;
            if (filter === "disabled") return !en;
            return true;
          });

          // Only keep group open if searching
          const actuallyExpanded = searchQuery ? true : isExpanded;
          
          if (searchQuery && filteredModels.length === 0) return null;

          return (
            <div key={key} className={cn("rounded-xl border overflow-hidden transition-all bg-card shadow-sm", actuallyExpanded ? "border-border/80" : "border-border/40")}>
              
              {/* Group Header */}
              <div 
                className={cn("flex flex-wrap items-center gap-3 p-3 md:p-4 border-b hover:bg-secondary/40 cursor-pointer transition-colors", c.bg, c.border, !actuallyExpanded && "border-b-0")}
                onClick={() => !searchQuery && setExpandedGroups((p) => ({ ...p, [key]: !p[key] }))}
              >
                <div className={cn("w-2 h-2 rounded-full hidden sm:block", c.dot)} />
                <h3 className={cn("font-bold text-[15px] mr-auto flex items-center gap-2", c.text)}>
                  {title}
                </h3>
                
                <div className="flex items-center gap-3 md:gap-4 flex-wrap mt-2 w-full md:w-auto md:mt-0" onClick={e => e.stopPropagation()}>
                  <div className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5 border border-border">
                    <span className={groupEnabled ? "text-primary font-bold" : ""}>{grpSummary.enabled}</span><span className="mx-1 opacity-50">/</span>{grpSummary.total}
                  </div>
                  
                  <div className="flex gap-1.5 ml-auto md:ml-0">
                    <button 
                      onClick={() => onToggleProvider(key, true)} 
                      className="px-2 py-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20 rounded transition-colors text-xs font-medium"
                    >全开</button>
                    <button 
                      onClick={() => onToggleProvider(key, false)} 
                      className="px-2 py-1 bg-amber-500/10 text-amber-600 border border-amber-500/20 hover:bg-amber-500/20 rounded transition-colors text-xs font-medium"
                    >全关</button>
                  </div>
                  
                  <div className="w-px h-6 bg-border mx-1 hidden sm:block" />
                  
                  <div className="flex items-center gap-2">
                     <Power size={14} className={groupEnabled ? "text-primary" : "text-muted-foreground"} />
                     <ModelToggle enabled={groupEnabled} onChange={() => onToggleProvider(key, !allEnabled)} />
                  </div>
                  
                  {!searchQuery && (
                    <div className="text-muted-foreground ml-2 hidden sm:block">
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </div>
                  )}
                </div>
              </div>

              {/* Models List */}
              {actuallyExpanded && (
                <div className="divide-y divide-border/40">
                  {filteredModels.length > 0 ? (
                    filteredModels.map((m) => {
                      const enabled = statusMap.get(m.id) ?? true;
                      return (
                        <div 
                          key={m.id} 
                          className={cn(
                            "flex items-center gap-3 p-3 transition-colors hover:bg-secondary/40",
                            !enabled && "opacity-60 bg-muted/20"
                          )}
                        >
                          <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0 animate-in zoom-in", enabled ? "bg-green-500" : "bg-muted-foreground")} />
                          <div className="flex-1 flex flex-col md:flex-row md:items-center gap-1 md:gap-4 overflow-hidden">
                            <span className={cn(
                              "font-mono font-medium text-[13px] md:w-56 truncate tracking-tight flex-shrink-0",
                              enabled ? c.text : "text-muted-foreground"
                            )} title={m.id}>
                              {m.id}
                            </span>
                            <span className="text-xs text-muted-foreground truncate hidden sm:block md:w-48 xl:w-64 flex-1">
                              {m.desc}
                            </span>
                            
                            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap mt-2 md:mt-0">
                               {m.context && (
                                 <span className="text-[10px] font-mono font-bold bg-secondary border border-border px-1.5 rounded text-muted-foreground">Ctx: {m.context}</span>
                               )}
                               {m.badge && <Badge variant={m.badge} />}
                            </div>
                          </div>
                          <div className="ml-auto pl-4 flex items-center">
                            <ModelToggle enabled={enabled} onChange={() => onToggleModel(m.id, !enabled)} />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center justify-center gap-2">
                       <Filter size={24} className="opacity-20" />
                       当前过滤条件下该提供商无匹配模型
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
