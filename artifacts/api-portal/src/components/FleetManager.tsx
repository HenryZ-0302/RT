import { useState } from "react";
import { Download, Upload, RefreshCw, UploadCloud, Server } from "lucide-react";
import { cn } from "../lib/utils";

interface FleetInstance {
  id: string;
  name: string;
  url: string;
  key: string;
  status: "unknown" | "checking" | "ok" | "updating" | "error" | "restarting";
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  lastChecked: number | null;
  updateLog: string | null;
}

const FLEET_STORE_KEY = "fleet_instances_v2";

function loadFleet(): FleetInstance[] {
  try { return JSON.parse(localStorage.getItem(FLEET_STORE_KEY) ?? "[]") as FleetInstance[]; }
  catch { return []; }
}

function saveFleet(data: FleetInstance[]) {
  localStorage.setItem(FLEET_STORE_KEY, JSON.stringify(data));
}

function genId() { return Math.random().toString(36).slice(2, 9); }

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card text-card-foreground rounded-xl border border-border/50 shadow-sm p-5", className)}>
      {children}
    </div>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-sm font-bold tracking-widest text-muted-foreground uppercase mb-4", className)}>
      {children}
    </h2>
  );
}

export function FleetManager() {
  const [instances, setInstances] = useState<FleetInstance[]>(() => loadFleet());
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addKey, setAddKey] = useState("");
  const [logTarget, setLogTarget] = useState<string | null>(null);

  const persist = (next: FleetInstance[]) => { setInstances(next); saveFleet(next); };

  const addInst = () => {
    const url = addUrl.trim().replace(/\/+$/, "");
    const key = addKey.trim();
    if (!url || !key) return;
    const inst: FleetInstance = {
      id: genId(), name: addName.trim() || url, url, key,
      status: "unknown", version: null, latestVersion: null,
      updateAvailable: false, lastChecked: null, updateLog: null,
    };
    const next = [...instances, inst];
    persist(next);
    setAddName(""); setAddUrl(""); setAddKey("");
  };

  const removeInst = (id: string) => persist(instances.filter((i) => i.id !== id));

  const patchInst = (id: string, patch: Partial<FleetInstance>) => {
    const next = instances.map((i) => i.id === id ? { ...i, ...patch } : i);
    persist(next); return next;
  };

  const checkOne = async (id: string) => {
    const inst = instances.find((i) => i.id === id);
    if (!inst) return;
    patchInst(id, { status: "checking" });
    try {
      const r = await fetch(`${inst.url}/api/service/release`, {
        headers: { Authorization: `Bearer ${inst.key}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as { version?: string; hasUpdate?: boolean; latestVersion?: string };
      patchInst(id, {
        status: "ok",
        version: d.version ?? null,
        latestVersion: d.latestVersion ?? null,
        updateAvailable: d.hasUpdate ?? false,
        lastChecked: Date.now(),
      });
    } catch {
      patchInst(id, { status: "error", lastChecked: Date.now() });
    }
  };

  const checkAll = async () => {
    await Promise.all(instances.map((i) => checkOne(i.id)));
  };

  const updateOne = async (id: string) => {
    const inst = instances.find((i) => i.id === id);
    if (!inst) return;
    patchInst(id, { status: "updating", updateLog: null });
    try {
      const r = await fetch(`${inst.url}/api/service/release/apply`, {
        method: "POST",
        headers: { Authorization: `Bearer ${inst.key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60000),
      });
      const d = await r.json() as { status?: string; message?: string };
      const logMsg = d.message ?? (r.ok ? "更新指令已发送，服务器将自动重启。" : "更新请求失败。");
      patchInst(id, {
        status: r.ok ? "restarting" : "error",
        updateLog: logMsg,
        lastChecked: Date.now(),
      });
      setLogTarget(id);
    } catch (e) {
      patchInst(id, { status: "error", updateLog: `错误: ${(e as Error).message}`, lastChecked: Date.now() });
      setLogTarget(id);
    }
  };

  const updateAll = async () => {
    const toUpdate = instances.filter((i) => i.updateAvailable);
    if (!toUpdate.length) return;
    for (const inst of toUpdate) await updateOne(inst.id);
  };

  const exportJson = () => {
    const data = instances.map(({ name, url, key }) => ({ name, url, key }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fleet.json";
    a.click();
  };

  const importJson = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.onchange = async (e) => {
      try {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const arr = JSON.parse(await file.text()) as Array<{ name?: string; url?: string; key?: string }>;
        let added = 0;
        const next = [...instances];
        for (const item of arr) {
          if (!item.url || !item.key) continue;
          if (next.some((i) => i.url === item.url)) continue;
          next.push({
            id: genId(), name: item.name || item.url,
            url: item.url.replace(/\/+$/, ""), key: item.key,
            status: "unknown", version: null, latestVersion: null,
            updateAvailable: false, lastChecked: null, updateLog: null,
          });
          added++;
        }
        persist(next);
        if (added === 0) alert("没有新节点被导入（URL 重复或格式错误）");
      } catch (err) { alert(`导入失败: ${(err as Error).message}`); }
    };
    input.click();
  };

  const statusTag = (inst: FleetInstance) => {
    if (inst.status === "checking") return { label: "检测中", color: "text-muted-foreground", bg: "bg-muted text-muted-foreground border border-border" };
    if (inst.status === "updating") return { label: "更新中", color: "text-amber-500", bg: "bg-amber-500/10 text-amber-500 border border-amber-500/20" };
    if (inst.status === "restarting") return { label: "重启中", color: "text-indigo-500", bg: "bg-indigo-500/10 text-indigo-500 border border-indigo-500/20" };
    if (inst.status === "error") return { label: "连接失败", color: "text-destructive", bg: "bg-destructive/10 text-destructive border border-destructive/20" };
    if (inst.status === "ok") {
      if (inst.updateAvailable) return { label: `有新版本 v${inst.latestVersion ?? ""}`, color: "text-amber-500", bg: "bg-amber-500/10 text-amber-500 border border-amber-500/20" };
      return { label: "已是最新", color: "text-emerald-500", bg: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" };
    }
    return { label: "未检测", color: "text-muted-foreground", bg: "bg-secondary text-muted-foreground border border-border" };
  };

  const hasUpdates = instances.some((i) => i.updateAvailable);
  const logInst = instances.find((i) => i.id === logTarget);

  return (
    <Card className="flex flex-col shadow-sm col-span-1 md:col-span-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
         <div>
           <SectionTitle className="mb-1 flex items-center gap-2"><Server size={16}/> 实例管控与同步更新</SectionTitle>
           <p className="text-xs text-muted-foreground">批量管理位于不同服务器的 RT 节点的系统更新。状态数据仅保存在浏览器。</p>
         </div>
         <div className="flex flex-wrap items-center gap-2">
           <button onClick={importJson} className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-muted-foreground hover:bg-secondary/80 rounded border text-xs font-medium transition-colors">
              <Upload size={12} /> 导入 JSON
           </button>
           <button onClick={exportJson} className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-muted-foreground hover:bg-secondary/80 rounded border text-xs font-medium transition-colors">
              <Download size={12} /> 导出 JSON
           </button>
           <button onClick={checkAll} disabled={instances.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 rounded text-xs font-medium disabled:opacity-50 transition-colors">
              <RefreshCw size={12} /> 全部检测
           </button>
           {hasUpdates && (
             <button onClick={updateAll} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 rounded text-xs font-bold transition-colors shadow-sm">
                <UploadCloud size={12} /> 全部更新
             </button>
           )}
         </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6 p-4 rounded-lg bg-secondary/30 border border-border/40">
         <input className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm md:w-[120px] focus:outline-none focus:border-primary/50" placeholder="别名" value={addName} onChange={(e) => setAddName(e.target.value)} />
         <input className="flex-[2] bg-background border border-border rounded px-3 py-1.5 text-sm min-w-[200px] focus:outline-none focus:border-primary/50 font-mono" placeholder="URL (例如 https://.../)" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} />
         <input type="password" className="flex-[1.5] bg-background border border-border rounded px-3 py-1.5 text-sm min-w-[140px] focus:outline-none focus:border-primary/50 font-mono" placeholder="API Key" value={addKey} onChange={(e) => setAddKey(e.target.value)} />
         <button 
           onClick={addInst} disabled={!addUrl || !addKey} 
           className="px-4 py-1.5 bg-primary text-primary-foreground font-medium rounded text-sm disabled:opacity-50 transition-colors whitespace-nowrap"
         >
            添加实例
         </button>
      </div>

      {instances.length === 0 ? (
         <div className="text-center py-10 text-muted-foreground text-sm border border-dashed rounded-lg bg-secondary/20">
           尚未配置可管理的节点实例
         </div>
      ) : (
         <div className="space-y-3">
           {instances.map((inst) => {
             const tag = statusTag(inst);
             const busy = inst.status === "checking" || inst.status === "updating";
             const timeStr = inst.lastChecked ? new Date(inst.lastChecked).toLocaleTimeString() : null;
             return (
               <div key={inst.id} className="flex flex-col bg-card border rounded-lg p-3 hover:border-primary/30 transition-colors group">
                 <div className="flex flex-wrap items-center gap-3 md:gap-4">
                   <div className="flex items-center gap-2 w-full md:w-auto">
                     <span className="font-bold text-sm tracking-tight truncate max-w-[120px] md:max-w-[160px] text-foreground" title={inst.name}>{inst.name}</span>
                     {inst.version && <span className="font-mono text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border">v{inst.version}</span>}
                     <span className={cn("text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ml-auto md:ml-0 shadow-sm", tag.bg)}>{tag.label}</span>
                   </div>
                   
                   <span className="font-mono text-xs text-muted-foreground truncate flex-1 min-w-[150px]" title={inst.url}>{inst.url}</span>
                   
                   <div className="flex items-center gap-2 ml-auto">
                     {timeStr && <span className="text-[10px] text-muted-foreground mr-2 hidden sm:block whitespace-nowrap">{timeStr}</span>}
                     <button onClick={() => checkOne(inst.id)} disabled={busy} className="text-[11px] px-2.5 py-1.5 bg-secondary hover:bg-secondary/80 text-muted-foreground rounded border border-border disabled:opacity-50 transition-colors">检测</button>
                     <button onClick={() => updateOne(inst.id)} disabled={busy || !inst.updateAvailable} className={cn("text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-50 transition-colors cursor-pointer", inst.updateAvailable ? "bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/20" : "bg-secondary text-muted-foreground border-border hover:bg-secondary/80")}>更新</button>
                     {inst.updateLog && (
                       <button onClick={() => setLogTarget(logTarget === inst.id ? null : inst.id)} className="text-[11px] px-2 py-1.5 text-muted-foreground rounded hover:bg-secondary transition-colors underline-offset-2 hover:underline">日志</button>
                     )}
                     <button onClick={() => removeInst(inst.id)} className="text-[11px] px-2.5 py-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded border border-destructive/20 transition-colors ml-1 cursor-pointer">删除</button>
                   </div>
                 </div>

                 {/* Log Expander */}
                 {logTarget === inst.id && logInst?.updateLog && (
                   <div className="mt-3 p-3 bg-secondary/40 border border-border/50 rounded-md shadow-inner">
                     <pre className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 whitespace-pre-wrap word-break h-auto max-h-32 overflow-y-auto w-full leading-relaxed">
                       {logInst.updateLog}
                     </pre>
                   </div>
                 )}
               </div>
             );
           })}
         </div>
      )}
    </Card>
  );
}
