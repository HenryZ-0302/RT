import { useEffect, useState } from "react";
import { 
  Server, 
  Search, 
  Filter, 
  ChevronDown, 
  ChevronRight,
  ShieldAlert,
  Power,
  Copy,
  Check,
  Terminal,
  BookOpen,
  Activity,
  AlertCircle,
  Loader2
} from "lucide-react";
import { cn } from "../lib/utils";

interface ModelStatus { id: string; provider: string; group: string; capability: "chat" | "image"; testMode: "chat" | "image"; enabled: boolean }
type GroupSummary = { total: number; enabled: number };
type Provider = "openai" | "anthropic" | "gemini" | "openrouter";
type GroupKey = "openai" | "openai_image" | "anthropic" | "gemini" | "gemini_image" | "openrouter";
type CapabilitySection = "chat" | "image";

interface ModelEntry {
  id: string;
  label: string;
  provider: Provider;
  desc: string;
  badge?: "thinking" | "tools" | "reasoning" | "image";
  context?: string;
}

type CheckNotice = {
  kind: "success" | "error";
  modelId: string;
  message: string;
};

// Model Arrays (Copied from App.tsx context)
export const OPENAI_MODELS: ModelEntry[] = [
  { id: "gpt-5.2", label: "GPT-5.2", provider: "openai", desc: "当前旗舰，适合编码、代理和复杂专业任务", context: "400K", badge: "tools" },
  { id: "gpt-5.1", label: "GPT-5.1", provider: "openai", desc: "上一代 GPT-5 旗舰，强于编码和工具调用", context: "400K", badge: "tools" },
  { id: "gpt-5", label: "GPT-5", provider: "openai", desc: "早期 GPT-5 主力模型，擅长推理与多步骤任务", context: "400K", badge: "tools" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai", desc: "更快更省的 GPT-5 版本，适合高并发常规任务", context: "400K", badge: "tools" },
  { id: "gpt-5-nano", label: "GPT-5 Nano", provider: "openai", desc: "最轻量的 GPT-5，适合分类、提取与简单自动化", context: "400K", badge: "tools" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", desc: "稳定的非推理旗舰，长上下文与工具调用都很强", context: "1M", badge: "tools" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai", desc: "更均衡的 GPT-4.1 版本，速度和质量兼顾", context: "1M", badge: "tools" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", provider: "openai", desc: "最快最便宜的 GPT-4.1，适合轻量文本流程", context: "1M", badge: "tools" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", desc: "通用多模态主力，适合图文理解与实时交互场景", context: "128K", badge: "tools" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", desc: "轻量多模态模型，适合成本敏感型对话任务", context: "128K", badge: "tools" },
  { id: "o4-mini", label: "o4 Mini", provider: "openai", desc: "高性价比推理模型，适合代码与视觉推理", context: "200K", badge: "reasoning" },
  { id: "o4-mini-thinking", label: "o4 Mini (thinking)", provider: "openai", desc: "o4-mini 的扩展思考别名", context: "200K", badge: "thinking" },
  { id: "o3", label: "o3", provider: "openai", desc: "强通用推理模型，适合数学、科学和复杂代码任务", context: "200K", badge: "reasoning" },
  { id: "o3-thinking", label: "o3 (thinking)", provider: "openai", desc: "o3 的扩展思考别名", context: "200K", badge: "thinking" },
  { id: "o3-mini", label: "o3 Mini", provider: "openai", desc: "更轻量的 o3，适合快速推理与结构化分析", context: "200K", badge: "reasoning" },
  { id: "o3-mini-thinking", label: "o3 Mini (thinking)", provider: "openai", desc: "o3-mini 的扩展思考别名", context: "200K", badge: "thinking" },
];

export const ANTHROPIC_MODELS: ModelEntry[] = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic", desc: "Anthropic 当前最强 Opus，适合高难度编码与代理编排", context: "1M", badge: "tools" },
  { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (thinking)", provider: "anthropic", desc: "Claude Opus 4.6 的扩展思考别名", context: "1M", badge: "thinking" },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5", provider: "anthropic", desc: "上一代 Opus 旗舰，适合高质量推理与企业工作流", context: "200K", badge: "tools" },
  { id: "claude-opus-4-5-thinking", label: "Claude Opus 4.5 (thinking)", provider: "anthropic", desc: "Claude Opus 4.5 的扩展思考别名", context: "200K", badge: "thinking" },
  { id: "claude-opus-4-1", label: "Claude Opus 4.1", provider: "anthropic", desc: "较稳定的 Opus 版本，适合高质量长文与复杂任务", context: "200K", badge: "tools" },
  { id: "claude-opus-4-1-thinking", label: "Claude Opus 4.1 (thinking)", provider: "anthropic", desc: "Claude Opus 4.1 的扩展思考别名", context: "200K", badge: "thinking" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", desc: "当前 Sonnet 主力，速度、代码能力和长上下文都很均衡", context: "1M", badge: "tools" },
  { id: "claude-sonnet-4-6-thinking", label: "Claude Sonnet 4.6 (thinking)", provider: "anthropic", desc: "Claude Sonnet 4.6 的扩展思考别名", context: "1M", badge: "thinking" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "anthropic", desc: "高性价比 Sonnet，适合大多数日常编码与办公任务", context: "200K", badge: "tools" },
  { id: "claude-sonnet-4-5-thinking", label: "Claude Sonnet 4.5 (thinking)", provider: "anthropic", desc: "Claude Sonnet 4.5 的扩展思考别名", context: "200K", badge: "thinking" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", desc: "轻量高速模型，适合低延迟问答与批处理", context: "200K", badge: "tools" },
  { id: "claude-haiku-4-5-thinking", label: "Claude Haiku 4.5 (thinking)", provider: "anthropic", desc: "Claude Haiku 4.5 的扩展思考别名", context: "200K", badge: "thinking" },
];

export const GEMINI_MODELS: ModelEntry[] = [
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview", provider: "gemini", desc: "Gemini 3 旗舰预览版，适合多模态理解与复杂代理任务", context: "1M", badge: "tools" },
  { id: "gemini-3-pro-preview-thinking", label: "Gemini 3 Pro Preview (thinking)", provider: "gemini", desc: "Gemini 3 Pro Preview 的扩展思考别名", context: "1M", badge: "thinking" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", provider: "gemini", desc: "更高规格的 Gemini Pro 预览模型，面向复杂多模态工作流", context: "2M", badge: "tools" },
  { id: "gemini-3.1-pro-preview-thinking", label: "Gemini 3.1 Pro Preview (thinking)", provider: "gemini", desc: "Gemini 3.1 Pro Preview 的扩展思考别名", context: "2M", badge: "thinking" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", provider: "gemini", desc: "Gemini 3 系列的平衡型高速模型，适合规模化调用", context: "1M", badge: "tools" },
  { id: "gemini-3-flash-preview-thinking", label: "Gemini 3 Flash Preview (thinking)", provider: "gemini", desc: "Gemini 3 Flash Preview 的扩展思考别名", context: "1M", badge: "thinking" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "gemini", desc: "成熟稳定的 Gemini 推理主力，擅长代码、文档和大上下文分析", context: "1M", badge: "tools" },
  { id: "gemini-2.5-pro-thinking", label: "Gemini 2.5 Pro (thinking)", provider: "gemini", desc: "Gemini 2.5 Pro 的扩展思考别名", context: "1M", badge: "thinking" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini", desc: "高性价比 Gemini 主力，适合低延迟与大规模推理调用", context: "1M", badge: "tools" },
  { id: "gemini-2.5-flash-thinking", label: "Gemini 2.5 Flash (thinking)", provider: "gemini", desc: "Gemini 2.5 Flash 的扩展思考别名", context: "1M", badge: "thinking" },
];

export const GEMINI_IMAGE_MODELS: ModelEntry[] = [
  { id: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview", provider: "gemini", desc: "Gemini 图片旗舰预览版，支持高质量生成与编辑", context: "65K", badge: "image" },
  { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", provider: "gemini", desc: "更快的 Gemini 图片模型，适合批量生成和轻量编辑", context: "65K", badge: "image" },
];

export const OPENAI_IMAGE_MODELS: ModelEntry[] = [
  { id: "gpt-image-1", label: "GPT Image 1", provider: "openai", desc: "OpenAI 原生图像模型，擅长高质量生成、修图与文字渲染", context: "Image", badge: "image" },
];

export const OPENROUTER_MODELS: ModelEntry[] = [
  { id: "x-ai/grok-4.20", label: "Grok 4.20", provider: "openrouter", desc: "xAI 新版旗舰，偏重代码、问答与高强度推理", context: "256K", badge: "tools" },
  { id: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast", provider: "openrouter", desc: "xAI 的高速对话版本，适合低延迟聊天和工具调用", context: "256K", badge: "tools" },
  { id: "x-ai/grok-4-fast", label: "Grok 4 Fast", provider: "openrouter", desc: "更强调吞吐与响应速度的 Grok 变体", context: "256K", badge: "tools" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", provider: "openrouter", desc: "Meta 多模态主力，擅长图文理解与长文任务", context: "1M" },
  { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout", provider: "openrouter", desc: "超长上下文 Llama，适合海量文档和代码库分析", context: "10M" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", provider: "openrouter", desc: "中文、代码和工具调用表现都很强的通用模型", context: "128K", badge: "tools" },
  { id: "deepseek/deepseek-r1", label: "DeepSeek R1", provider: "openrouter", desc: "DeepSeek 推理旗舰，适合复杂数学和代码问题", context: "128K", badge: "reasoning" },
  { id: "deepseek/deepseek-r1-0528", label: "DeepSeek R1 0528", provider: "openrouter", desc: "R1 的较新快照版本，偏重稳定推理输出", context: "128K", badge: "reasoning" },
  { id: "mistralai/mistral-small-2603", label: "Mistral Small 2603", provider: "openrouter", desc: "轻量高效的欧洲系模型，适合日常问答与摘要", context: "128K", badge: "tools" },
  { id: "qwen/qwen3.5-122b-a10b", label: "Qwen 3.5 122B", provider: "openrouter", desc: "阿里大参数模型，中文理解、代码和长文本都不错", context: "128K" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (OR)", provider: "openrouter", desc: "通过 OpenRouter 转发的 Gemini 2.5 Pro", context: "1M" },
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6 (OR)", provider: "openrouter", desc: "通过 OpenRouter 转发的 Claude Opus 4.6", context: "1M", badge: "tools" },
  { id: "cohere/command-a", label: "Command A", provider: "openrouter", desc: "Cohere 企业向模型，适合检索增强和业务问答", context: "256K", badge: "tools" },
  { id: "amazon/nova-premier-v1", label: "Nova Premier V1", provider: "openrouter", desc: "Amazon 高端多模态模型，适合企业场景和长文处理", context: "1M" },
  { id: "baidu/ernie-4.5-300b-a47b", label: "ERNIE 4.5 300B", provider: "openrouter", desc: "百度大参数模型，中文能力和通用任务表现稳定", context: "128K" },
];

const PROVIDER_COLORS: Record<Provider, { border: string; bg: string; dot: string; text: string }> = {
  openai: { bg: "bg-blue-500/10", border: "border-blue-500/20", dot: "bg-blue-400", text: "text-blue-500" },
  anthropic: { bg: "bg-orange-500/10", border: "border-orange-500/20", dot: "bg-orange-400", text: "text-orange-500" },
  gemini: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", dot: "bg-emerald-400", text: "text-emerald-500" },
  openrouter: { bg: "bg-purple-500/10", border: "border-purple-500/20", dot: "bg-purple-400", text: "text-purple-500" },
};

const GROUP_META: Record<GroupKey, { title: string; provider: Provider; models: ModelEntry[] }> = {
  openai: { title: "OpenAI", provider: "openai", models: OPENAI_MODELS },
  openai_image: { title: "OpenAI", provider: "openai", models: OPENAI_IMAGE_MODELS },
  anthropic: { title: "Anthropic Claude", provider: "anthropic", models: ANTHROPIC_MODELS },
  gemini: { title: "Google Gemini", provider: "gemini", models: GEMINI_MODELS },
  gemini_image: { title: "Google Gemini", provider: "gemini", models: GEMINI_IMAGE_MODELS },
  openrouter: { title: "OpenRouter", provider: "openrouter", models: OPENROUTER_MODELS },
};

const SECTION_META: Record<CapabilitySection, { title: string; groups: GroupKey[] }> = {
  chat: { title: "文本模型", groups: ["openai", "anthropic", "gemini", "openrouter"] },
  image: { title: "图片模型", groups: ["openai_image", "gemini_image"] },
};

function Badge({ variant }: { variant: string }) {
  const styles: Record<string, string> = {
    thinking: "text-purple-500 bg-purple-500/10 border-purple-500/20",
    tools: "text-amber-500 bg-amber-500/10 border-amber-500/20",
    reasoning: "text-rose-500 bg-rose-500/10 border-rose-500/20",
    image: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20",
  };
  const labels: Record<string, string> = { thinking: "思考", tools: "工具", reasoning: "推理", image: "图片" };
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
  onToggleProvider: (group: string, enabled: boolean) => void;
  onToggleModel: (id: string, enabled: boolean) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    openai: false, anthropic: false, gemini: false, gemini_image: false, openrouter: false,
  });
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkNotice, setCheckNotice] = useState<CheckNotice | null>(null);

  useEffect(() => {
    if (!checkNotice) return;
    const timer = window.setTimeout(() => setCheckNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [checkNotice]);

  const modelMetaMap = new Map(modelStatus.map((m) => [m.id, m]));

  const handleToggleGroup = (group: string, enabled: boolean) => {
    if (!enabled && !window.confirm("确认要关闭这一整组模型吗？关闭后客户端将无法发现和调用它们。")) return;
    onToggleProvider(group, enabled);
  };

  const testModel = async (modelId: string) => {
    if (checkingId) return;
    setCheckingId(modelId);
    setCheckNotice(null);
    const start = Date.now();
    try {
      const testMode = modelMetaMap.get(modelId)?.testMode ?? "chat";
      const res = await fetch(
        testMode === "image" ? `${baseUrl}/v1/images/generations` : `${baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(
            testMode === "image"
              ? {
                  model: modelId,
                  prompt: "Generate a simple blue square icon",
                  response_format: "b64_json"
                }
              : {
                  model: modelId,
                  messages: [{ role: "user", content: "Reply with exactly: OK" }],
                  max_tokens: 16
                }
          )
        }
      );
      const latency = Date.now() - start;
      if (res.ok) {
        setCheckNotice({
          kind: "success",
          modelId,
          message: testMode === "image"
            ? `模型 ${modelId} 图片生成检测成功，响应耗时 ${latency}ms。`
            : `模型 ${modelId} 检测成功，响应耗时 ${latency}ms。`,
        });
      } else {
        const err = await res.json().catch(() => ({ error: { message: "Unknown error" } }));
        setCheckNotice({
          kind: "error",
          modelId,
          message: `模型 ${modelId} 检测失败：${err.error?.message || `HTTP ${res.status}`}`,
        });
      }
    } catch (e) {
      setCheckNotice({
        kind: "error",
        modelId,
        message: `模型 ${modelId} 检测失败：${(e as Error).message}`,
      });
    } finally {
      setCheckingId(null);
    }
  };

  const allGroups = (Object.entries(GROUP_META) as Array<[GroupKey, { title: string; provider: Provider; models: ModelEntry[] }]>)
    .map(([key, value]) => ({ key, ...value }));

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
      {checkNotice && (
        <div
          className={cn(
            "fixed top-4 right-4 z-50 w-[min(420px,calc(100vw-2rem))] flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-top-2",
            checkNotice.kind === "success"
              ? "bg-emerald-500/95 text-white border-emerald-400/40"
              : "bg-rose-500/95 text-white border-rose-400/40",
          )}
        >
          <div className="mt-0.5 flex-shrink-0">
            {checkNotice.kind === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {checkNotice.kind === "success" ? "模型检测成功" : "模型检测失败"}
            </div>
            <div className="text-sm opacity-90 break-words">{checkNotice.message}</div>
          </div>
          <button
            type="button"
            onClick={() => setCheckNotice(null)}
            className="text-xs font-medium opacity-80 hover:opacity-100 transition-opacity"
          >
            关闭
          </button>
        </div>
      )}

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
      <div className="space-y-6">
        {(Object.entries(SECTION_META) as Array<[CapabilitySection, { title: string; groups: GroupKey[] }]>).map(([sectionKey, section]) => {
          const sectionGroups = allGroups.filter((group) => section.groups.includes(group.key));
          const visibleGroups = sectionGroups.map(({ key, title, models, provider }) => {
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
                      onClick={() => handleToggleGroup(key, true)} 
                      className="px-2 py-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20 rounded transition-colors text-xs font-medium"
                    >全开</button>
                    <button 
                      onClick={() => handleToggleGroup(key, false)} 
                      className="px-2 py-1 bg-amber-500/10 text-amber-600 border border-amber-500/20 hover:bg-amber-500/20 rounded transition-colors text-xs font-medium"
                    >全关</button>
                  </div>
                  
                  <div className="w-px h-6 bg-border mx-1 hidden sm:block" />
                  
                  <div className="flex items-center gap-2">
                     <Power size={14} className={groupEnabled ? "text-primary" : "text-muted-foreground"} />
                     <ModelToggle enabled={groupEnabled} onChange={() => handleToggleGroup(key, !allEnabled)} />
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
                          <div className="ml-auto pl-4 flex items-center gap-3">
                            <button
                              onClick={(e) => { e.stopPropagation(); testModel(m.id); }}
                              disabled={!enabled || checkingId === m.id}
                              className={cn(
                                "p-1.5 rounded-lg border transition-all",
                                checkingId === m.id ? "bg-secondary animate-pulse" : "bg-background hover:bg-secondary text-muted-foreground hover:text-primary border-border"
                              )}
                              title="连通性测试"
                            >
                              {checkingId === m.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Activity size={14} />
                              )}
                            </button>

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
          });

          const renderedGroups = visibleGroups.filter(Boolean);
          if (renderedGroups.length === 0) return null;

          return (
            <section key={sectionKey} className="space-y-4">
              <div className="flex items-center gap-3 px-1">
                <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-primary to-primary/50" />
                <h2 className="text-lg font-bold tracking-tight">{section.title}</h2>
              </div>
              <div className="space-y-4">
                {renderedGroups}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
