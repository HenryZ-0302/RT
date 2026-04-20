import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, Copy, Loader2, Settings, X } from "lucide-react";
import { SERVICE_KEY_ENV, servicePaths } from "../lib/service";
import { cn } from "../lib/utils";

interface Props {
  baseUrl: string;
  onComplete: (apiKey?: string) => void;
  onDismiss: () => void;
}

interface SetupStatus {
  configured: boolean;
  integrationsReady: boolean;
  storageReady: boolean;
}

function buildSetupPrompt(
  apiKey: string | null,
  options: { needKey: boolean; needIntegrations: boolean; needStorage: boolean },
): string {
  const steps: string[] = [];
  let step = 0;

  if (options.needKey && apiKey) {
    steps.push(
      `步骤 ${++step}：写入服务访问密钥\n` +
      `请在平台 Secrets 中创建如下键值，并保持原样：\n` +
      `${SERVICE_KEY_ENV} = ${apiKey}`,
    );
  }

  if (options.needIntegrations) {
    steps.push(
      `步骤 ${++step}：启用平台集成\n` +
      `请在 code_execution 工具中按顺序执行以下代码，为 OpenAI / Anthropic / Gemini / OpenRouter 四项平台集成开通环境变量：\n\n` +
      `const r1 = await setupReplitAIIntegrations({ providerSlug: "openai", providerUrlEnvVarName: "AI_INTEGRATIONS_OPENAI_BASE_URL", providerApiKeyEnvVarName: "AI_INTEGRATIONS_OPENAI_API_KEY" });\n` +
      `console.log("OpenAI:", JSON.stringify(r1));\n\n` +
      `const r2 = await setupReplitAIIntegrations({ providerSlug: "anthropic", providerUrlEnvVarName: "AI_INTEGRATIONS_ANTHROPIC_BASE_URL", providerApiKeyEnvVarName: "AI_INTEGRATIONS_ANTHROPIC_API_KEY" });\n` +
      `console.log("Anthropic:", JSON.stringify(r2));\n\n` +
      `const r3 = await setupReplitAIIntegrations({ providerSlug: "gemini", providerUrlEnvVarName: "AI_INTEGRATIONS_GEMINI_BASE_URL", providerApiKeyEnvVarName: "AI_INTEGRATIONS_GEMINI_API_KEY" });\n` +
      `console.log("Gemini:", JSON.stringify(r3));\n\n` +
      `const r4 = await setupReplitAIIntegrations({ providerSlug: "openrouter", providerUrlEnvVarName: "AI_INTEGRATIONS_OPENROUTER_BASE_URL", providerApiKeyEnvVarName: "AI_INTEGRATIONS_OPENROUTER_API_KEY" });\n` +
      `console.log("OpenRouter:", JSON.stringify(r4));`,
    );
  }

  if (options.needStorage) {
    steps.push(
      `步骤 ${++step}：开通云端持久化存储\n` +
      `请在 code_execution 工具中执行以下代码，初始化对象存储：\n\n` +
      `const result = await setupObjectStorage();\n` +
      `console.log(JSON.stringify(result));`,
    );
  }

  return (
    `请帮我完成 Unified Service Layer 的初始化配置，并严格执行以下步骤：\n\n` +
    `${steps.join("\n\n")}\n\n` +
    `完成后请重启这两个工作流：\n` +
    `- artifacts/api-server: API Server\n` +
    `- artifacts/api-portal: API Portal`
  );
}

const STORAGE_ONLY_PROMPT =
  `请帮我为 Unified Service Layer 开通云端持久化存储。\n\n` +
  `请在 code_execution 工具中执行：\n` +
  `const result = await setupObjectStorage();\n` +
  `console.log(JSON.stringify(result));\n\n` +
  `完成后重启 "artifacts/api-server: API Server" 和 "artifacts/api-portal: API Portal"。`;

function CopyableBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-xl border border-border/60 bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">已生成配置指令，直接复制后发给平台 Agent。</div>
        <button
          onClick={handleCopy}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
            copied
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              : "border-border bg-background hover:bg-secondary",
          )}
        >
          <Copy size={12} />
          {copied ? "已复制" : "复制指令"}
        </button>
      </div>
    </div>
  );
}

function StatusItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-3 py-2">
      <span className="text-sm">{label}</span>
      <span className={cn("text-xs font-medium", ready ? "text-emerald-500" : "text-amber-500")}>
        {ready ? "已完成" : "待处理"}
      </span>
    </div>
  );
}

export default function SetupWizard({ baseUrl, onComplete, onDismiss }: Props) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [keyInput, setKeyInput] = useState("");
  const [chosenKey, setChosenKey] = useState<string | null>(null);

  const checkSetupStatus = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch(servicePaths.bootstrap(baseUrl), {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        setStatus({ configured: false, integrationsReady: false, storageReady: false });
        return;
      }
      setStatus(await response.json() as SetupStatus);
    } catch {
      setStatus({ configured: false, integrationsReady: false, storageReady: false });
    } finally {
      setChecking(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void checkSetupStatus();
  }, [checkSetupStatus]);

  const prompt = useMemo(() => {
    if (!status) return "";
    if (status.configured && status.integrationsReady && !status.storageReady) {
      return STORAGE_ONLY_PROMPT;
    }

    const needKey = !status.configured;
    if (needKey && !chosenKey) return "";

    return buildSetupPrompt(chosenKey, {
      needKey,
      needIntegrations: !status.integrationsReady,
      needStorage: !status.storageReady,
    });
  }, [chosenKey, status]);

  const handleKeyConfirm = () => {
    const value = keyInput.trim();
    if (!value) return;
    setChosenKey(value);
  };

  const isComplete = !!status?.configured && !!status.integrationsReady && !!status.storageReady;
  const showKeyStep = !!status && !status.configured;
  const showPrompt = !!status && !isComplete && (!!prompt || (showKeyStep && !!chosenKey));

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-2xl rounded-2xl border border-border/60 bg-card shadow-2xl shadow-black/20">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Settings size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">启动配置向导</h3>
            <p className="text-xs text-muted-foreground">按缺失项补齐服务初始化</p>
          </div>
          <button
            onClick={onDismiss}
            className="ml-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">当前状态</div>
                <div className="text-xs text-muted-foreground">先检测，再只处理缺失项。</div>
              </div>
              <button
                onClick={() => void checkSetupStatus()}
                disabled={checking}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-50"
              >
                {checking ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
                重新检测
              </button>
            </div>

            {checking || !status ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-3 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                正在检查服务状态...
              </div>
            ) : (
              <div className="space-y-2">
                <StatusItem label="服务访问密钥" ready={status.configured} />
                <StatusItem label="平台集成" ready={status.integrationsReady} />
                <StatusItem label="云端存储" ready={status.storageReady} />
              </div>
            )}
          </div>

          {isComplete && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-emerald-500">
                <CheckCircle2 size={16} />
                <span className="text-sm font-medium">服务已配置完成</span>
              </div>
              <p className="text-sm text-muted-foreground">无需额外操作，直接返回登录即可。</p>
            </div>
          )}

          {showKeyStep && !chosenKey && (
            <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
              <div className="mb-2 text-sm font-medium">步骤 1：设置服务访问密钥</div>
              <p className="mb-3 text-xs text-muted-foreground">
                先定义一个门户登录和接口调用共用的访问密码，后面会直接写进 {SERVICE_KEY_ENV}。
              </p>
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") handleKeyConfirm(); }}
                  placeholder="输入你定义的服务访问密钥"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                />
                <button
                  onClick={handleKeyConfirm}
                  disabled={!keyInput.trim()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  确认
                </button>
              </div>
            </div>
          )}

          {showPrompt && (
            <div className="space-y-3 rounded-xl border border-border/60 bg-secondary/20 p-4">
              <div>
                <div className="text-sm font-medium">步骤 {showKeyStep ? "2" : "1"}：执行补全配置</div>
                <p className="text-xs text-muted-foreground">
                  把下面整段指令发给平台 Agent。执行并重启工作流后，再点上面的“重新检测”。
                </p>
              </div>
              <CopyableBlock text={prompt} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t bg-secondary/20 px-5 py-4">
          <div className="text-xs text-muted-foreground">向导只负责检测状态和生成操作指令。</div>
          <div className="flex gap-2">
            <button
              onClick={onDismiss}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-secondary"
            >
              关闭
            </button>
            <button
              onClick={() => onComplete(chosenKey ?? undefined)}
              disabled={!isComplete}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
