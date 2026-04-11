import { useState, useEffect, useCallback } from "react";
import { Route, Switch, Router } from "wouter";
import SetupWizard from "./components/SetupWizard";
import PageLogs from "./components/PageLogs";
import { UpdateBar } from "./components/UpdateBar";
import { AppLayout } from "./layouts/AppLayout";
import { ThemeProvider } from "./components/theme-provider";
import { HomePage } from "./pages/HomePage";
import { StatsPage } from "./pages/StatsPage";
import { ModelsPage } from "./pages/ModelsPage";
import { FleetManager } from "./components/FleetManager";
import { getStoredServiceKey, servicePaths, storeServiceKey } from "./lib/service";

// Define the types that App needs for State management
type BackendStat = { calls: number; errors: number; streamingCalls: number; promptTokens: number; completionTokens: number; totalTokens: number; avgDurationMs: number; avgTtftMs: number | null; health: string; url?: string; dynamic?: boolean; enabled?: boolean };
type ModelStat = { calls: number; promptTokens: number; completionTokens: number };
interface ModelStatus { id: string; provider: string; enabled: boolean }
type GroupSummary = { total: number; enabled: number };

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [sillyTavernMode, setSillyTavernMode] = useState(false);
  const [stLoading, setStLoading] = useState(true);
  const [apiKey, setApiKey] = useState(() => getStoredServiceKey());
  const [gateKey, setGateKey] = useState(() => getStoredServiceKey());
  const [gateReady, setGateReady] = useState(false);
  const [gateUnlocked, setGateUnlocked] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [stats, setStats] = useState<Record<string, BackendStat> | null>(null);
  const [modelStats, setModelStats] = useState<Record<string, ModelStat> | null>(null);
  const [statsError, setStatsError] = useState<false | "auth" | "server">(false);
  const [routing, setRouting] = useState<{ localEnabled: boolean; localFallback: boolean; fakeStream: boolean }>({ localEnabled: true, localFallback: true, fakeStream: true });
  const [addUrl, setAddUrl] = useState("");
  const [addState, setAddState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [addMsg, setAddMsg] = useState("");
  const [modelStatus, setModelStatus] = useState<ModelStatus[]>([]);
  const [modelSummary, setModelSummary] = useState<Record<string, GroupSummary>>({});

  const baseUrl = window.location.origin;
  const displayUrl: string = (import.meta.env.VITE_BASE_URL as string | undefined) ?? window.location.origin;
  
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(servicePaths.status(baseUrl), { signal: AbortSignal.timeout(5000) });
      setOnline(res.ok);
    } catch { setOnline(false); }
  }, [baseUrl]);

  const fetchSTMode = useCallback(async () => {
    try {
      const key = getStoredServiceKey();
      const res = await fetch(servicePaths.compatibility(baseUrl), {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      });
      if (res.ok) { const d = await res.json(); setSillyTavernMode(d.enabled); }
    } catch {}
    setStLoading(false);
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

  const verifyServiceKey = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) {
      setGateError("请输入服务密钥。");
      setGateReady(true);
      setGateUnlocked(false);
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
        return false;
      }

      setApiKey(trimmed);
      setGateKey(trimmed);
      storeServiceKey(trimmed);
      setGateUnlocked(true);
      setGateReady(true);
      return true;
    } catch {
      setGateError("无法连接到服务，请稍后重试。");
      setGateReady(true);
      setGateUnlocked(false);
      return false;
    } finally {
      setGateLoading(false);
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
      const d = await r.json();
      const parsed: Record<string, BackendStat> = {};
      for (const [k, v] of Object.entries(d.stats as Record<string, Record<string, unknown>>)) {
        parsed[k] = { ...(v as unknown as BackendStat), streamingCalls: (v.streamingCalls as number) ?? 0 };
      }
      setStats(parsed); setStatsError(false);
      setModelStats(d.modelStats && typeof d.modelStats === "object" ? d.modelStats as Record<string, ModelStat> : null);
      if (d.routing) setRouting(d.routing);
    } catch { setStatsError("auth"); }
  }, [baseUrl]);

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
      await fetch(servicePaths.backendEn(baseUrl, label), {
        method: "POST",
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
      await fetch(`${baseUrl}/api/service/backends/batch/enabled`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ labels, enabled }),
      });
      fetchStats(apiKey);
    } catch {}
  };

  const batchRemoveBackends = async (labels: string[]) => {
    if (!labels.length) return;
    try {
      await fetch(`${baseUrl}/api/service/backends/batch/delete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ labels }),
      });
      fetchStats(apiKey);
    } catch {}
  };

  const toggleRouting = async (field: "localEnabled" | "localFallback" | "fakeStream", value: boolean) => {
    const current = { ...routing, [field]: value };
    setRouting(current);
    try {
      await fetch(`${baseUrl}/api/service/routing`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(current),
      });
      fetchStats(apiKey);
    } catch {}
  };

  const fetchModels = useCallback(async (key: string) => {
    if (!key) return;
    try {
      const r = await fetch(`${baseUrl}/api/service/config/models`, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return;
      const d = await r.json() as { models: ModelStatus[]; summary: Record<string, GroupSummary> };
      setModelStatus(d.models || []);
      setModelSummary(d.summary || {});
    } catch {}
  }, [baseUrl]);

  const toggleModelProvider = async (provider: string, enabled: boolean) => {
    try {
      await fetch(`${baseUrl}/api/service/config/models/group/${provider}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      fetchModels(apiKey);
    } catch {}
  };

  const toggleModelById = async (id: string, enabled: boolean) => {
    try {
      await fetch(`${baseUrl}/api/service/config/models/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      fetchModels(apiKey);
    } catch {}
  };

  useEffect(() => { checkHealth(); }, [checkHealth]);
  useEffect(() => { fetchSTMode(); }, [fetchSTMode]);
  useEffect(() => { 
    const initialKey = getStoredServiceKey();
    if (initialKey) verifyServiceKey(initialKey); 
    else setGateReady(true); 
  }, [verifyServiceKey]);
  useEffect(() => {
    if (!gateUnlocked) return;
    fetchStats(apiKey);
    fetchModels(apiKey);
    const t = setInterval(() => { fetchStats(apiKey); fetchModels(apiKey); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [apiKey, gateUnlocked, fetchStats, fetchModels]);

  if (!gateReady || online === null) {
    return (
      <ThemeProvider>
        <div className="flex h-screen items-center justify-center bg-background text-muted-foreground p-4">
          <div className="flex flex-col items-center gap-4">
             <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
             <div className="font-mono text-sm">正在连接服务器...</div>
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
          <div className="w-full max-w-md mx-auto relative bg-card text-card-foreground p-8 rounded-2xl shadow-xl shadow-black/5 border border-border/50 overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/80 via-purple-500/80 to-primary/80" />
            <h1 className="text-2xl font-bold mb-2 flex items-center justify-center gap-3 tracking-tight">
               <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-lg shadow-inner">R</span>
               Unified Layer
            </h1>
            <p className="text-sm text-center text-muted-foreground mb-8 text-balance">
               在此处输入服务的主控密码进行身份验证。
            </p>
            <form onSubmit={async (e) => { e.preventDefault(); await verifyServiceKey(gateKey); }}>
              <div className="mb-5">
                <input
                  type="password"
                  placeholder="SERVICE_ACCESS_KEY"
                  value={gateKey}
                  onChange={(e) => setGateKey(e.target.value)}
                  className="w-full px-4 py-3 bg-secondary border border-border rounded-xl text-center font-mono focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all text-sm mb-2"
                />
                {gateError && <p className="text-xs text-destructive text-center font-medium mt-2">{gateError}</p>}
                {!online && <p className="text-xs text-amber-500 text-center font-medium mt-2">后端服务未响应，请检查是否已启动</p>}
              </div>
              <button
                type="submit"
                disabled={gateLoading || !online}
                className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {gateLoading ? "验证中..." : "进入仪表盘"}
              </button>
            </form>
            <div className="mt-8 text-center border-t border-border/50 pt-5">
              <span className="text-xs text-muted-foreground">初次部署？</span>
              <button 
                onClick={() => setShowWizard(true)}
                className="ml-2 text-xs font-semibold text-primary/80 hover:text-primary transition-colors underline underline-offset-2"
              >
                启动配置向导
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
                 if (k) {
                   setGateKey(k);
                   setApiKey(k);
                   storeServiceKey(k);
                   setGateUnlocked(true);
                 }
                 setShowWizard(false);
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
      <UpdateBar baseUrl={baseUrl} apiKey={apiKey} />
      <Router>
        <AppLayout>
          <Switch>
            <Route path="/">
              <div className="space-y-6">
                <StatsPage 
                  baseUrl={baseUrl} apiKey={apiKey}
                  stats={stats} statsError={statsError} onRefresh={() => fetchStats(apiKey)}
                  addUrl={addUrl} setAddUrl={setAddUrl} addState={addState} addMsg={addMsg}
                  onAddBackend={addBackend} onRemoveBackend={removeBackend}
                  onToggleBackend={toggleBackend} onBatchToggle={batchToggleBackends}
                  onBatchRemove={batchRemoveBackends} routing={routing}
                  onToggleRouting={toggleRouting} modelStats={modelStats}
                />
                <FleetManager />
              </div>
            </Route>
            <Route path="/models">
              <ModelsPage 
                baseUrl={baseUrl} apiKey={apiKey}
                modelStatus={modelStatus} summary={modelSummary}
                onRefresh={() => fetchModels(apiKey)}
                onToggleProvider={toggleModelProvider}
                onToggleModel={toggleModelById}
              />
            </Route>
            <Route path="/logs">
              <PageLogs baseUrl={baseUrl} apiKey={apiKey} />
            </Route>
            <Route path="/settings">
              <HomePage 
                displayUrl={displayUrl}
                apiKey={apiKey}
                sillyTavernMode={sillyTavernMode}
                stLoading={stLoading}
                onToggleSTMode={toggleSTMode}
              />
            </Route>
          </Switch>
        </AppLayout>
      </Router>
    </ThemeProvider>
  );
}
