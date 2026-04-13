import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { servicePaths } from "../lib/service";
import { FALLBACK_VERSION_INFO, type PortalVersionInfo } from "../lib/version";

type OnlineStatus = "checking" | "online" | "offline";

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

export function DashboardPage({
  baseUrl,
  displayUrl,
}: {
  baseUrl: string;
  displayUrl: string;
  apiKey: string;
}) {
  const [versionInfo, setVersionInfo] = useState<PortalVersionInfo>(FALLBACK_VERSION_INFO);
  const [onlineStatus, setOnlineStatus] = useState<OnlineStatus>("checking");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
        // Keep fallback version info.
      }
    }

    void loadVersionInfo();
    return () => { cancelled = true; };
  }, [displayUrl]);

  useEffect(() => {
    let cancelled = false;

    async function checkOnline() {
      setOnlineStatus("checking");
      try {
        const response = await fetch(servicePaths.status(baseUrl), {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (cancelled) return;
        setOnlineStatus(response.ok ? "online" : "offline");
      } catch {
        if (cancelled) return;
        setOnlineStatus("offline");
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
  const versionDateText = versionInfo.releaseDate.replace(/-/g, "/");

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
      <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20 shadow-md shadow-primary/5">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="text-sm font-bold tracking-widest uppercase text-primary/80">仪表盘</div>
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">{greeting.title}</h1>
                <span className={cn("text-[11px] px-3 py-1.5 rounded-full border font-medium whitespace-nowrap", statusPillClassName)}>
                  {statusLabel}
                </span>
              </div>
              <p className="text-base text-muted-foreground leading-relaxed">{greeting.subtitle}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 min-w-[240px]">
            <div className="rounded-xl border border-border/50 bg-background/70 p-4">
              <div className="text-xs text-muted-foreground mb-1">当前时间</div>
              <div className="text-3xl font-bold font-mono tracking-tight">{timeText}</div>
              <div className="text-xs text-muted-foreground mt-2">{dateText}</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/70 p-4">
              <div className="text-xs text-muted-foreground mb-1">当前版本</div>
              <div className="text-2xl font-bold font-mono tracking-tight">v{versionInfo.version}</div>
              <div className="text-xs text-muted-foreground mt-2">{versionDateText}</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
