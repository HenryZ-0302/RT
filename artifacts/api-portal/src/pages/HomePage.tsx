import { cn } from "../lib/utils";

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

      <div className="h-4" />
    </div>
  );
}
