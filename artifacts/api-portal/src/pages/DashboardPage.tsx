import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";
import { servicePaths } from "../lib/service";
import { FALLBACK_VERSION_INFO, fetchPortalVersionInfo, type PortalVersionInfo } from "../lib/version";

type OnlineStatus = "checking" | "online" | "offline";
type HealthcheckPayload = {
  timestamp?: string;
  apiServer?: {
    status?: string;
    uptimeSeconds?: number;
    version?: string;
  };
};

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card text-card-foreground rounded-xl border border-border/50 shadow-sm p-6 overflow-hidden relative", className)}>
      {children}
    </div>
  );
}

function getGreeting(hour: number): { title: string; subtitle: string } {
  if (hour < 5) return { title: "夜深了", subtitle: "收尾一下今天的工作，也别忘了早点休息。" };
  if (hour < 11) return { title: "早上好", subtitle: "新的一天开始了，先把关键事项理顺吧。" };
  if (hour < 14) return { title: "中午好", subtitle: "节奏保持得不错，下午继续稳稳推进。" };
  if (hour < 18) return { title: "下午好", subtitle: "已经推进不少了，把重点任务继续压实。" };
  return { title: "晚上好", subtitle: "欢迎回来，今天辛苦了，收尾工作做好哦。" };
}

function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || totalSeconds < 0) return "--";
  if (totalSeconds < 60) return `${totalSeconds} 秒`;

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function formatCheckTime(value: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function DashboardPage({
  baseUrl,
}: {
  baseUrl: string;
}) {
  const [versionInfo, setVersionInfo] = useState<PortalVersionInfo>(FALLBACK_VERSION_INFO);
  const [onlineStatus, setOnlineStatus] = useState<OnlineStatus>("checking");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [uptimeSeconds, setUptimeSeconds] = useState<number | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadVersionInfo = useCallback(async () => {
    setUpdateChecking(true);
    try {
      const data = await fetchPortalVersionInfo(baseUrl);
      setVersionInfo(data);
    } catch {
      // Keep fallback version info.
    } finally {
      setUpdateChecking(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void loadVersionInfo();
  }, [loadVersionInfo]);

  useEffect(() => {
    let cancelled = false;

    async function checkOnline() {
      setOnlineStatus("checking");
      try {
        const response = await fetch(servicePaths.healthcheck(baseUrl), {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          if (cancelled) return;
          setOnlineStatus("offline");
          setUptimeSeconds(null);
          return;
        }

        const payload = await response.json() as HealthcheckPayload;
        if (cancelled) return;
        setOnlineStatus(payload.apiServer?.status === "ok" ? "online" : "offline");
        setUptimeSeconds(typeof payload.apiServer?.uptimeSeconds === "number" ? payload.apiServer.uptimeSeconds : null);
        setHealthCheckedAt(payload.timestamp ?? new Date().toISOString());
      } catch {
        if (cancelled) return;
        setOnlineStatus("offline");
        setUptimeSeconds(null);
      }
    }

    void checkOnline();
    const timer = window.setInterval(() => { void checkOnline(); }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [baseUrl]);

  const greeting = useMemo(() => getGreeting(now.getHours()), [now]);
  const timeText = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dateText = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const versionDateText = (versionInfo.releaseDate ?? FALLBACK_VERSION_INFO.releaseDate ?? "").replace(/-/g, "/");
  const latestVersionText = versionInfo.latestVersion
    ? `v${versionInfo.latestVersion}`
    : versionInfo.checkError
      ? "未检测到"
      : `v${versionInfo.version}`;
  const versionHintText = versionInfo.hasUpdate
    ? `发现新版本，当前可更新到 ${latestVersionText}`
    : versionInfo.checkError
      ? "更新检测失败，可手动重试"
      : "当前已是最新版本";
  const uptimeText = formatDuration(uptimeSeconds);
  const checkedAtText = formatCheckTime(healthCheckedAt);

  const statusPillClassName =
    onlineStatus === "online"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
      : onlineStatus === "offline"
        ? "bg-destructive/10 text-destructive border-destructive/20"
        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";

  const statusLabel =
    onlineStatus === "online"
      ? "在线"
      : onlineStatus === "offline"
        ? "离线"
        : "检测中";

  return (
    <div className="space-y-6 max-w-5xl">
      <Card className="border-primary/20 shadow-[0_28px_90px_-54px_rgba(37,99,235,0.65)] bg-gradient-to-br from-white/80 via-primary/5 to-transparent dark:from-slate-950/60 dark:via-primary/10 dark:to-transparent">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute right-[-5rem] top-[-4rem] h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute bottom-[-5rem] left-[-3rem] h-40 w-40 rounded-full bg-amber-300/15 blur-3xl" />
        </div>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-primary/15 bg-white/75 dark:bg-slate-900/55 px-3 py-1.5 text-[11px] font-bold tracking-[0.28em] uppercase text-primary/80">控制台总览</div>
            <div>
              <div className="mb-2">
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">{greeting.title}</h1>
              </div>
              <p className="text-base text-muted-foreground leading-relaxed">{greeting.subtitle}</p>
            </div>
          </div>
          <div className="min-w-[240px]">
            <div className="rounded-xl border border-border/50 bg-background/70 p-4">
              <div className="text-xs text-muted-foreground mb-1">当前时间</div>
              <div className="text-3xl font-bold font-mono tracking-tight">{timeText}</div>
              <div className="text-xs text-muted-foreground mt-2">{dateText}</div>
            </div>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/50 bg-white/70 dark:bg-slate-950/42">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary/75">
                <Activity size={14} />
                服务运行状态
              </div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">{uptimeText}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {onlineStatus === "online" ? "API Server 正在稳定运行。" : onlineStatus === "offline" ? "API Server 当前未响应。" : "正在拉取运行状态..."}
              </p>
            </div>
            <span className={cn("text-[11px] px-3 py-1.5 rounded-full border font-medium whitespace-nowrap", statusPillClassName)}>
              {statusLabel}
            </span>
          </div>
          <div className="mt-5">
            <div className="rounded-xl border border-border/50 bg-background/70 p-4">
              <div className="text-xs text-muted-foreground">最近检查</div>
              <div className="mt-2 text-lg font-mono font-bold tracking-tight">{checkedAtText}</div>
            </div>
          </div>
        </Card>
        <Card className="border-border/50 bg-white/70 dark:bg-slate-950/42">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary/75">
                <RefreshCw size={14} />
                版本与更新
              </div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">v{versionInfo.version}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{versionHintText}</p>
            </div>
            <button
              onClick={() => void loadVersionInfo()}
              disabled={updateChecking}
              className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-background/80 px-3 py-2 text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-50"
            >
              {updateChecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              检测更新
            </button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/50 bg-background/70 p-4">
              <div className="text-xs text-muted-foreground">当前版本日期</div>
              <div className="mt-2 text-lg font-mono font-bold tracking-tight">{versionDateText}</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/70 p-4">
              <div className="text-xs text-muted-foreground">最新版本</div>
              <div className="mt-2 text-lg font-mono font-bold tracking-tight">{latestVersionText}</div>
            </div>
          </div>
          {versionInfo.upstreamRepoUrl && (
            <a
              href={versionInfo.upstreamRepoUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80"
            >
              打开上游仓库
              <ArrowUpRight size={14} />
            </a>
          )}
        </Card>
      </div>
    </div>
  );
}
