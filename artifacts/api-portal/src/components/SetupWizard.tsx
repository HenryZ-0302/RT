import { useState, useEffect, useRef, useCallback } from "react";
import { SERVICE_KEY_ENV, servicePaths } from "../lib/service";

interface Props {
  baseUrl: string;
  onComplete: (apiKey?: string) => void;
  onDismiss: () => void;
}

interface CopyBlock {
  text: string;
}

interface Action {
  label: string;
  value: string;
  primary?: boolean;
}

interface Message {
  id: number;
  from: "agent" | "user";
  text: string;
  copyBlocks?: CopyBlock[];
  actions?: Action[];
}

interface SetupStatus {
  configured: boolean;
  integrationsReady: boolean;
  storageReady: boolean;
}

function buildSetupPrompt(
  apiKey: string,
  options: { needIntegrations: boolean; needStorage: boolean } = { needIntegrations: true, needStorage: true },
): string {
  const steps: string[] = [];
  let step = 0;

  steps.push(
    `步骤 ${++step}：写入服务访问密钥\n` +
    `请在平台 Secrets 中创建如下键值，并保持原样：\n` +
    `${SERVICE_KEY_ENV} = ${apiKey}`,
  );

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
    `- artifacts/api-portal: web`
  );
}

const STORAGE_ONLY_PROMPT =
  `请帮我为 Unified Service Layer 开通云端持久化存储。\n\n` +
  `请在 code_execution 工具中执行：\n` +
  `const result = await setupObjectStorage();\n` +
  `console.log(JSON.stringify(result));\n\n` +
  `完成后重启 "artifacts/api-server: API Server" 和 "artifacts/api-portal: web"。`;

let msgId = 0;
const makeMessage = (
  from: Message["from"],
  text: string,
  extras: Partial<Omit<Message, "id" | "from" | "text">> = {},
): Message => ({ id: ++msgId, from, text, ...extras });

function CopyableBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(99,102,241,0.3)",
        borderRadius: "8px",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginTop: "8px",
      }}
    >
      <span
        style={{
          flex: 1,
          color: "#a5b4fc",
          fontSize: "13px",
          fontFamily: "Menlo, monospace",
          lineHeight: "1.5",
          whiteSpace: "pre-wrap",
          userSelect: "all",
        }}
      >
        {text}
      </span>
      <button
        onClick={copy}
        style={{
          padding: "5px 12px",
          borderRadius: "6px",
          border: `1px solid ${copied ? "rgba(74,222,128,0.4)" : "rgba(99,102,241,0.4)"}`,
          background: copied ? "rgba(74,222,128,0.12)" : "rgba(99,102,241,0.15)",
          color: copied ? "#4ade80" : "#818cf8",
          fontSize: "11.5px",
          fontWeight: 700,
          cursor: "pointer",
          flexShrink: 0,
          transition: "all 0.2s",
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

export default function SetupWizard({ baseUrl, onComplete, onDismiss }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const [checking, setChecking] = useState(false);
  const [keyInputStep, setKeyInputStep] = useState(false);
  const [keyInputValue, setKeyInputValue] = useState("");
  const [chosenKey, setChosenKey] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const addAgent = useCallback((text: string, extras: Partial<Omit<Message, "id" | "from" | "text">> = {}, delay = 300) => {
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages((prev) => [...prev, makeMessage("agent", text, extras)]);
    }, delay);
  }, []);

  const addUser = useCallback((text: string) => {
    setMessages((prev) => [...prev, makeMessage("user", text)]);
  }, []);

  const clearActions = useCallback(() => {
    setMessages((prev) => prev.map((message) => ({ ...message, actions: undefined })));
  }, []);

  const checkSetupStatus = useCallback(async (): Promise<SetupStatus> => {
    try {
      const response = await fetch(servicePaths.bootstrap(baseUrl), {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return { configured: false, integrationsReady: false, storageReady: false };
      return (await response.json()) as SetupStatus;
    } catch {
      return { configured: false, integrationsReady: false, storageReady: false };
    }
  }, [baseUrl]);

  const runCheck = useCallback(async () => {
    clearActions();
    setChecking(true);
    addUser("检查当前配置");
    addAgent("正在检查服务当前的初始化状态...", {}, 200);

    const status = await checkSetupStatus();
    setChecking(false);
    setMessages((prev) => prev.filter((message) => message.text !== "正在检查服务当前的初始化状态..."));

    if (status.configured && status.integrationsReady && status.storageReady) {
      addAgent(
        "配置已经完成。\n\n你现在可以直接使用统一服务层门户；如果你刚刚重启过工作流，也可以点击“完成”返回首页。",
        { actions: [{ label: "完成", value: "finish", primary: true }] },
      );
      return;
    }

    if (status.configured && status.integrationsReady && !status.storageReady) {
      addAgent(
        "访问密钥和平台集成都已经就绪，现在只差云端持久化存储。\n\n请把下面的指令发给平台 Agent，执行完成后再回来重新检测。",
        {
          copyBlocks: [{ text: STORAGE_ONLY_PROMPT }],
          actions: [{ label: "我已重启，重新检测", value: "check", primary: true }],
        },
      );
      return;
    }

    if (chosenKey) {
      addAgent(
        "服务还没有完成全部初始化。\n\n我已经根据当前状态生成了最短的补全指令，你可以直接复制给平台 Agent。",
        {
          copyBlocks: [{
            text: buildSetupPrompt(chosenKey, {
              needIntegrations: !status.integrationsReady,
              needStorage: !status.storageReady,
            }),
          }],
          actions: [{ label: "我已重启，重新检测", value: "check", primary: true }],
        },
      );
      return;
    }

    addAgent(
      "检测到服务还没有完成初始化。\n\n先设置一个服务访问密钥，我会立即为你生成完整配置指令。",
      { actions: [{ label: "开始配置", value: "start", primary: true }] },
    );
  }, [addAgent, addUser, checkSetupStatus, chosenKey, clearActions]);

  const handleKeySubmit = useCallback(() => {
    const key = keyInputValue.trim();
    if (!key) return;

    setChosenKey(key);
    setKeyInputStep(false);
    addUser("已设置服务访问密钥");
    clearActions();
    addAgent(
      "我已经记录好你的服务访问密钥。\n\n请把下面的指令完整复制后发送给平台 Agent。完成后重启工作流，再回来点“重新检测”。",
      {
        copyBlocks: [{ text: buildSetupPrompt(key) }],
        actions: [{ label: "我已重启，重新检测", value: "check", primary: true }],
      },
    );
  }, [addAgent, addUser, clearActions, keyInputValue]);

  const handleAction = useCallback((value: string, label: string) => {
    clearActions();

    if (value === "start") {
      addUser(label);
      setKeyInputStep(true);
      addAgent("请输入一个你自己定义的服务访问密钥。这个值会写入 SERVICE_ACCESS_KEY。");
      return;
    }

    if (value === "already_done" || value === "check") {
      void runCheck();
      return;
    }

    if (value === "finish") {
      onComplete(chosenKey || undefined);
    }
  }, [addAgent, addUser, chosenKey, clearActions, onComplete, runCheck]);

  useEffect(() => {
    setTimeout(() => {
      setMessages([
        makeMessage(
          "agent",
          "我是初始化助手。\n\n这个门户已经切换成统一服务层的中性包装，但底层兼容能力没有变化。首次运行时，需要确认服务访问密钥、平台集成和持久化存储是否就绪。",
          {
            actions: [
              { label: "开始配置", value: "start", primary: true },
              { label: "我已经配置过", value: "already_done" },
            ],
          },
        ),
      ]);
    }, 200);
  }, []);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }, [messages, typing]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        style={{
          background: "hsl(222,47%,12%)",
          border: "1px solid rgba(99,102,241,0.25)",
          borderRadius: "18px",
          width: "100%",
          maxWidth: "520px",
          height: "min(640px, 88vh)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: "34px", height: "34px", borderRadius: "50%",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "17px", flexShrink: 0,
            }}
          >
            S
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "#f1f5f9", fontSize: "13.5px" }}>初始化助手</div>
            <div style={{ fontSize: "11px", color: "#4ade80", display: "flex", alignItems: "center", gap: "4px" }}>
              <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#4ade80" }} />
              Online
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
            {checking && (
              <span style={{ fontSize: "11px", color: "#6366f1", animation: "pulse 1.5s ease-in-out infinite" }}>
                检测中...
              </span>
            )}
            <button
              onClick={onDismiss}
              style={{ background: "none", border: "none", color: "#334155", fontSize: "20px", cursor: "pointer", lineHeight: 1, padding: "4px" }}
            >
              x
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {messages.map((message) => (
            <div key={message.id} style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              <div style={{
                display: "flex",
                justifyContent: message.from === "agent" ? "flex-start" : "flex-end",
                gap: "8px",
                alignItems: "flex-end",
              }}>
                {message.from === "agent" && (
                  <div style={{
                    width: "26px", height: "26px", borderRadius: "50%",
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "13px", flexShrink: 0,
                  }}>
                    S
                  </div>
                )}
                <div style={{
                  maxWidth: "86%",
                  padding: "10px 13px",
                  borderRadius: message.from === "agent" ? "4px 13px 13px 13px" : "13px 4px 13px 13px",
                  background: message.from === "agent" ? "rgba(99,102,241,0.14)" : "rgba(74,222,128,0.1)",
                  border: `1px solid ${message.from === "agent" ? "rgba(99,102,241,0.22)" : "rgba(74,222,128,0.18)"}`,
                  color: message.from === "agent" ? "#cbd5e1" : "#a7f3d0",
                  fontSize: "13.5px",
                  lineHeight: "1.65",
                  whiteSpace: "pre-line",
                }}>
                  {message.text}
                  {message.copyBlocks?.map((block, index) => (
                    <CopyableBlock key={`${message.id}-${index}`} text={block.text} />
                  ))}
                </div>
              </div>

              {message.actions && (
                <div style={{ display: "flex", gap: "7px", flexWrap: "wrap", paddingLeft: "34px" }}>
                  {message.actions.map((action) => (
                    <button
                      key={action.value}
                      onClick={() => handleAction(action.value, action.label)}
                      disabled={checking}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "20px",
                        border: `1px solid ${action.primary ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.1)"}`,
                        background: action.primary ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.04)",
                        color: action.primary ? "#a5b4fc" : "#64748b",
                        fontSize: "12.5px",
                        fontWeight: 600,
                        cursor: checking ? "not-allowed" : "pointer",
                        opacity: checking ? 0.5 : 1,
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {typing && (
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
              <div style={{
                width: "26px", height: "26px", borderRadius: "50%",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "13px", flexShrink: 0,
              }}>
                S
              </div>
              <div style={{
                padding: "10px 14px",
                borderRadius: "4px 13px 13px 13px",
                background: "rgba(99,102,241,0.1)",
                border: "1px solid rgba(99,102,241,0.18)",
                display: "flex",
                gap: "4px",
                alignItems: "center",
              }}>
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#6366f1",
                      animation: `bounce 1s ease-in-out ${index * 0.15}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {keyInputStep ? (
          <div
            style={{
              padding: "12px 16px",
              borderTop: "1px solid rgba(99,102,241,0.2)",
              background: "rgba(99,102,241,0.06)",
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: "11.5px", color: "#64748b", marginBottom: "8px" }}>
              设置一个你自己的服务访问密钥，比如 <code style={{ color: "#a78bfa" }}>my-service-key-123</code>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                autoFocus
                type="text"
                value={keyInputValue}
                onChange={(event) => setKeyInputValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") handleKeySubmit(); }}
                placeholder="输入服务访问密钥"
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(99,102,241,0.35)",
                  background: "rgba(0,0,0,0.3)",
                  color: "#f1f5f9",
                  fontSize: "13.5px",
                  outline: "none",
                  fontFamily: "Menlo, monospace",
                }}
              />
              <button
                onClick={handleKeySubmit}
                disabled={!keyInputValue.trim()}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid rgba(99,102,241,0.5)",
                  background: keyInputValue.trim() ? "rgba(99,102,241,0.25)" : "rgba(99,102,241,0.06)",
                  color: keyInputValue.trim() ? "#a5b4fc" : "#334155",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: keyInputValue.trim() ? "pointer" : "not-allowed",
                  flexShrink: 0,
                  transition: "all 0.15s",
                }}
              >
                确认
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: "10px 18px",
              borderTop: "1px solid rgba(255,255,255,0.04)",
              fontSize: "11px",
              color: "#1e293b",
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            初始化由平台 Agent 执行，当前页面只负责生成指令与检查状态
          </div>
        )}
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
