import { useState, useEffect, useRef, useCallback } from "react";
import { SERVICE_KEY_ENV, servicePaths } from "../lib/service";
import { Check, Copy, Settings, X, Bot, Activity } from "lucide-react";
import { cn } from "../lib/utils";

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
    <div className="bg-zinc-950 border border-indigo-500/30 rounded-lg p-3 my-2 flex shadow-inner group">
      <span className="flex-1 text-indigo-300 text-xs font-mono whitespace-pre-wrap select-all leading-relaxed pr-4">
        {text}
      </span>
      <button
        onClick={copy}
        className={cn(
          "flex items-center justify-center gap-1.5 self-start px-3 py-1.5 rounded-md border text-xs font-bold transition-all shadow-sm",
          copied 
            ? "border-green-500/40 bg-green-500/10 text-green-500" 
            : "border-indigo-500/40 bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500/20"
        )}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
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
          "我是初始化助手。\n\n这个门户已经切换成统一服务层的中立包装，底层服务具备完整负载均衡与路由能力等待配置。\n\n首次运行时，需要确认服务访问密钥、平台集成和基础环境是否就绪。",
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
    <div className="fixed inset-0 z-[1000] bg-background/80 flex items-center justify-center p-4 backdrop-blur-md">
      <div className="w-full max-w-lg h-[min(640px,88vh)] flex flex-col bg-card border border-border/60 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden transform transition-all duration-300 animate-in fade-in zoom-in-95">
        
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b bg-secondary/50 flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-sm ring-2 ring-indigo-500/20">
             <Settings size={18} />
          </div>
          <div>
            <h3 className="font-bold text-[14px]">服务初始化助手</h3>
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-500 font-medium tracking-wide">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              就绪
            </div>
          </div>
          
          <div className="ml-auto flex items-center gap-4">
             {checking && (
               <div className="flex items-center gap-1.5 text-xs text-indigo-500 font-medium">
                  <Activity size={12} className="animate-spin" /> 检测中...
               </div>
             )}
            <button
              onClick={onDismiss}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 bg-background">
          {messages.map((message) => (
            <div key={message.id} className="flex flex-col gap-2">
              <div className={cn(
                "flex items-end gap-3",
                message.from === 'agent' ? "justify-start" : "justify-end"
              )}>
                {message.from === "agent" && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-sm flex-shrink-0 mb-1">
                     <Bot size={16} />
                  </div>
                )}
                
                <div className={cn(
                  "max-w-[85%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-sm",
                  message.from === "agent" 
                    ? "rounded-2xl rounded-bl-sm bg-secondary border border-border/60 text-foreground" 
                    : "rounded-2xl rounded-br-sm bg-primary border border-primary text-primary-foreground"
                )}>
                   {message.text}
                   {message.copyBlocks?.map((block, index) => (
                     <CopyableBlock key={`${message.id}-${index}`} text={block.text} />
                   ))}
                </div>
              </div>

              {message.actions && (
                <div className="flex flex-wrap gap-2 pl-11">
                  {message.actions.map((action) => (
                    <button
                      key={action.value}
                      onClick={() => handleAction(action.value, action.label)}
                      disabled={checking}
                      className={cn(
                        "px-4 py-2 rounded-full text-[13px] font-semibold transition-all shadow-sm",
                        action.primary 
                          ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/20" 
                          : "bg-secondary text-secondary-foreground border border-border/60 hover:bg-secondary/80",
                        checking && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {typing && (
            <div className="flex items-end gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-sm flex-shrink-0 opacity-50">
                <Bot size={16} />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-secondary border border-border flex items-center gap-1.5 h-[42px]">
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce"
                    style={{ animationDelay: `${index * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input Area */}
        {keyInputStep ? (
          <div className="p-4 border-t bg-indigo-500/5 dark:bg-indigo-500/10 border-indigo-500/20 flex-shrink-0">
             <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
               自定义一个用于接口调用的凭据 (如 <code className="bg-indigo-500/10 text-indigo-500 px-1 py-0.5 rounded">my-secure-key-123</code>)
             </div>
             <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={keyInputValue}
                  onChange={(event) => setKeyInputValue(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") handleKeySubmit(); }}
                  placeholder="输入你定义的服务访问密钥"
                  className="flex-1 px-4 py-2 bg-background border border-indigo-500/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none rounded-lg text-sm font-mono transition-shadow shadow-inner text-foreground"
                />
                <button
                  onClick={handleKeySubmit}
                  disabled={!keyInputValue.trim()}
                  className="px-5 py-2 bg-indigo-500 text-white font-bold text-sm rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm min-w-[80px]"
                >
                  确认
                </button>
             </div>
          </div>
        ) : (
          <div className="py-2.5 text-center text-[11px] text-muted-foreground border-t bg-secondary/30 flex-shrink-0 select-none">
            初始化由平台 Agent 执行，向导仅协助您生成并传递指令
          </div>
        )}

      </div>
    </div>
  );
}
