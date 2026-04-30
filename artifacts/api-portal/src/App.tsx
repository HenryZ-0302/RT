import { useState, useEffect, useCallback } from "react";
import { Route, Switch, Router } from "wouter";
import SetupWizard from "./components/SetupWizard";
import PageLogs from "./components/PageLogs";
import { AppLayout } from "./layouts/AppLayout";
import { ThemeProvider } from "./components/theme-provider";
import { DashboardPage } from "./pages/DashboardPage";
import { DocsPage } from "./pages/DocsPage";
import { ChatPage } from "./pages/ChatPage";
import { HomePage } from "./pages/HomePage";
import { NodesPage } from "./pages/NodesPage";
import { StatsPage } from "./pages/StatsPage";
import { ModelsPage } from "./pages/ModelsPage";
import { getStoredServiceKey, servicePaths, storeServiceKey } from "./lib/service";

// Define the types that App needs for State management
type BackendStat = { calls: number; errors: number; streamingCalls: number; promptTokens: number; completionTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number; totalTokens: number; avgDurationMs: number; avgTtftMs: number | null; health: string; url?: string; dynamic?: boolean; enabled?: boolean };
type ModelStat = { calls: number; promptTokens: number; completionTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number; capability?: "chat" | "image" };
interface ModelStatus { id: string; description?: string; provider: string; group: string; capability: "chat" | "image"; testMode: "chat" | "image"; enabled: boolean }
type GroupSummary = { total: number; enabled: number };
type PromptCacheSettings = { enabled: boolean; ttl: "5m" | "1h" };
type MetricsResponse = {
  stats?: Record<string, Record<string, unknown>>;
  modelStats?: Record<string, ModelStat>;
  routing?: { localEnabled: boolean; localFallback: boolean; fakeStream: boolean };
};
type DataError = false | "auth" | "server" | "network";

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [sillyTavernMode, setSillyTavernMode] = useState(false);
  const [stLoading, setStLoading] = useState(false);
  const [promptCache, setPromptCache] = useState<PromptCacheSettings>({ enabled: true, ttl: "5m" });
  const [promptCacheLoading, setPromptCacheLoading] = useState(false);
  const [apiKey, setApiKey] = useState(() => getStoredServiceKey());
  const [gateKey, setGateKey] = useState(() => getStoredServiceKey());
  const [gateReady, setGateReady] = useState(false);
  const [gateUnlocked, setGateUnlocked] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState("");
  const [wizardChecking, setWizardChecking] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [stats, setStats] = useState<Record<string, BackendStat> | null>(null);
  const [modelStats, setModelStats] = useState<Record<string, ModelStat> | null>(null);
  const [statsError, setStatsError] = useState<DataError>(false);
  const [routing, setRouting] = useState<{ localEnabled: boolean; localFallback: boolean; fakeStream: boolean }>({ localEnabled: true, localFallback: true, fakeStream: true });
  const [addUrl, setAddUrl] = useState("");
  const [addState, setAddState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [addMsg, setAddMsg] = useState("");
  const [modelStatus, setModelStatus] = useState<ModelStatus[]>([]);
  const [modelSummary, setModelSummary] = useState<Record<string, GroupSummary>>({});

  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)
    ?? (import.meta.env.VITE_BASE_URL as string | undefined);
  const baseUrl = configuredBaseUrl ?? window.location.origin;
  const displayUrl: string = configuredBaseUrl ?? window.location.origin;

  const applyMetricsPayload = useCallback((payload: MetricsResponse) => {
    const parsed: Record<string, BackendStat> = {};
    for (const [k, v] of Object.entries(payload.stats ?? {})) {
      parsed[k] = { ...(v as unknown as BackendStat), streamingCalls: (v.streamingCalls as number) ?? 0 };
    }
    setStats(parsed);
    setStatsError(false);
    setModelStats(payload.modelStats && typeof payload.modelStats === "object" ? payload.modelStats : null);
    if (payload.routing) setRouting(payload.routing);
  }, []);
  
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(servicePaths.status(baseUrl), { signal: AbortSignal.timeout(5000) });
      setOnline(res.ok);
    } catch { setOnline(false); }
  }, [baseUrl]);

  const fetchSTMode = useCallback(async (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) {
      setStLoading(false);
      return;
    }

    setStLoading(true);
    try {
      const res = await fetch(servicePaths.compatibility(baseUrl), {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (res.ok) {
        const d = await res.json();
        setSillyTavernMode(Boolean(d.enabled));
      }
    } catch {}
    finally {
      setStLoading(false);
    }
  }, [baseUrl]);

  const toggleSTMode = async () => {
    const newVal = !sillyTavernMode;
    setSillyTavernMode(newVal);
    try {
      const res = await fetch(servicePaths.compatibility(baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ enabled: newVal }),
      });
      if (!res.ok) setSillyTavernMode(!newVal);
    } catch { setSillyTavernMode(!newVal); }
  };

  const fetchPromptCache = useCallback(async (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;

    setPromptCacheLoading(true);
    try {
      const res = await fetch(servicePaths.promptCache(baseUrl), {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (res.ok) {
        const data = await res.json() as Partial<PromptCacheSettings>;
        setPromptCache({
          enabled: data.enabled === true,
          ttl: data.ttl === "1h" ? "1h" : "5m",
        });
      }
    } catch {}
    finally {
      setPromptCacheLoading(false);
    }
  }, [baseUrl]);

  const updatePromptCache = useCallback(async (patch: Partial<PromptCacheSettings>) => {
    if (!apiKey) return;
    const next = { ...promptCache, ...patch };
    setPromptCache(next);
    setPromptCacheLoading(true);
    try {
      const res = await fetch(servicePaths.promptCache(baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setPromptCache(promptCache);
        return;
      }
      const data = await res.json() as Partial<PromptCacheSettings>;
      setPromptCache({
        enabled: data.enabled === true,
        ttl: data.ttl === "1h" ? "1h" : "5m",
      });
    } catch {
      setPromptCache(promptCache);
    } finally {
      setPromptCacheLoading(false);
    }
  }, [apiKey, baseUrl, promptCache]);

  const verifyServiceKey = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) {
      setGateError("请输入服务密钥。");
      setGateReady(true);
      setGateUnlocked(false);
      setStLoading(false);
      return false;
    }

    setGateLoading(true);
    setGateError("");
    try {
      const response = await fetch(servicePaths.metrics(baseUrl), {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!response.ok) {
        if (response.status === 401) {
          setGateError("服务密钥不正确，请重新输入。");
        } else if (response.status === 500) {
          setGateError("服务端尚未完成初始化，请先确认部署环境已配置 SERVICE_ACCESS_KEY。");
        } else {
          setGateError(`验证失败（HTTP ${response.status}）。`);
        }
        setGateReady(true);
        setGateUnlocked(false);
        setStLoading(false);
        return false;
      }

      const data = await response.json() as MetricsResponse;
      setApiKey(trimmed);
      setGateKey(trimmed);
      storeServiceKey(trimmed);
      applyMetricsPayload(data);
      setStLoading(true);
      setGateUnlocked(true);
      setGateReady(true);
      return true;
    } catch {
      setGateError("无法连接到服务，请稍后重试。");
      setGateReady(true);
      setGateUnlocked(false);
      setStLoading(false);
      return false;
    } finally {
      setGateLoading(false);
    }
  }, [applyMetricsPayload, baseUrl]);

  const openSetupWizard = useCallback(async () => {
    setWizardChecking(true);
    setGateError("");
    try {
      const response = await fetch(servicePaths.bootstrap(baseUrl), {
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const status = await response.json() as { configured?: boolean; integrationsReady?: boolean; storageReady?: boolean };
        if (status.configured && status.integrationsReady && status.storageReady) {
          setGateError("服务已配置完成，无需操作，直接登录即可。");
          return;
        }
      }
      setShowWizard(true);
    } catch {
      setShowWizard(true);
    } finally {
      setWizardChecking(false);
    }
  }, [baseUrl]);

  const fetchStats = useCallback(async (key: string) => {
    if (!key) { setStats(null); setModelStats(null); setStatsError(false); return; }
    try {
      const r = await fetch(servicePaths.metrics(baseUrl), { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) {
        setStatsError(r.status === 500 ? "server" : "auth");
        return;
      }
      const d = await r.json() as MetricsResponse;
      applyMetricsPayload(d);
    } catch {
      setStatsError("network");
    }
  }, [applyMetricsPayload, baseUrl]);

  const refreshStats = useCallback(() => {
    if (!apiKey) return;
    void fetchStats(apiKey);
  }, [apiKey, fetchStats]);

  const addBackend = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = addUrl.trim().replace(/\/+$/, "");
    if (!url) return;
    setAddState("loading");
    try {
      const r = await fetch(servicePaths.backends(baseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: /\/api$/i.test(url) ? url : url + "/api" }),
      });
      const data = await r.json();
      if (!r.ok) { setAddState("err"); setAddMsg(data.error ?? "Failed"); return; }
      setAddState("ok"); setAddMsg(`已添加 ${data.label}`); setAddUrl("");
      setTimeout(() => setAddState("idle"), 3000);
      fetchStats(apiKey);
    } catch { setAddState("err"); setAddMsg("网络错误"); }
  };

  const removeBackend = async (label: string) => {
    await fetch(servicePaths.backend(baseUrl, label), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    fetchStats(apiKey);
  };

  const toggleBackend = async (label: string, enabled: boolean) => {
    const current = { ...stats };
    if (current[label]) current[label] = { ...current[label], enabled };
    setStats(current);
    try {
      await fetch(servicePaths.backend(baseUrl, label), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      fetchStats(apiKey);
    } catch {}
  };

  const batchToggleBackends = async (labels: string[], enabled: boolean) => {
    if (!labels.length) return;
    const current = { ...stats };
    labels.forEach((l) => { if (current[l]) current[l] = { ...current[l], enabled }; });
    setStats(current);
    try {
      await fetch(servicePaths.backends(baseUrl), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ labels, enabled }),
      });
      fetchStats(apiKey);
    } catch {}
  };

  const batchRemoveBackends = async (labels: string[]) => {
    if (!labels.length) return;
    try {
      await Promise.all(labels.map((l) =>
        fetch(servicePaths.backend(baseUrl, l), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiKey}` },
        })
      ));
      fetchStats(apiKey);
    } catch {}
  };

  const toggleRouting = async (field: "localEnabled" | "localFallback" | "fakeStream", value: boolean) => {
    const current = { ...routing, [field]: value };
    setRouting(current);
    try {
      await fetch(servicePaths.routing(baseUrl), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      fetchStats(apiKey);
    } catch {}
  };

  const fetchModels = useCallback(async (key: string) => {
    if (!key) return;
    try {
      const r = await fetch(servicePaths.models(baseUrl), { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return;
      const d = await r.json() as { models: ModelStatus[]; summary: Record<string, GroupSummary> };
      setModelStatus(d.models || []);
      setModelSummary(d.summary || {});
    } catch {}
  }, [baseUrl]);

  const toggleModelGroup = async (group: string, enabled: boolean) => {
    // Optimistic update
    setModelStatus((prev) => prev.map((m) => m.group === group ? { ...m, enabled } : m));
    setModelSummary((prev) => {
      const grp = prev[group];
      if (!grp) return prev;
      return { ...prev, [group]: { total: grp.total, enabled: enabled ? grp.total : 0 } };
    });
    try {
      await fetch(servicePaths.models(baseUrl), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ group, enabled }),
      });
    } catch {}
    fetchModels(apiKey);
  };

  const toggleModelById = async (id: string, enabled: boolean) => {
    // Optimistic update
    setModelStatus((prev) => prev.map((m) => m.id === id ? { ...m, enabled } : m));
    setModelSummary((prev) => {
      const m = modelStatus.find((ms) => ms.id === id);
      if (!m) return prev;
      const grp = prev[m.group];
      if (!grp) return prev;
      const delta = enabled ? 1 : -1;
      return { ...prev, [m.group]: { total: grp.total, enabled: Math.max(0, Math.min(grp.total, grp.enabled + delta)) } };
    });
    try {
      await fetch(servicePaths.models(baseUrl), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], enabled }),
      });
    } catch {}
    fetchModels(apiKey);
  };

  useEffect(() => { checkHealth(); }, [checkHealth]);
  useEffect(() => { 
    const initialKey = getStoredServiceKey();
    if (initialKey) verifyServiceKey(initialKey); 
    else setGateReady(true); 
  }, [verifyServiceKey]);
  useEffect(() => {
    if (!gateUnlocked || !apiKey) return;
    void fetchSTMode(apiKey);
    void fetchPromptCache(apiKey);
  }, [apiKey, fetchPromptCache, fetchSTMode, gateUnlocked]);
  useEffect(() => {
    if (!gateUnlocked) return;
    fetchModels(apiKey);
    const t = setInterval(() => { fetchStats(apiKey); fetchModels(apiKey); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [apiKey, gateUnlocked, fetchStats, fetchModels]);

  if (!gateReady || online === null) {
    return (
      <ThemeProvider>
        <div className="relative flex h-screen items-center justify-center text-muted-foreground p-4 overflow-hidden">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 top-12 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
            <div className="absolute right-[-6rem] top-[-2rem] h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
          </div>
          <div className="flex flex-col items-center gap-4 rounded-[28px] border border-white/55 dark:border-white/8 bg-white/55 dark:bg-slate-950/40 px-8 py-10 backdrop-blur-2xl shadow-[0_30px_100px_-54px_rgba(15,23,42,0.9)]">
             <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
             <div className="font-mono text-sm tracking-wide">正在连接服务器...</div>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  // Handle Initial Gateway View
  if (!gateUnlocked && !showWizard) {
    return (
      <ThemeProvider>
        <AppLayout isSetup>
          <div className="w-full max-w-md mx-auto relative bg-white/68 dark:bg-slate-950/58 text-card-foreground p-8 rounded-[30px] shadow-[0_40px_110px_-56px_rgba(15,23,42,0.95)] border border-white/60 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-500 backdrop-blur-2xl">
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute -top-16 right-[-3rem] h-40 w-40 rounded-full bg-primary/18 blur-3xl" />
              <div className="absolute bottom-[-4rem] left-[-2rem] h-36 w-36 rounded-full bg-amber-400/18 blur-3xl" />
            </div>
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/90 to-transparent dark:via-white/20" />
            <h1 className="text-2xl font-bold mb-2 flex items-center justify-center gap-3 tracking-tight">
               <span className="w-10 h-10 rounded-2xl border border-white/55 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 text-primary flex items-center justify-center text-lg shadow-inner">R</span>
               RT Portal
            </h1>
            <p className="text-[11px] text-center uppercase tracking-[0.32em] text-primary/70 mb-3">
              Self-hosted Control Surface
            </p>
            <p className="text-sm text-center text-muted-foreground mb-8 text-balance leading-relaxed">
               在此处输入服务的主控密码进行身份验证。
            </p>
            <form onSubmit={async (e) => { e.preventDefault(); await verifyServiceKey(gateKey); }}>
              <div className="mb-5">
                <input
                  type="password"
                  placeholder="请输入服务访问密码"
                  value={gateKey}
                  onChange={(e) => setGateKey(e.target.value)}
                  className="w-full px-4 py-3 bg-white/75 dark:bg-slate-900/65 border border-white/60 dark:border-white/10 rounded-2xl text-center font-mono focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all text-sm mb-2 backdrop-blur-xl"
                />
                {gateError && <p className="text-xs text-destructive text-center font-medium mt-2">{gateError}</p>}
                {!online && <p className="text-xs text-amber-500 text-center font-medium mt-2">后端服务未响应，请检查是否已启动</p>}
              </div>
              <button
                type="submit"
                disabled={gateLoading || !online}
                className="w-full py-3 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-[0_24px_60px_-30px_rgba(37,99,235,0.85)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {gateLoading ? "验证中..." : "进入仪表盘"}
              </button>
            </form>
            <div className="mt-8 text-center border-t border-border/50 pt-5">
              <span className="text-xs text-muted-foreground">初次部署？</span>
              <button 
                onClick={() => void openSetupWizard()}
                disabled={wizardChecking}
                className="ml-2 text-xs font-semibold text-primary/80 hover:text-primary transition-colors underline underline-offset-2"
              >
                {wizardChecking ? "检测中..." : "启动配置向导"}
              </button>
            </div>
          </div>
        </AppLayout>
      </ThemeProvider>
    );
  }

  if (showWizard) {
    return (
      <ThemeProvider>
         <AppLayout isSetup>
            <SetupWizard
               baseUrl={baseUrl}
               onComplete={async (k) => {
                 setShowWizard(false);
                 if (k) {
                   setGateKey(k);
                   await verifyServiceKey(k);
                 }
               }}
               onDismiss={() => setShowWizard(false)}
            />
         </AppLayout>
      </ThemeProvider>
    );
  }

  // Full Dashboard Mode
  return (
    <ThemeProvider>
      <Router>
        <AppLayout>
          <Switch>
            <Route path="/">
              <DashboardPage
                baseUrl={baseUrl}
              />
            </Route>
            <Route path="/chat">
              <ChatPage
                baseUrl={baseUrl}
                apiKey={apiKey}
                modelStatus={modelStatus}
              />
            </Route>
            <Route path="/stats">
              <StatsPage 
                baseUrl={baseUrl} apiKey={apiKey}
                stats={stats} statsError={statsError} onRefresh={refreshStats}
                addUrl={addUrl} setAddUrl={setAddUrl} addState={addState} addMsg={addMsg}
                onAddBackend={addBackend} onRemoveBackend={removeBackend}
                onToggleBackend={toggleBackend} onBatchToggle={batchToggleBackends}
                onBatchRemove={batchRemoveBackends} routing={routing}
                onToggleRouting={toggleRouting} modelStats={modelStats}
              />
            </Route>
            <Route path="/nodes">
              <NodesPage
                baseUrl={baseUrl}
                apiKey={apiKey}
                stats={stats}
                addUrl={addUrl}
                setAddUrl={setAddUrl}
                addState={addState}
                addMsg={addMsg}
                onAddBackend={addBackend}
                onRemoveBackend={removeBackend}
                onToggleBackend={toggleBackend}
                onBatchToggle={batchToggleBackends}
                onBatchRemove={batchRemoveBackends}
                routing={routing}
                onToggleRouting={toggleRouting}
              />
            </Route>
            <Route path="/models">
              <ModelsPage 
                baseUrl={baseUrl} apiKey={apiKey}
                modelStatus={modelStatus} summary={modelSummary}
                onRefresh={() => fetchModels(apiKey)}
                onToggleProvider={toggleModelGroup}
                onToggleModel={toggleModelById}
              />
            </Route>
            <Route path="/logs">
              <PageLogs baseUrl={baseUrl} apiKey={apiKey} />
            </Route>
            <Route path="/docs">
              <DocsPage displayUrl={displayUrl} />
            </Route>
            <Route path="/settings">
              <HomePage 
                apiKey={apiKey}
                sillyTavernMode={sillyTavernMode}
                stLoading={stLoading}
                onToggleSTMode={toggleSTMode}
                promptCache={promptCache}
                promptCacheLoading={promptCacheLoading}
                onUpdatePromptCache={updatePromptCache}
              />
            </Route>
          </Switch>
        </AppLayout>
      </Router>
    </ThemeProvider>
  );
}
