import { useEffect, useMemo, useState } from "react";
import { ChevronRight, HeartPulse, X } from "lucide-react";
import { cn } from "../lib/utils";
import { servicePaths } from "../lib/service";
import { FALLBACK_VERSION_INFO, type PortalVersionInfo } from "../lib/version";

type HealthStatus = "checking" | "ok" | "error";
type HealthServiceKey = "apiServer" | "portal";
type ServiceHealthSnapshot = {
  apiServer: { status: HealthStatus; detail: string };
  portal: { status: HealthStatus; detail: string };
  checkedAt: string | null;
};
type HealthHistoryBucket = {
  hourKey: string;
  label: string;
  checks: number;
  okChecks: number;
  latencyTotalMs: number;
  latencySamples: number;
};
type HealthHistoryStore = Record<HealthServiceKey, HealthHistoryBucket[]>;

const EMPTY_HISTORY: HealthHistoryStore = {
  apiServer: [],
  portal: [],
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

function makeHourKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}`;
}

function getHourLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

function normalizeHistory(raw: unknown): HealthHistoryStore {
  const store = raw as Partial<HealthHistoryStore> | null | undefined;
  return {
    apiServer: Array.isArray(store?.apiServer) ? store.apiServer : [],
    portal: Array.isArray(store?.portal) ? store.portal : [],
  };
}

function appendHistoryEvents(
  current: HealthHistoryStore,
  events: Array<{ service: HealthServiceKey; ok: boolean; latencyMs: number | null; checkedAt: Date }>,
): HealthHistoryStore {
  return events.reduce(
    (next, event) => recordHistoryEvent(next, event.service, event.ok, event.latencyMs, event.checkedAt),
    current,
  );
}

function recordHistoryEvent(
  history: HealthHistoryStore,
  service: HealthServiceKey,
  ok: boolean,
  latencyMs: number | null,
  checkedAt: Date,
): HealthHistoryStore {
  const hourKey = makeHourKey(checkedAt);
  const label = getHourLabel(checkedAt);
  const items = [...history[service]];
  const index = items.findIndex((item) => item.hourKey === hourKey);
  const current = index >= 0
    ? { ...items[index] }
    : { hourKey, label, checks: 0, okChecks: 0, latencyTotalMs: 0, latencySamples: 0 };

  current.checks += 1;
  if (ok) current.okChecks += 1;
  if (typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0) {
    current.latencyTotalMs += latencyMs;
    current.latencySamples += 1;
  }

  if (index >= 0) items[index] = current;
  else items.push(current);

  return {
    ...history,
    [service]: items.sort((a, b) => a.hourKey.localeCompare(b.hourKey)).slice(-24),
  };
}

function buildHourlySeries(history: HealthHistoryBucket[], now: Date): Array<HealthHistoryBucket & { availability: number; avgLatencyMs: number | null }> {
  const map = new Map(history.map((item) => [item.hourKey, item]));
  const series: Array<HealthHistoryBucket & { availability: number; avgLatencyMs: number | null }> = [];

  for (let offset = 23; offset >= 0; offset--) {
    const date = new Date(now);
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() - offset);
    const hourKey = makeHourKey(date);
    const bucket = map.get(hourKey) ?? {
      hourKey,
      label: getHourLabel(date),
      checks: 0,
      okChecks: 0,
      latencyTotalMs: 0,
      latencySamples: 0,
    };

    series.push({
      ...bucket,
      availability: bucket.checks > 0 ? (bucket.okChecks / bucket.checks) * 100 : 0,
      avgLatencyMs: bucket.latencySamples > 0 ? Math.round(bucket.latencyTotalMs / bucket.latencySamples) : null,
    });
  }

  return series;
}

function getMsUntilNextHour(now: Date): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime() - now.getTime();
}

export function DashboardPage({
  baseUrl,
  displayUrl,
  apiKey,
}: {
  baseUrl: string;
  displayUrl: string;
  apiKey: string;
}) {
  const [versionInfo, setVersionInfo] = useState<PortalVersionInfo>(FALLBACK_VERSION_INFO);
  const [health, setHealth] = useState<ServiceHealthSnapshot>({
    apiServer: { status: "checking", detail: "正在检测 API 服务..." },
    portal: { status: "checking", detail: "正在检测门户前端..." },
    checkedAt: null,
  });
  const [history, setHistory] = useState<HealthHistoryStore>(EMPTY_HISTORY);
  const [openService, setOpenService] = useState<HealthServiceKey | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let nextTimer: number | null = null;
    let hourlyTimer: number | null = null;

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

    async function loadHistory() {
      if (!apiKey) return;
      try {
        const response = await fetch(servicePaths.healthHistory(baseUrl), {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled) return;
        setHistory(normalizeHistory(payload));
      } catch {
        // Keep current view if history is temporarily unavailable.
      }
    }

    void loadHistory();
    return () => { cancelled = true; };
  }, [apiKey, baseUrl]);

  useEffect(() => {
    let cancelled = false;

    async function probeJson(url: string): Promise<{ ok: boolean; status: number; latencyMs: number; payload?: unknown }> {
      const startedAt = performance.now();
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      const latencyMs = Math.round(performance.now() - startedAt);
      const payload = response.ok ? await response.json().catch(() => null) : undefined;
      return { ok: response.ok, status: response.status, latencyMs, payload };
    }

    async function probePortal(url: string): Promise<{ ok: boolean; status: number; latencyMs: number }> {
      const startedAt = performance.now();
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      return { ok: response.ok, status: response.status, latencyMs: Math.round(performance.now() - startedAt) };
    }

    async function checkHealth() {
      setHealth((prev) => ({
        ...prev,
        apiServer: { status: "checking", detail: "正在检测 API 服务..." },
        portal: { status: "checking", detail: "正在检测门户前端..." },
      }));

      const [apiResult, portalResult] = await Promise.allSettled([
        probeJson(servicePaths.healthcheck(baseUrl)),
        probePortal(`${window.location.origin}/?portal_health=${Date.now()}`),
      ]);

      if (cancelled) return;

      const checkedAt = new Date();
      const next: ServiceHealthSnapshot = {
        apiServer: { status: "error", detail: "API 服务器无响应" },
        portal: { status: "error", detail: "前端门户无响应" },
        checkedAt: checkedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      };

      let apiLatency: number | null = null;
      let portalLatency: number | null = null;
      let apiOk = false;
      let portalOk = false;

      if (apiResult.status === "fulfilled") {
        apiLatency = apiResult.value.latencyMs;
        apiOk = apiResult.value.ok;
        if (apiResult.value.ok) {
          const payload = apiResult.value.payload as { apiServer?: { uptimeSeconds?: number; version?: string } } | null | undefined;
          next.apiServer = {
            status: "ok",
            detail: `运行正常${payload?.apiServer?.version ? ` · v${payload.apiServer.version}` : ""}${typeof payload?.apiServer?.uptimeSeconds === "number" ? ` · 已运行 ${payload.apiServer.uptimeSeconds}s` : ""}${typeof apiLatency === "number" ? ` · ${apiLatency}ms` : ""}`,
          };
        } else {
          next.apiServer = { status: "error", detail: `API 检测失败（HTTP ${apiResult.value.status}）` };
        }
      }

      if (portalResult.status === "fulfilled") {
        portalLatency = portalResult.value.latencyMs;
        portalOk = portalResult.value.ok;
        if (portalResult.value.ok) {
          next.portal = { status: "ok", detail: `前端门户可访问${typeof portalLatency === "number" ? ` · ${portalLatency}ms` : ""}` };
        } else {
          next.portal = { status: "error", detail: `前端检测失败（HTTP ${portalResult.value.status}）` };
        }
      }

      setHealth(next);

      const events = [
        { service: "apiServer" as const, ok: apiOk, latencyMs: apiLatency, checkedAt },
        { service: "portal" as const, ok: portalOk, latencyMs: portalLatency, checkedAt },
      ];

      setHistory((current) => appendHistoryEvents(current, events));

      if (apiKey) {
        void fetch(servicePaths.healthHistory(baseUrl), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            events: events.map((event) => ({
              service: event.service,
              ok: event.ok,
              latencyMs: event.latencyMs,
              checkedAt: event.checkedAt.toISOString(),
            })),
          }),
        }).then(async (response) => {
          if (!response.ok) return;
          const payload = await response.json().catch(() => null);
          if (!cancelled && payload) setHistory(normalizeHistory(payload));
        }).catch(() => null);
      }
    }

    void checkHealth();
    nextTimer = window.setTimeout(() => {
      void checkHealth();
      hourlyTimer = window.setInterval(() => { void checkHealth(); }, 60 * 60 * 1000);
    }, getMsUntilNextHour(new Date()));

    return () => {
      cancelled = true;
      if (nextTimer !== null) window.clearTimeout(nextTimer);
      if (hourlyTimer !== null) window.clearInterval(hourlyTimer);
    };
  }, [apiKey, baseUrl]);

  const greeting = useMemo(() => getGreeting(now.getHours()), [now]);
  const timeText = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dateText = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const versionDateText = versionInfo.releaseDate.replace(/-/g, "/");
  const statusBadge = (status: HealthStatus) => {
    if (status === "ok") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    if (status === "error") return "bg-destructive/10 text-destructive border-destructive/20";
    return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
  };

  const selectedService = openService ?? "apiServer";
  const selectedSeries = useMemo(() => buildHourlySeries(history[selectedService], now), [history, now, selectedService]);
  const selectedSummary = useMemo(() => {
    const checks = selectedSeries.reduce((sum, item) => sum + item.checks, 0);
    const okChecks = selectedSeries.reduce((sum, item) => sum + item.okChecks, 0);
    const latencySamples = selectedSeries.reduce((sum, item) => sum + item.latencySamples, 0);
    const latencyTotalMs = selectedSeries.reduce((sum, item) => sum + item.latencyTotalMs, 0);
    return {
      checks,
      availability: checks > 0 ? Math.round((okChecks / checks) * 100) : 0,
      avgLatencyMs: latencySamples > 0 ? Math.round(latencyTotalMs / latencySamples) : null,
    };
  }, [selectedSeries]);

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

      <Card>
        <div className="flex items-center gap-2 mb-4 text-primary">
          <HeartPulse size={18} />
          <h2 className="text-sm font-bold tracking-widest uppercase">实时健康检查</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: "apiServer" as const, label: "API 服务器", value: health.apiServer },
            { key: "portal" as const, label: "前端门户", value: health.portal },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setOpenService(item.key)}
              className={cn(
                "rounded-xl border border-border/60 bg-secondary/20 p-4 text-left transition-all hover:border-primary/40 hover:bg-secondary/30",
              )}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="font-semibold text-sm">{item.label}</div>
                <div className="flex items-center gap-2">
                  <span className={cn("text-[11px] px-2 py-1 rounded-full border font-medium", statusBadge(item.value.status))}>
                    {item.value.status === "ok" ? "正常" : item.value.status === "error" ? "异常" : "检测中"}
                  </span>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed m-0">{item.value.detail}</p>
            </button>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {health.checkedAt ? `上次检测：${health.checkedAt} · 每小时自动检测一次，点击卡片查看 24 小时历史` : "正在初始化健康检查..."}
        </div>
      </Card>

      {openService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-2xl border border-border/60 bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border/50 px-6 py-5">
              <div>
                <div className="text-lg font-semibold">{openService === "apiServer" ? "API 服务器" : "前端门户"} 24 小时可用性</div>
                <div className="mt-1 text-sm text-muted-foreground">历史会写入服务端持久化存储，不同设备登录后看到的是同一份检测记录。</div>
              </div>
              <button
                type="button"
                onClick={() => setOpenService(null)}
                className="rounded-lg border border-border/50 p-2 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-3">
                  <div className="text-[11px] text-muted-foreground mb-1">平均可用率</div>
                  <div className="text-lg font-bold">{selectedSummary.availability}%</div>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-3">
                  <div className="text-[11px] text-muted-foreground mb-1">检测次数</div>
                  <div className="text-lg font-bold">{selectedSummary.checks}</div>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-3">
                  <div className="text-[11px] text-muted-foreground mb-1">平均延迟</div>
                  <div className="text-lg font-bold">{selectedSummary.avgLatencyMs !== null ? `${selectedSummary.avgLatencyMs}ms` : "--"}</div>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/60 p-5">
                <div className="grid grid-cols-12 md:grid-cols-24 gap-2 items-end h-52">
                  {selectedSeries.map((item) => (
                    <div key={item.hourKey} className="flex flex-col items-center gap-2 min-w-0">
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className={cn(
                            "w-full rounded-t-md transition-all",
                            item.checks === 0
                              ? "bg-muted/70 border border-dashed border-border/70"
                              : item.availability >= 99
                                ? "bg-emerald-500/80"
                                : item.availability >= 80
                                  ? "bg-amber-500/80"
                                  : "bg-destructive/80"
                          )}
                          style={{ height: `${Math.max(item.checks > 0 ? item.availability : 8, 8)}%` }}
                          title={`${item.label} · 可用率 ${Math.round(item.availability)}% · 检测 ${item.checks} 次${item.avgLatencyMs !== null ? ` · 平均 ${item.avgLatencyMs}ms` : ""}`}
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">{item.label.slice(0, 2)}</div>
                    </div>
                  ))}
                </div>
                {selectedSummary.checks === 0 && (
                  <div className="mt-4 text-sm text-muted-foreground">
                    当前还没有可展示的历史检测结果。登录后会先做一次即时检测，之后每小时自动补一条记录。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
