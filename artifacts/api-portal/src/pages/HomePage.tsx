import { useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { getStoredNodeHealthcheckModel, storeNodeHealthcheckModel } from "../lib/service";

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card text-card-foreground rounded-xl border border-border/50 shadow-sm p-6 overflow-hidden relative", className)}>
      {children}
    </div>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-sm font-bold tracking-widest text-muted-foreground uppercase mb-5", className)}>
      {children}
    </h2>
  );
}

type ResponseCacheSettings = {
  enabled: boolean;
  ttlSeconds: number;
  entries: number;
  maxEntries: number;
};

export function HomePage({
  apiKey,
  sillyTavernMode,
  stLoading,
  onToggleSTMode,
  cacheSettings,
  cacheLoading,
  onUpdateCacheSettings,
}: {
  apiKey: string;
  sillyTavernMode: boolean;
  stLoading: boolean;
  onToggleSTMode: () => void;
  cacheSettings: ResponseCacheSettings;
  cacheLoading: boolean;
  onUpdateCacheSettings: (patch: Partial<ResponseCacheSettings> & { clear?: boolean }) => void | Promise<void>;
}) {
  const [nodeHealthModel, setNodeHealthModel] = useState(() => getStoredNodeHealthcheckModel());
  const [cacheTtlInput, setCacheTtlInput] = useState(String(cacheSettings.ttlSeconds));

  useEffect(() => {
    setCacheTtlInput(String(cacheSettings.ttlSeconds));
  }, [cacheSettings.ttlSeconds]);

  const applyCacheTtl = () => {
    const next = Number(cacheTtlInput);
    if (!Number.isFinite(next)) {
      setCacheTtlInput(String(cacheSettings.ttlSeconds));
      return;
    }
    void onUpdateCacheSettings({ ttlSeconds: next });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <Card>
        <SectionTitle>客户端设置</SectionTitle>
        <div className="flex items-center justify-between gap-6">
          <div className="flex-1">
            <h3 className="font-semibold text-[15px] mb-1">SillyTavern 兼容模式</h3>
            <p className="text-sm text-muted-foreground leading-relaxed m-0 mb-3">
              启用后对 Claude 自动追加空 user 消息，修复部分客户端强制要求的角色顺序结构。
            </p>
            <div className={cn(
              "inline-flex px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              sillyTavernMode
                ? "bg-primary/10 border-primary/20 text-primary"
                : "bg-secondary text-muted-foreground border-border/50"
            )}>
              {sillyTavernMode ? '已启用 — 自动追加 {role:"user", content:"继续"} 给 Claude 模型' : "已禁用 — 消息原样发送"}
            </div>
          </div>

          <button
            onClick={onToggleSTMode}
            disabled={stLoading || !apiKey}
            className={cn(
              "w-14 h-7 rounded-full transition-all relative flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed border outline-none",
              sillyTavernMode ? "bg-primary border-primary" : "bg-secondary border-border"
            )}
            aria-label="Toggle SillyTavern Mode"
          >
            <div className={cn(
              "w-5 h-5 bg-background rounded-full absolute top-[3px] transition-all shadow-sm",
              sillyTavernMode ? "left-[32px]" : "left-[3px]"
            )} />
          </button>
        </div>
      </Card>

      <Card>
        <SectionTitle>缓存模式</SectionTitle>
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-6">
            <div className="flex-1">
              <h3 className="font-semibold text-[15px] mb-1">非流式聊天响应缓存</h3>
              <p className="text-sm text-muted-foreground leading-relaxed m-0 mb-3">
                开启后，相同模型、相同纯文本消息和相同 max_tokens 的非流式请求会直接复用上次响应，适合重复测试和固定提示词场景。流式、工具调用、图片和多模态请求不会缓存。
              </p>
              <div className={cn(
                "inline-flex px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                cacheSettings.enabled
                  ? "bg-primary/10 border-primary/20 text-primary"
                  : "bg-secondary text-muted-foreground border-border/50"
              )}>
                {cacheSettings.enabled
                  ? `已启用 — 当前缓存 ${cacheSettings.entries}/${cacheSettings.maxEntries} 条`
                  : "已禁用 — 每次请求都会真实调用模型"}
              </div>
            </div>

            <button
              onClick={() => void onUpdateCacheSettings({ enabled: !cacheSettings.enabled })}
              disabled={cacheLoading || !apiKey}
              className={cn(
                "w-14 h-7 rounded-full transition-all relative flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed border outline-none",
                cacheSettings.enabled ? "bg-primary border-primary" : "bg-secondary border-border"
              )}
              aria-label="Toggle response cache"
            >
              <div className={cn(
                "w-5 h-5 bg-background rounded-full absolute top-[3px] transition-all shadow-sm",
                cacheSettings.enabled ? "left-[32px]" : "left-[3px]"
              )} />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="space-y-2">
              <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">缓存有效期（秒）</span>
              <input
                type="number"
                min={30}
                max={86400}
                value={cacheTtlInput}
                onChange={(event) => setCacheTtlInput(event.target.value)}
                onBlur={applyCacheTtl}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-foreground"
              />
            </label>
            <button
              type="button"
              onClick={() => void onUpdateCacheSettings({ clear: true })}
              disabled={cacheLoading || !apiKey || cacheSettings.entries === 0}
              className="px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              清空缓存
            </button>
          </div>

          <div className="text-xs text-muted-foreground leading-relaxed">
            为了安全和可预期，缓存默认关闭；命中缓存时服务端不会再次调用模型，统计页会把这次调用记为 0 token。
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>节点检测设置</SectionTitle>
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-[15px] mb-1">节点模型检测用模型</h3>
            <p className="text-sm text-muted-foreground leading-relaxed m-0">
              这个模型只用于主节点和子节点的可用性检测，不影响正常转发与模型列表。
            </p>
          </div>
          <input
            type="text"
            value={nodeHealthModel}
            onChange={(event) => {
              const next = event.target.value;
              setNodeHealthModel(next);
              storeNodeHealthcheckModel(next);
            }}
            placeholder="例如：gpt-4o-mini / gemini-2.5-flash / claude-sonnet-4-5"
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-foreground"
          />
          <div className="text-xs text-muted-foreground">
            当前保存的检测模型：<span className="font-mono text-foreground">{nodeHealthModel || "未设置"}</span>
          </div>
        </div>
      </Card>

      <div className="h-4" />
    </div>
  );
}
