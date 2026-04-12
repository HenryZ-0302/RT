import { useEffect, useState } from "react";
import { 
  Copy, 
  Check, 
  GitMerge, 
  FileType2, 
  Blocks, 
  Lightbulb, 
  KeyRound, 
  Zap,
  Info
} from "lucide-react";
import { cn } from "../lib/utils";
import { servicePaths } from "../lib/service";
import { FALLBACK_VERSION_INFO, type PortalVersionInfo } from "../lib/version";

// Helper components
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "bg-card text-card-foreground rounded-xl border border-border/50 shadow-sm p-6 overflow-hidden relative",
      className
    )}>
      {children}
    </div>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn(
      "text-sm font-bold tracking-widest text-muted-foreground uppercase mb-5",
      className
    )}>
      {children}
    </h2>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement("textarea");
      el.value = text; document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className={cn(
      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 border flex-shrink-0",
      copied 
        ? "bg-green-500/10 border-green-500/30 text-green-500 dark:text-green-400" 
        : "bg-secondary/50 hover:bg-secondary border-border text-muted-foreground hover:text-foreground"
    )}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "已复制!" : (label ?? "复制")}
    </button>
  );
}

export function HomePage({
  displayUrl, apiKey, sillyTavernMode, stLoading, onToggleSTMode,
}: {
  displayUrl: string;
  apiKey: string;
  sillyTavernMode: boolean;
  stLoading: boolean;
  onToggleSTMode: () => void;
}) {
  const [versionInfo, setVersionInfo] = useState<PortalVersionInfo>(FALLBACK_VERSION_INFO);

  useEffect(() => {
    let cancelled = false;

    async function loadVersionInfo() {
      try {
        const response = await fetch(servicePaths.release(displayUrl));
        if (!response.ok) return;
        const data = await response.json() as PortalVersionInfo;
        if (cancelled) return;
        setVersionInfo({
          version: data.version ?? FALLBACK_VERSION_INFO.version,
          name: data.name ?? FALLBACK_VERSION_INFO.name,
          releaseDate: data.releaseDate ?? FALLBACK_VERSION_INFO.releaseDate,
          releaseNotes: data.releaseNotes ?? FALLBACK_VERSION_INFO.releaseNotes,
        });
      } catch {
        // Keep the bundled fallback version info when the service is unavailable.
      }
    }

    void loadVersionInfo();

    return () => {
      cancelled = true;
    };
  }, [displayUrl]);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Current release nodes */}
      <Card className="bg-primary/5 border-primary/20 shadow-md shadow-primary/5">
        <div className="flex items-center gap-2 mb-4 text-primary">
          <Info size={18} />
          <h2 className="text-sm font-bold tracking-widest uppercase">当前版本更新</h2>
        </div>
        
        <div className="mb-4 relative">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-sm font-bold text-primary">v{versionInfo.version}</span>
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{versionInfo.releaseDate}</span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed ml-1">
            {versionInfo.releaseNotes}
          </p>
        </div>
      </Card>

      {/* Feature Cards Grid */}
      <div>
        <SectionTitle>核心功能</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: GitMerge, title: "多后端路由", desc: "按模型名称自动路由到 OpenAI、Anthropic、Gemini 或 OpenRouter。", color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
            { icon: FileType2, title: "多格式兼容", desc: "同时支持 OpenAI、Claude Messages、Gemini Native 三种请求格式，自动转换。", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
            { icon: Blocks, title: "工具 / 函数调用", desc: "完整支持 OpenAI tools + tool_calls，自动转换到各后端原生格式。", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
            { icon: Lightbulb, title: "扩展思考模式", desc: "Claude、Gemini、o-series 均支持 -thinking 后缀别名。", color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
            { icon: KeyRound, title: "多种认证方式", desc: "支持 Bearer Token、x-goog-api-key 请求头、?key= URL 参数三种方式。", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
            { icon: Zap, title: "流式输出 SSE", desc: "所有端点均支持 SSE 流式输出，包括 Claude 和 Gemini 原生格式端点。", color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20" },
          ].map((f) => (
            <div key={f.title} className={cn(
              "rounded-xl border p-5 flex flex-col gap-3 transition-all hover:-translate-y-1 hover:shadow-md bg-card/60 backdrop-blur-sm",
              f.border
            )}>
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", f.bg, f.color)}>
                  <f.icon size={20} />
                </div>
                <h3 className="font-semibold text-[15px]">{f.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Base URL */}
      <Card>
        <SectionTitle>Base URL {displayUrl.includes(".replit.dev") && <span className="ml-2 text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-normal normal-case">DEV</span>}</SectionTitle>
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 bg-secondary/50 border border-border/60 rounded-lg p-3 font-mono text-sm text-primary overflow-hidden text-ellipsis whitespace-nowrap shadow-inner">
            {displayUrl}
          </div>
          <CopyButton text={displayUrl} label="复制 URL" />
        </div>
        {displayUrl.includes(".replit.dev") && (
          <div className="mt-4 flex items-start gap-3 bg-secondary/30 p-3 rounded-lg border border-border/40">
             <Info size={16} className="text-muted-foreground flex-shrink-0 mt-0.5" />
             <p className="text-[13px] text-muted-foreground leading-relaxed m-0">
               当前显示为开发预览地址。将本项目 <strong className="text-foreground font-medium">Publish（发布）</strong> 后，请以生产环境域名（<code className="text-primary bg-primary/5 px-1 py-0.5 rounded mx-1">https://your-app.replit.app</code>）作为正式 Base URL 使用。
             </p>
          </div>
        )}
      </Card>

      {/* SillyTavern */}
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
      
      {/* spacing */}
      <div className="h-4" />
    </div>
  );
}
