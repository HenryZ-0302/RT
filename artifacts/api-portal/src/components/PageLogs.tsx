import { useState, useEffect, useRef, useCallback } from "react";
import { Download, Trash2, Activity, Play, Filter, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";
import { servicePaths } from "../lib/service";

interface LogEntry {
  id: number;
  time: string;
  method: string;
  path: string;
  model?: string;
  backend?: string;
  status: number;
  duration: number;
  stream: boolean;
  promptTokens?: number;
  completionTokens?: number;
  level: "info" | "warn" | "error";
  error?: string;
}

const LEVEL_STYLE = {
  info: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  warn: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  error: "text-destructive bg-destructive/10 border-destructive/20",
};

const STATUS_COLOR_TEXT = (status: number) => status >= 500 ? "text-destructive font-bold" : status >= 400 ? "text-amber-500 font-bold" : "text-emerald-500";

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card text-card-foreground rounded-xl border border-border/50 shadow-sm p-4 md:p-5", className)}>
      {children}
    </div>
  );
}

export default function PageLogs({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "info" | "warn" | "error">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);
  const unmounted = useRef(false);

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (unmounted.current) return;
    const delay = Math.min(2000 * Math.pow(2, retryCount.current), 30000);
    retryCount.current++;
    reconnectTimer.current = setTimeout(() => {
      if (!unmounted.current) void connectStream();
    }, delay);
  }, []);

  const connectStream = useCallback(async () => {
    if (!apiKey || unmounted.current) return;
    cleanup();

    try {
      const historyResponse = await fetch(servicePaths.logs(baseUrl), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!historyResponse.ok) {
        const body = await historyResponse.json().catch(() => ({}));
        const message = body?.error?.message || `HTTP ${historyResponse.status}`;
        setConnError(message);
        setConnected(false);
        scheduleReconnect();
        return;
      }

      const historyData = await historyResponse.json();
      if (historyData.logs && !unmounted.current) setLogs(historyData.logs);
    } catch {}

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(servicePaths.logsStream(baseUrl, apiKey), {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = body?.error?.message || `HTTP ${response.status}`;
        setConnError(message);
        setConnected(false);
        scheduleReconnect();
        return;
      }

      setConnected(true);
      setConnError(null);
      retryCount.current = 0;

      const reader = response.body?.getReader();
      if (!reader) {
        scheduleReconnect();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done || unmounted.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const entry = JSON.parse(line.slice(6)) as LogEntry;
            setLogs((prev) => {
              const next = [...prev, entry];
              return next.length > 200 ? next.slice(-200) : next;
            });
          } catch {}
        }
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }

    if (!unmounted.current) {
      setConnected(false);
      scheduleReconnect();
    }
  }, [apiKey, baseUrl, cleanup, scheduleReconnect]);

  useEffect(() => {
    unmounted.current = false;
    void connectStream();
    return () => {
      unmounted.current = true;
      cleanup();
      setConnected(false);
    };
  }, [cleanup, connectStream]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = filter === "all" ? logs : logs.filter((log) => log.level === filter);

  const downloadLogs = () => {
    const text = filtered.map((log) =>
      `[${log.time}] ${log.level.toUpperCase()} ${log.method} ${log.path} -> ${log.status} ${log.duration}ms ${log.model ?? ""} (${log.backend ?? ""})`
    ).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `service-logs-${new Date().toISOString().slice(0, 10)}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!apiKey) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border-dashed border-2 border-border/50 rounded-xl bg-card/50 min-h-[400px]">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-muted-foreground mb-4">
           <AlertCircle size={32} />
        </div>
        <h2 className="text-xl font-bold mb-2">需要认证</h2>
        <p className="text-muted-foreground max-w-sm">请先在首页填写 API Key 才能查看实时系统日志。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-6xl mx-auto h-[calc(100vh-120px)] flex flex-col">
      <Card className="flex-shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4 py-3 md:py-3 shadow-none bg-secondary/30">
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2">
            <div className={cn("w-2.5 h-2.5 rounded-full shadow-sm", connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.4)] animate-pulse")} />
            <span className={cn("text-xs font-semibold tracking-wide", connected ? "text-green-500" : "text-destructive")}>
              {connected ? "实时监听中" : connError ? `连接失败: ${connError}` : "正在重连..."}
            </span>
          </div>
          
          {!connected && (
            <button
              onClick={() => { retryCount.current = 0; setConnError(null); void connectStream(); }}
              className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors font-medium"
            >
              <RefreshCw size={12} className={!connected && !connError ? "animate-spin" : ""} /> 立即重连
            </button>
          )}

          <div className="w-px h-6 bg-border hidden md:block mx-1" />

          {/* Level Filters */}
          <div className="flex items-center gap-1 bg-background p-1 rounded-lg border border-border/80">
            {(["all", "info", "warn", "error"] as const).map((level) => (
               <button
                 key={level}
                 onClick={() => setFilter(level)}
                 className={cn(
                   "text-xs px-3 py-1 rounded-md font-medium transition-colors",
                   filter === level 
                    ? level === "all" ? "bg-primary/15 text-primary" : LEVEL_STYLE[level]
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                 )}
               >
                 {level === "all" ? "全部" : level.toUpperCase()}
               </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors mr-2">
            <input 
              type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} 
              className="w-4 h-4 rounded text-primary focus:ring-primary/20"
            />
            <span className="flex items-center gap-1"><Play size={10} className={autoScroll ? "text-primary" : ""} /> 自动滚动</span>
          </label>
          <button 
             onClick={downloadLogs} 
             className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 rounded border shadow-sm transition-colors"
          >
             <Download size={12} /> 下载 Logs
          </button>
          <button 
             onClick={() => setLogs([])} 
             className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 rounded shadow-sm transition-colors"
          >
             <Trash2 size={12} /> 清空面板
          </button>
        </div>
      </Card>

      {/* Log Terminal Window */}
      <div className="flex-1 bg-zinc-950 dark:bg-[#0a0a0a] rounded-xl border border-zinc-800 dark:border-border overflow-hidden relative shadow-inner group">
        
        {/* Terminal Header */}
        <div className="absolute top-0 left-0 right-0 h-8 bg-zinc-900/80 border-b border-zinc-800 backdrop-blur-sm flex items-center px-4 justify-between select-none z-10 transition-opacity opacity-0 group-hover:opacity-100">
           <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-zinc-700 hover:bg-red-500 transition-colors" />
              <div className="w-3 h-3 rounded-full bg-zinc-700 hover:bg-amber-500 transition-colors" />
              <div className="w-3 h-3 rounded-full bg-zinc-700 hover:bg-green-500 transition-colors" />
           </div>
           <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
               <Activity size={10} /> 实时监控面板
           </div>
           <div className="w-20" /> {/* Spacer */}
        </div>

        {/* Logs Output */}
        <div 
          ref={scrollRef}
          className="absolute inset-0 top-0 pt-4 pb-4 overflow-y-auto px-4 !font-mono text-[12px] leading-relaxed subpixel-antialiased"
        >
          {filtered.length === 0 && (
             <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
               {connected ? (
                 <>
                   <Activity size={24} className="animate-pulse opacity-50" />
                   <span>等待接入新的日志事件...</span>
                 </>
               ) : connError ? (
                 <>
                   <AlertCircle size={24} className="text-red-500 opacity-50" />
                   <span className="text-red-400/80">请求被拒绝。请检查您的 API Key 凭据</span>
                 </>
               ) : (
                 <>
                   <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
                   <span>正在尝试建立安全连接...</span>
                 </>
               )}
             </div>
          )}

          {filtered.map((log) => (
             <div key={log.id} className="flex gap-4 py-1.5 border-b border-zinc-800/50 hover:bg-zinc-800/30 px-2 -mx-2 rounded transition-colors group/row">
               <span className="text-zinc-500 flex-shrink-0 select-none w-20">{log.time.slice(11, 19)}</span>
               
               <div className="w-16 flex-shrink-0">
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider", 
                    log.level === 'info' && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                    log.level === 'warn' && "bg-amber-500/10 text-amber-400 border border-amber-500/20",
                    log.level === 'error' && "bg-red-500/10 text-red-400 border border-red-500/20"
                  )}>
                    {log.level}
                  </span>
               </div>
               
               <span className="text-zinc-400 w-16 flex-shrink-0 font-medium">{log.method}</span>
               
               <span className="text-zinc-300 flex-1 truncate" title={log.path}>
                 {log.path}
               </span>
               
               <div className="flex items-center gap-4 flex-shrink-0 justify-end w-64">
                 {log.model ? (
                   <span className="text-indigo-400 truncate max-w-[120px]" title={log.model}>{log.model}</span>
                 ) : (
                   <span className="w-[120px]" />
                 )}
                 
                 <span className={cn("w-10 text-right shrink-0", STATUS_COLOR_TEXT(log.status))}>{log.status}</span>
                 
                 <span className="text-zinc-500 w-14 text-right shrink-0">{log.duration}ms</span>
                 
                 <div className="w-8 flex justify-end shrink-0">
                    {log.stream && <span className="text-[9px] font-bold text-violet-400 border border-violet-400/30 bg-violet-400/10 px-1 rounded">SSE</span>}
                 </div>
               </div>
             </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground px-1 pb-4">
         <div className="flex items-center gap-1.5 opacity-60">
            <Filter size={12} /> 筛选结果: {filtered.length} 条
         </div>
         <div>
            共收集 <span className="font-mono">{logs.length}</span> / 会话限制 200 条
         </div>
      </div>
    </div>
  );
}
