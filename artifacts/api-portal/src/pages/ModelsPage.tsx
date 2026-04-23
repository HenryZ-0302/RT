import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  BookOpen,
  Copy,
  Power,
  RefreshCw,
  Search,
  SearchCheck,
  ShieldAlert,
} from "lucide-react";
import { cn } from "../lib/utils";
import { MODEL_DISCOVERY_PROMPT, MODEL_DISCOVERY_PROMPT_PATH } from "../lib/modelDiscoveryPrompt";

interface ModelStatus {
  id: string;
  description?: string;
  provider: string;
  group: string;
  capability: "chat" | "image";
  testMode: "chat" | "image";
  enabled: boolean;
}

type GroupSummary = { total: number; enabled: number };
type CapabilitySection = "chat" | "image";

type CheckNotice = {
  kind: "success" | "error";
  modelId: string;
  message: string;
};

type ProviderColors = {
  border: string;
  bg: string;
  dot: string;
  text: string;
};

type GroupView = {
  key: string;
  title: string;
  provider: string;
  capability: CapabilitySection;
  models: ModelStatus[];
  summary: GroupSummary;
};

const PROVIDER_COLORS: Record<string, ProviderColors> = {
  openai: { bg: "bg-blue-500/10", border: "border-blue-500/20", dot: "bg-blue-400", text: "text-blue-500" },
  anthropic: { bg: "bg-orange-500/10", border: "border-orange-500/20", dot: "bg-orange-400", text: "text-orange-500" },
  gemini: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", dot: "bg-emerald-400", text: "text-emerald-500" },
  openrouter: { bg: "bg-purple-500/10", border: "border-purple-500/20", dot: "bg-purple-400", text: "text-purple-500" },
};

const GROUP_TITLES: Record<string, string> = {
  openai: "OpenAI",
  openai_image: "OpenAI",
  anthropic: "Anthropic Claude",
  gemini: "Google Gemini",
  gemini_image: "Google Gemini",
  openrouter: "OpenRouter",
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

const GROUP_ORDER = ["openai", "anthropic", "gemini", "openrouter", "openai_image", "gemini_image"];

function formatTitle(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getProviderColors(provider: string): ProviderColors {
  return PROVIDER_COLORS[provider] ?? {
    bg: "bg-zinc-500/10",
    border: "border-zinc-500/20",
    dot: "bg-zinc-400",
    text: "text-zinc-500",
  };
}

function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? formatTitle(provider);
}

function getGroupTitle(group: string, provider: string, capability: CapabilitySection): string {
  if (GROUP_TITLES[group]) return GROUP_TITLES[group];
  const providerLabel = getProviderLabel(provider);
  return capability === "image" ? `${providerLabel} 图片` : providerLabel;
}

function getModelBadge(model: ModelStatus): "thinking" | "image" | null {
  if (model.capability === "image" || model.testMode === "image") return "image";
  if (model.id.endsWith("-thinking")) return "thinking";
  return null;
}

function buildGroupViews(models: ModelStatus[], summary: Record<string, GroupSummary>): GroupView[] {
  const groupMap = new Map<string, GroupView>();

  for (const model of models) {
    const existing = groupMap.get(model.group);
    if (existing) {
      existing.models.push(model);
      continue;
    }

    groupMap.set(model.group, {
      key: model.group,
      title: getGroupTitle(model.group, model.provider, model.capability),
      provider: model.provider,
      capability: model.capability,
      models: [model],
      summary: summary[model.group] ?? {
        total: 0,
        enabled: 0,
      },
    });
  }

  return Array.from(groupMap.values())
    .map((group) => ({
      ...group,
      summary: summary[group.key] ?? {
        total: group.models.length,
        enabled: group.models.filter((model) => model.enabled).length,
      },
    }))
    .sort((a, b) => {
      const aIndex = GROUP_ORDER.indexOf(a.key);
      const bIndex = GROUP_ORDER.indexOf(b.key);
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      }
      return a.title.localeCompare(b.title, "zh-CN");
    });
}

function Badge({ variant }: { variant: "thinking" | "image" }) {
  const styles = {
    thinking: "text-purple-500 bg-purple-500/10 border-purple-500/20",
    image: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20",
  };
  const labels = {
    thinking: "思考",
    image: "图片",
  };

  return (
    <span className={cn("text-[10px] font-semibold border rounded px-1.5 py-0.5 flex-shrink-0 inline-flex items-center w-max tracking-wide", styles[variant])}>
      {labels[variant]}
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
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      className={cn(
        "w-10 h-5 rounded-full transition-all flex-shrink-0 relative outline-none",
        enabled ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/40",
      )}
      aria-label="Toggle model"
    >
      <div
        className={cn(
          "w-3.5 h-3.5 bg-background rounded-full absolute top-[3px] transition-all shadow-sm",
          enabled ? "left-[23px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

export function ModelsPage({
  baseUrl,
  apiKey,
  modelStatus,
  summary,
  onRefresh,
  onToggleProvider,
  onToggleModel,
}: {
  baseUrl: string;
  apiKey: string;
  modelStatus: ModelStatus[];
  summary: Record<string, GroupSummary>;
  onRefresh: () => void;
  onToggleProvider: (group: string, enabled: boolean) => void;
  onToggleModel: (id: string, enabled: boolean) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkNotice, setCheckNotice] = useState<CheckNotice | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    if (!checkNotice) return;
    const timer = window.setTimeout(() => setCheckNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [checkNotice]);

  const groupedModels = useMemo(
    () => buildGroupViews(modelStatus, summary),
    [modelStatus, summary],
  );

  const totalEnabled = modelStatus.filter((model) => model.enabled).length;
  const totalCount = modelStatus.length;

  const handleToggleGroup = (group: string, enabled: boolean) => {
    if (!enabled && !window.confirm("确认要关闭这一整组模型吗？关闭后客户端将无法发现和调用它们。")) return;
    onToggleProvider(group, enabled);
  };

  const copyDiscoveryPrompt = async () => {
    try {
      await navigator.clipboard.writeText(MODEL_DISCOVERY_PROMPT);
    } catch {
      const el = document.createElement("textarea");
      el.value = MODEL_DISCOVERY_PROMPT;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 2000);
  };

  const testModel = async (modelId: string) => {
    if (checkingId) return;
    setCheckingId(modelId);
    setCheckNotice(null);
    const start = Date.now();

    try {
      const model = modelStatus.find((item) => item.id === modelId);
      const testMode = model?.testMode ?? "chat";
      const response = await fetch(
        testMode === "image" ? `${baseUrl}/api/v1/images/generations` : `${baseUrl}/api/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(
            testMode === "image"
              ? {
                  model: modelId,
                  prompt: "Generate a simple blue square icon",
                  response_format: "b64_json",
                }
              : {
                  model: modelId,
                  messages: [{ role: "user", content: "Reply with exactly: OK" }],
                  max_tokens: 16,
                },
          ),
        },
      );

      const latency = Date.now() - start;
      if (response.ok) {
        setCheckNotice({
          kind: "success",
          modelId,
          message: testMode === "image"
            ? `模型 ${modelId} 图片生成检测成功，响应耗时 ${latency}ms。`
            : `模型 ${modelId} 检测成功，响应耗时 ${latency}ms。`,
        });
      } else {
        const errorBody = await response.json().catch(() => ({ error: { message: "Unknown error" } }));
        setCheckNotice({
          kind: "error",
          modelId,
          message: `模型 ${modelId} 检测失败：${errorBody.error?.message || `HTTP ${response.status}`}`,
        });
      }
    } catch (error) {
      setCheckNotice({
        kind: "error",
        modelId,
        message: `模型 ${modelId} 检测失败：${(error as Error).message}`,
      });
    } finally {
      setCheckingId(null);
    }
  };

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

      <Card className="flex flex-col md:flex-row md:items-center gap-4 bg-secondary/20 shadow-none border-border/60">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 bg-gradient-to-b from-primary to-primary/50 rounded-full" />
            <h1 className="text-xl font-bold">模型管理</h1>
          </div>
          <div className="text-xs text-muted-foreground mt-1 ml-3.5">
            已开启 <span className="font-bold text-primary px-1">{totalEnabled}</span> / {totalCount}
            <span className="ml-2 pr-1 hidden sm:inline">· 当前页面完全根据后端返回的模型列表渲染</span>
          </div>
          <div className="text-xs text-muted-foreground mt-2 ml-3.5">
            当前可见模型来自后端注册表，不是平台自动发现的全量模型目录。
          </div>
          <div className="text-xs text-muted-foreground mt-2 ml-3.5">
            OpenRouter 模型默认关闭，需要时再手动开启。
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索模型..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pl-9 pr-4 py-1.5 bg-background border border-border rounded-lg text-sm w-48 focus:w-64 transition-all focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="flex bg-background border border-border rounded-lg p-1">
            {(["all", "enabled", "disabled"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  filter === value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                )}
              >
                {value === "all" ? "全部" : value === "enabled" ? "已开启" : "已关闭"}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw size={13} />
            刷新模型
          </button>
        </div>
      </Card>

      <Card className="border-cyan-500/20 bg-cyan-500/5 shadow-none">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-cyan-700 dark:text-cyan-300 mb-2">
              <SearchCheck size={16} />
              <h2 className="text-sm font-bold">注册表模型和工作区可用模型不是同一件事</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed m-0">
              这里控制的是后端注册并对外暴露的模型。要确认 Replit 当前真实可用的新模型，请使用 <code className="font-mono text-foreground">{MODEL_DISCOVERY_PROMPT_PATH}</code> 里的 Agent 提示词。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <button
              type="button"
              onClick={copyDiscoveryPrompt}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                promptCopied
                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-secondary border-border",
              )}
            >
              {promptCopied ? <Check size={13} /> : <Copy size={13} />}
              {promptCopied ? "已复制" : "复制发现提示词"}
            </button>
            <a
              href="/docs#model-discovery"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <BookOpen size={13} />
              查看文档
            </a>
          </div>
        </div>
      </Card>

      {groupedModels.length === 0 ? (
        <Card className="py-10 text-center text-muted-foreground">
          <div className="flex flex-col items-center gap-3">
            <Filter size={24} className="opacity-30" />
            <div className="text-sm">后端当前没有返回任何模型。</div>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {(["chat", "image"] as const).map((sectionKey) => {
            const sectionTitle = sectionKey === "chat" ? "文本模型" : "图片模型";
            const sectionGroups = groupedModels.filter((group) => group.capability === sectionKey);

            if (sectionGroups.length === 0) return null;

            const visibleGroups = sectionGroups.map((group) => {
              const colors = getProviderColors(group.provider);
              const isExpanded = searchQuery ? true : !!expandedGroups[group.key];
              const summaryState = group.summary;
              const groupEnabled = summaryState.enabled > 0;
              const allEnabled = summaryState.enabled === summaryState.total;
              const providerLabel = getProviderLabel(group.provider);
              const isOpenRouterGroup = group.provider === "openrouter";

              const filteredModels = group.models.filter((model) => {
                const matchesSearch = [
                  model.id,
                  model.description ?? "",
                  group.title,
                  providerLabel,
                ].join(" ").toLowerCase().includes(searchQuery.toLowerCase());

                if (!matchesSearch) return false;
                if (filter === "enabled") return model.enabled;
                if (filter === "disabled") return !model.enabled;
                return true;
              });

              if (searchQuery && filteredModels.length === 0) return null;

              return (
                <div
                  key={group.key}
                  className={cn("rounded-xl border overflow-hidden transition-all bg-card shadow-sm", isExpanded ? "border-border/80" : "border-border/40")}
                >
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-3 p-3 md:p-4 border-b hover:bg-secondary/40 cursor-pointer transition-colors",
                      colors.bg,
                      colors.border,
                      !isExpanded && "border-b-0",
                    )}
                    onClick={() => !searchQuery && setExpandedGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}
                  >
                    <div className={cn("w-2 h-2 rounded-full hidden sm:block", colors.dot)} />
                    <h3 className={cn("font-bold text-[15px] mr-auto flex items-center gap-2", colors.text)}>
                      {group.title}
                      {isOpenRouterGroup && (
                        <span className="text-[10px] font-semibold border rounded px-1.5 py-0.5 text-amber-600 bg-amber-500/10 border-amber-500/20">
                          默认关闭
                        </span>
                      )}
                    </h3>

                    <div
                      className="flex items-center gap-3 md:gap-4 flex-wrap mt-2 w-full md:w-auto md:mt-0"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5 border border-border">
                        <span className={groupEnabled ? "text-primary font-bold" : ""}>{summaryState.enabled}</span>
                        <span className="mx-1 opacity-50">/</span>
                        {summaryState.total}
                      </div>

                      <div className="flex gap-1.5 ml-auto md:ml-0">
                        <button
                          onClick={() => handleToggleGroup(group.key, true)}
                          className="px-2 py-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20 rounded transition-colors text-xs font-medium"
                        >
                          全开
                        </button>
                        <button
                          onClick={() => handleToggleGroup(group.key, false)}
                          className="px-2 py-1 bg-amber-500/10 text-amber-600 border border-amber-500/20 hover:bg-amber-500/20 rounded transition-colors text-xs font-medium"
                        >
                          全关
                        </button>
                      </div>

                      <div className="w-px h-6 bg-border mx-1 hidden sm:block" />

                      <div className="flex items-center gap-2">
                        <Power size={14} className={groupEnabled ? "text-primary" : "text-muted-foreground"} />
                        <ModelToggle enabled={groupEnabled} onChange={() => handleToggleGroup(group.key, !allEnabled)} />
                      </div>

                      {!searchQuery && (
                        <div className="text-muted-foreground ml-2 hidden sm:block">
                          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </div>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="divide-y divide-border/40">
                      {filteredModels.length > 0 ? (
                        filteredModels.map((model) => {
                          const badge = getModelBadge(model);
                          return (
                            <div
                              key={model.id}
                              className={cn(
                                "flex items-center gap-3 p-3 transition-colors hover:bg-secondary/40",
                                !model.enabled && "opacity-60 bg-muted/20",
                              )}
                            >
                              <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0 animate-in zoom-in", model.enabled ? "bg-green-500" : "bg-muted-foreground")} />
                              <div className="flex-1 flex flex-col md:flex-row md:items-center gap-1 md:gap-4 overflow-hidden">
                                <span
                                  className={cn(
                                    "font-mono font-medium text-[13px] md:w-56 truncate tracking-tight flex-shrink-0",
                                    model.enabled ? colors.text : "text-muted-foreground",
                                  )}
                                  title={model.id}
                                >
                                  {model.id}
                                </span>
                                <span className="text-xs text-muted-foreground truncate hidden sm:block md:w-48 xl:w-72 flex-1">
                                  {model.description ?? "来自服务端模型注册表"}
                                </span>

                                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap mt-2 md:mt-0">
                                  <span className="text-[10px] font-medium bg-secondary border border-border px-1.5 py-0.5 rounded text-muted-foreground whitespace-nowrap">
                                    {providerLabel}
                                  </span>
                                  {badge && <Badge variant={badge} />}
                                </div>
                              </div>
                              <div className="ml-auto pl-4 flex items-center gap-3">
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void testModel(model.id);
                                  }}
                                  disabled={!model.enabled || checkingId === model.id}
                                  className={cn(
                                    "p-1.5 rounded-lg border transition-all",
                                    checkingId === model.id ? "bg-secondary animate-pulse" : "bg-background hover:bg-secondary text-muted-foreground hover:text-primary border-border",
                                  )}
                                  title="连通性测试"
                                >
                                  {checkingId === model.id ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                                </button>

                                <ModelToggle enabled={model.enabled} onChange={() => onToggleModel(model.id, !model.enabled)} />
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center justify-center gap-2">
                          <Filter size={24} className="opacity-20" />
                          当前过滤条件下该分组无匹配模型
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
                  <h2 className="text-lg font-bold tracking-tight">{sectionTitle}</h2>
                </div>
                <div className="space-y-4">{renderedGroups}</div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
