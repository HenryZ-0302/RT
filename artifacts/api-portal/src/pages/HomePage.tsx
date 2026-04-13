import { useState } from "react";
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

export function HomePage({
  apiKey,
  sillyTavernMode,
  stLoading,
  onToggleSTMode,
}: {
  apiKey: string;
  sillyTavernMode: boolean;
  stLoading: boolean;
  onToggleSTMode: () => void;
}) {
  const [nodeHealthModel, setNodeHealthModel] = useState(() => getStoredNodeHealthcheckModel());

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
