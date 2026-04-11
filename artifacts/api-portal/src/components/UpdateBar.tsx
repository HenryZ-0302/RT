import { useState, useCallback, useEffect } from "react";
import { Info, Check, Copy, X } from "lucide-react";
import { servicePaths } from "../lib/service";

export function UpdateBar({ baseUrl, apiKey: _apiKey }: { baseUrl: string; apiKey: string }) {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latestVer, setLatestVer] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    try {
      const r = await fetch(servicePaths.release(baseUrl));
      if (!r.ok) return;
      const d = await r.json();
      setHasUpdate(!!d.hasUpdate);
      setLatestVer(d.latestVersion ?? "");
      setReleaseNotes(d.latestReleaseNotes ?? "");
    } catch {}
  }, [baseUrl]);

  useEffect(() => {
    check();
    const t = setInterval(check, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [check]);

  const buildPrompt = (ver: string) =>
    `请帮我将 Unified Service Layer 更新到版本 ${ver}。\n` +
    `从已配置的上游服务源同步最新文件，覆盖当前项目代码，然后运行 pnpm install，` +
    `最后重启 "artifacts/api-server: API Server" 和 "artifacts/api-portal: web" 两个工作流。`;

  const copyPrompt = async () => {
    const text = buildPrompt(latestVer);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const recheck = async () => {
    setChecking(true);
    await check();
    setChecking(false);
  };

  if (dismissed || !hasUpdate) return null;

  return (
    <div className="sticky top-0 z-[1000] bg-amber-500/10 border-b border-amber-500/20 backdrop-blur-xl transition-all shadow-sm">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap text-sm">
        
        <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-[200px]">
          <span className="text-xl shrink-0 leading-none">🎉</span>
          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 flex-1 truncate">
             <strong className="text-amber-600 dark:text-amber-400 font-bold tracking-tight">发现新版本 v{latestVer}</strong>
             {releaseNotes && <span className="text-xs text-amber-700/80 dark:text-amber-300/80 truncate max-w-sm" title={releaseNotes}>{releaseNotes}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 w-full md:w-auto justify-end">
          <button
            onClick={copyPrompt}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold border transition-colors shadow-sm ${
              copied 
                ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400" 
                : "bg-amber-500/20 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/30"
            }`}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制！粘贴给 Agent" : "复制更新指令"}
          </button>

          <button
            onClick={recheck}
            disabled={checking}
            className="flex items-center justify-center h-7 px-2.5 rounded text-xs font-medium border border-amber-500/20 bg-transparent text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 disabled:opacity-50 transition-colors"
          >
            {checking ? "检测中…" : "重新检测"}
          </button>

          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded-full text-amber-700/60 hover:text-amber-700 dark:text-amber-400/60 dark:hover:text-amber-400 hover:bg-amber-500/10 ml-1 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
