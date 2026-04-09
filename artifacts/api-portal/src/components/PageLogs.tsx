import { useState, useEffect, useRef, useCallback } from "react";
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

const LEVEL_COLORS: Record<string, string> = {
  info: "#22c55e",
  warn: "#f59e0b",
  error: "#ef4444",
};

const STATUS_COLOR = (status: number) => status >= 500 ? "#ef4444" : status >= 400 ? "#f59e0b" : "#22c55e";

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
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>lock</div>
        <div style={{ fontSize: "15px" }}>请先在首页输入服务访问密钥</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: "10px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: connected ? "#22c55e" : "#ef4444",
            boxShadow: connected ? "0 0 8px #22c55e" : "none",
          }} />
          <span style={{ fontSize: "13px", color: connected ? "#22c55e" : "#ef4444" }}>
            {connected ? "实时连接中" : connError ? `连接失败: ${connError}` : "正在重连..."}
          </span>
          {!connected && (
            <button
              onClick={() => {
                retryCount.current = 0;
                setConnError(null);
                void connectStream();
              }}
              style={{
                fontSize: "12px", padding: "4px 10px", borderRadius: "6px",
                background: "rgba(99,102,241,0.2)", color: "#a5b4fc",
                border: "1px solid rgba(99,102,241,0.3)", cursor: "pointer",
              }}
            >
              立即重连
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {(["all", "info", "warn", "error"] as const).map((level) => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              style={{
                fontSize: "11px", padding: "3px 10px", borderRadius: "12px",
                border: "1px solid",
                borderColor: filter === level ? (LEVEL_COLORS[level] ?? "#6366f1") : "rgba(255,255,255,0.1)",
                background: filter === level ? `${LEVEL_COLORS[level] ?? "#6366f1"}22` : "transparent",
                color: filter === level ? (LEVEL_COLORS[level] ?? "#a5b4fc") : "#64748b",
                cursor: "pointer",
              }}
            >
              {level === "all" ? "全部" : level.toUpperCase()}
            </button>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#64748b", marginLeft: "8px", cursor: "pointer" }}>
            <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
            自动滚动
          </label>
          <button onClick={downloadLogs} style={{
            fontSize: "11px", padding: "3px 10px", borderRadius: "6px",
            background: "rgba(255,255,255,0.05)", color: "#94a3b8",
            border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer",
          }}>下载</button>
          <button onClick={() => setLogs([])} style={{
            fontSize: "11px", padding: "3px 10px", borderRadius: "6px",
            background: "rgba(239,68,68,0.1)", color: "#f87171",
            border: "1px solid rgba(239,68,68,0.2)", cursor: "pointer",
          }}>清空</button>
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          background: "rgba(0,0,0,0.4)", borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.06)",
          maxHeight: "500px", overflowY: "auto",
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize: "12px", lineHeight: "1.8",
          padding: "12px 16px",
        }}
      >
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#475569", padding: "40px 0" }}>
            {connected ? "等待新的日志事件..." : connError ? "请检查访问密钥是否正确，或服务端是否已配置 SERVICE_ACCESS_KEY" : "正在尝试连接服务..."}
          </div>
        )}
        {filtered.map((log) => (
          <div key={log.id} style={{
            display: "flex", gap: "8px", padding: "2px 0",
            borderBottom: "1px solid rgba(255,255,255,0.03)",
          }}>
            <span style={{ color: "#475569", flexShrink: 0 }}>{log.time.slice(11, 19)}</span>
            <span style={{ color: LEVEL_COLORS[log.level], fontWeight: 600, width: "40px", flexShrink: 0 }}>
              {log.level.toUpperCase()}
            </span>
            <span style={{ color: "#94a3b8", flexShrink: 0 }}>{log.method}</span>
            <span style={{ color: "#cbd5e1", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {log.path}
            </span>
            {log.model && <span style={{ color: "#818cf8", flexShrink: 0 }}>{log.model}</span>}
            <span style={{ color: STATUS_COLOR(log.status), flexShrink: 0 }}>{log.status}</span>
            <span style={{ color: "#64748b", flexShrink: 0 }}>{log.duration}ms</span>
            {log.stream && <span style={{ color: "#6366f1", fontSize: "10px", flexShrink: 0 }}>SSE</span>}
          </div>
        ))}
      </div>

      <div style={{ fontSize: "11px", color: "#475569", textAlign: "right" }}>
        显示 {filtered.length} 条 / 共 {logs.length} 条
      </div>
    </div>
  );
}
