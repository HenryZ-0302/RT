import { useState, useEffect, useCallback } from "react";
import { servicePaths } from "../lib/service";

interface VersionInfo {
  version: string;
  name?: string;
  releaseNotes?: string;
  hasUpdate: boolean;
  latestVersion?: string;
  latestReleaseNotes?: string;
  latestReleaseDate?: string;
  checkError?: string;
  upstreamRepoUrl?: string;
}

interface Props {
  baseUrl: string;
  apiKey: string;
}

function buildAgentPrompt(latestVersion: string, upstreamRepoUrl?: string): string {
  const sourceLine = upstreamRepoUrl
    ? `从上游仓库 ${upstreamRepoUrl} 拉取最新代码，覆盖当前项目文件，`
    : "从当前已配置的上游服务源同步最新代码并覆盖当前项目文件，";

  return (
    `请帮我把统一服务层更新到最新版本 ${latestVersion}。\n` +
    sourceLine +
    "然后运行 pnpm install，最后重启 \"artifacts/api-server: API Server\" 和 \"artifacts/api-portal: web\" 两个工作流。"
  );
}

export default function UpdateBadge({ baseUrl }: Props) {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkDone, setCheckDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchVersion = useCallback(async () => {
    try {
      const response = await fetch(servicePaths.release(baseUrl));
      if (response.ok) setInfo(await response.json());
    } catch {}
  }, [baseUrl]);

  const manualCheck = async () => {
    setChecking(true);
    setCheckDone(false);
    try {
      const response = await fetch(servicePaths.release(baseUrl));
      if (response.ok) setInfo(await response.json());
    } catch {}
    setChecking(false);
    setCheckDone(true);
    setTimeout(() => setCheckDone(false), 2000);
  };

  useEffect(() => {
    fetchVersion();
    const timer = setInterval(fetchVersion, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [fetchVersion]);

  const copyPrompt = async () => {
    if (!info?.latestVersion) return;
    const text = buildAgentPrompt(info.latestVersion, info.upstreamRepoUrl);

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

  if (!info) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex", alignItems: "center", gap: "5px",
          padding: "3px 10px", borderRadius: "12px", fontFamily: "Menlo, monospace",
          border: `1px solid ${info.hasUpdate ? "rgba(251,191,36,0.45)" : "rgba(255,255,255,0.1)"}`,
          background: info.hasUpdate ? "rgba(251,191,36,0.1)" : "rgba(255,255,255,0.05)",
          color: info.hasUpdate ? "#fbbf24" : "#475569",
          fontSize: "11.5px", fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
        }}
      >
        {info.hasUpdate && (
          <span style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: "#fbbf24", flexShrink: 0, animation: "pulse 2s ease-in-out infinite",
          }} />
        )}
        v{info.version}
        {info.hasUpdate && <span style={{ fontSize: "10px" }}>to {info.latestVersion}</span>}
      </button>

      {open && (
        <div
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
              setCopied(false);
            }
          }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
            zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center",
            padding: "24px", backdropFilter: "blur(6px)",
          }}
        >
          <div style={{
            background: "hsl(222,47%,12%)", border: "1px solid rgba(99,102,241,0.25)",
            borderRadius: "16px", width: "100%", maxWidth: "520px",
            padding: "24px", boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <div>
                <div style={{ fontWeight: 700, color: "#f1f5f9", fontSize: "15px" }}>统一服务层版本信息</div>
                <div style={{ color: "#475569", fontSize: "12px", marginTop: "2px" }}>
                  当前版本 <span style={{ color: "#a5b4fc", fontFamily: "Menlo, monospace" }}>v{info.version}</span>
                </div>
              </div>
              <button
                onClick={() => { setOpen(false); setCopied(false); }}
                style={{ background: "none", border: "none", color: "#334155", fontSize: "22px", cursor: "pointer" }}
              >
                x
              </button>
            </div>

            {info.releaseNotes && (
              <div style={{
                background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.18)",
                borderRadius: "10px", padding: "12px 14px", marginBottom: "16px",
              }}>
                <div style={{ color: "#818cf8", fontSize: "11px", fontWeight: 700, marginBottom: "6px" }}>当前版本说明</div>
                <div style={{ color: "#94a3b8", fontSize: "13px", lineHeight: "1.6" }}>{info.releaseNotes}</div>
              </div>
            )}

            {info.checkError && !info.hasUpdate && (
              <div style={{
                background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)",
                borderRadius: "10px", padding: "12px 14px", marginBottom: "16px",
                color: "#f87171", fontSize: "12.5px",
              }}>
                版本检测失败: {info.checkError}
              </div>
            )}

            {!info.hasUpdate && !info.checkError && (
              <div style={{
                background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)",
                borderRadius: "10px", padding: "10px 14px", marginBottom: "16px",
                color: "#86efac", fontSize: "12.5px",
              }}>
                Already up to date.
              </div>
            )}

            {info.hasUpdate && (
              <>
                <div style={{
                  background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)",
                  borderRadius: "10px", padding: "14px", marginBottom: "14px",
                }}>
                  <div style={{ color: "#fbbf24", fontSize: "12px", fontWeight: 700, marginBottom: "6px" }}>
                    检测到新版本 v{info.latestVersion}
                    {info.latestReleaseDate && (
                      <span style={{ fontWeight: 400, color: "#92400e", marginLeft: "8px" }}>{info.latestReleaseDate}</span>
                    )}
                  </div>
                  {info.latestReleaseNotes && (
                    <div style={{ color: "#94a3b8", fontSize: "12.5px", lineHeight: "1.6" }}>
                      {info.latestReleaseNotes}
                    </div>
                  )}
                </div>

                <div style={{
                  background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.18)",
                  borderRadius: "10px", padding: "14px", marginBottom: "14px",
                }}>
                  <div style={{ color: "#818cf8", fontSize: "11px", fontWeight: 700, marginBottom: "10px" }}>
                    平台更新助手
                  </div>
                  <pre style={{
                    margin: 0, padding: "10px 12px",
                    background: "rgba(0,0,0,0.35)", borderRadius: "8px",
                    fontSize: "11.5px", color: "#cbd5e1", lineHeight: "1.6",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                    fontFamily: "Menlo, Monaco, monospace",
                    maxHeight: "120px", overflowY: "auto",
                  }}>
                    {buildAgentPrompt(info.latestVersion ?? "", info.upstreamRepoUrl)}
                  </pre>
                  <button
                    onClick={copyPrompt}
                    style={{
                      marginTop: "10px", width: "100%",
                      padding: "9px 0", borderRadius: "8px",
                      border: copied ? "1px solid rgba(74,222,128,0.4)" : "1px solid rgba(99,102,241,0.4)",
                      background: copied ? "rgba(74,222,128,0.1)" : "rgba(99,102,241,0.15)",
                      color: copied ? "#4ade80" : "#a5b4fc",
                      fontSize: "13px", fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
                    }}
                  >
                    {copied ? "Copied to clipboard" : "复制更新指令"}
                  </button>
                </div>
              </>
            )}

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={manualCheck}
                disabled={checking}
                style={{
                  padding: "8px 16px", borderRadius: "8px",
                  border: `1px solid ${checkDone ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"}`,
                  background: checkDone ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.04)",
                  color: checkDone ? "#4ade80" : checking ? "#334155" : "#475569",
                  fontSize: "13px", cursor: checking ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: "6px",
                  transition: "all 0.2s",
                }}
              >
                {checking && <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>o</span>}
                {checking ? "检测中..." : checkDone ? "Check complete" : "重新检测"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
      `}</style>
    </>
  );
}
