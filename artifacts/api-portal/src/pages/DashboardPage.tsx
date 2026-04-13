import { useEffect, useMemo, useState } from "react";
import { HeartPulse, Info } from "lucide-react";
import { cn } from "../lib/utils";
import { servicePaths } from "../lib/service";
import { FALLBACK_VERSION_INFO, type PortalVersionInfo } from "../lib/version";

type HealthStatus = "checking" | "ok" | "error";
type ServiceHealthSnapshot = {
  apiServer: { status: HealthStatus; detail: string };
  portal: { status: HealthStatus; detail: string };
  checkedAt: string | null;
};

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
}) {
  const [versionInfo, setVersionInfo] = useState<PortalVersionInfo>(FALLBACK_VERSION_INFO);
  const [health, setHealth] = useState<ServiceHealthSnapshot>({
    apiServer: { status: "checking", detail: "正在检测 API 服务..." },
    portal: { status: "checking", detail: "正在检测门户前端..." },
    checkedAt: null,
  });
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

    async function checkHealth() {
      setHealth((prev) => ({
        ...prev,
        apiServer: { status: "checking", detail: "正在检测 API 服务..." },
        portal: { status: "checking", detail: "正在检测门户前端..." },
      }));

      const [apiResult, portalResult] = await Promise.allSettled([
        fetch(servicePaths.healthcheck(baseUrl), { cache: "no-store", signal: AbortSignal.timeout(5000) }),
        fetch(`${window.location.origin}/?portal_health=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(5000) }),
      ]);

      if (cancelled) return;

      const next: ServiceHealthSnapshot = {
        apiServer: { status: "error", detail: "API 服务器无响应" },
        portal: { status: "error", detail: "前端门户无响应" },
        checkedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      };

      if (apiResult.status === "fulfilled" && apiResult.value.ok) {
        const payload = await apiResult.value.json().catch(() => null) as { apiServer?: { uptimeSeconds?: number; version?: string } } | null;
        next.apiServer = {
          status: "ok",
          detail: `运行正常${payload?.apiServer?.version ? ` · v${payload.apiServer.version}` : ""}${typeof payload?.apiServer?.uptimeSeconds === "number" ? ` · 已运行 ${payload.apiServer.uptimeSeconds}s` : ""}`,
        };
      } else if (apiResult.status === "fulfilled") {
        next.apiServer = { status: "error", detail: `API 检测失败（HTTP ${apiResult.value.status}）` };
      }

      if (portalResult.status === "fulfilled" && portalResult.value.ok) {
        next.portal = { status: "ok", detail: "前端门户可访问" };
      } else if (portalResult.status === "fulfilled") {
        next.portal = { status: "error", detail: `前端检测失败（HTTP ${portalResult.value.status}）` };
      }

      setHealth(next);
    }

    void checkHealth();
    const timer = window.setInterval(() => { void checkHealth(); }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [baseUrl]);

  const greeting = useMemo(() => getGreeting(now.getHours()), [now]);
  const timeText = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dateText = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const versionDateText = versionInfo.releaseDate.replace(/-/g, "/");

  const statusBadge = (status: HealthStatus) => {
    if (status === "ok") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    if (status === "error") return "bg-destructive/10 text-destructive border-destructive/20";
    return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20 shadow-md shadow-primary/5">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="text-sm font-bold tracking-widest uppercase text-primary/80">仪表盘</div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-2">{greeting.title}</h1>
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
          <p className="text-sm text-muted-foreground leading-relaxed ml-1">{versionInfo.releaseNotes}</p>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-4 text-primary">
          <HeartPulse size={18} />
          <h2 className="text-sm font-bold tracking-widest uppercase">实时健康检查</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: "API 服务器", value: health.apiServer },
            { label: "前端门户", value: health.portal },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="font-semibold text-sm">{item.label}</div>
                <span className={cn("text-[11px] px-2 py-1 rounded-full border font-medium", statusBadge(item.value.status))}>
                  {item.value.status === "ok" ? "正常" : item.value.status === "error" ? "异常" : "检测中"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed m-0">{item.value.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {health.checkedAt ? `上次检测：${health.checkedAt}` : "正在初始化健康检查..."}
        </div>
      </Card>
    </div>
  );
}
