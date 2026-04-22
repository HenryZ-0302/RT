import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AlertCircle, Bot, Loader2, MessageSquare, Send, Sparkles, Square, Trash2, User } from "lucide-react";
import { cn } from "../lib/utils";

interface ModelStatus {
  id: string;
  description?: string;
  provider: string;
  group: string;
  capability: "chat" | "image";
  testMode: "chat" | "image";
  enabled: boolean;
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

const CHAT_MODEL_STORAGE_KEY = "portal_chat_model";
const CHAT_MESSAGES_STORAGE_KEY = "portal_chat_messages";

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card text-card-foreground rounded-xl border border-border/50 shadow-sm p-5", className)}>
      {children}
    </div>
  );
}

function readStoredChatModel(): string {
  try {
    return localStorage.getItem(CHAT_MODEL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function readStoredMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_MESSAGES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ChatMessage =>
        !!item
        && typeof item === "object"
        && (item as ChatMessage).role !== undefined
        && ((item as ChatMessage).role === "user" || (item as ChatMessage).role === "assistant")
        && typeof (item as ChatMessage).content === "string"
        && typeof (item as ChatMessage).id === "string"
        && typeof (item as ChatMessage).createdAt === "string"
      );
  } catch {
    return [];
  }
}

function buildMessageId(role: ChatMessage["role"]): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

function extractChunkText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = "choices" in payload ? payload.choices : undefined;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  if (!firstChoice || typeof firstChoice !== "object") return "";

  const delta = "delta" in firstChoice ? firstChoice.delta : undefined;
  const deltaText = delta && typeof delta === "object" ? getMessageText("content" in delta ? delta.content : undefined) : "";
  if (deltaText) return deltaText;

  return getMessageText("message" in firstChoice && firstChoice.message && typeof firstChoice.message === "object"
    ? ("content" in firstChoice.message ? firstChoice.message.content : undefined)
    : undefined);
}

export function ChatPage({
  baseUrl,
  apiKey,
  modelStatus,
}: {
  baseUrl: string;
  apiKey: string;
  modelStatus: ModelStatus[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => readStoredMessages());
  const [draft, setDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState(() => readStoredChatModel());
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const chatModels = useMemo(
    () => modelStatus.filter((model) => model.enabled && model.capability === "chat"),
    [modelStatus],
  );

  const selectedModelMeta = chatModels.find((model) => model.id === selectedModel) ?? null;
  const hasModels = chatModels.length > 0;

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Ignore storage write failures in self-hosted portal mode.
    }
  }, [messages]);

  useEffect(() => {
    try {
      if (selectedModel) localStorage.setItem(CHAT_MODEL_STORAGE_KEY, selectedModel);
      else localStorage.removeItem(CHAT_MODEL_STORAGE_KEY);
    } catch {
      // Ignore storage write failures in self-hosted portal mode.
    }
  }, [selectedModel]);

  useEffect(() => {
    if (!hasModels) {
      if (selectedModel) setSelectedModel("");
      return;
    }

    if (!selectedModelMeta) {
      setSelectedModel(chatModels[0].id);
    }
  }, [chatModels, hasModels, selectedModel, selectedModelMeta]);

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, isStreaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const updateAssistantMessage = (assistantId: string, updater: (current: ChatMessage) => ChatMessage) => {
    setMessages((current) => current.map((message) => message.id === assistantId ? updater(message) : message));
  };

  const stopStreaming = () => {
    if (!abortRef.current) return;
    setIsStopping(true);
    abortRef.current.abort();
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || !selectedModel || !apiKey || isStreaming) return;

    const userMessage: ChatMessage = {
      id: buildMessageId("user"),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: ChatMessage = {
      id: buildMessageId("assistant"),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };
    const requestMessages = [...messages, userMessage].map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setDraft("");
    setError(null);
    setIsStreaming(true);
    setIsStopping(false);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = "";

    try {
      const response = await fetch(`${baseUrl}/api/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: requestMessages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = typeof body?.error?.message === "string"
          ? body.error.message
          : `请求失败（HTTP ${response.status}）`;
        throw new Error(message);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("服务端未返回可读取的流式响应。");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const data = event
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n")
            .trim();

          if (!data) continue;
          if (data === "[DONE]") {
            streamDone = true;
            break;
          }

          const payload = JSON.parse(data) as { error?: { message?: string } };
          if (payload.error?.message) {
            throw new Error(payload.error.message);
          }

          const chunkText = extractChunkText(payload);
          if (!chunkText) continue;

          assistantText += chunkText;
          updateAssistantMessage(assistantMessage.id, (current) => ({
            ...current,
            content: current.content + chunkText,
          }));
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (!assistantText) {
          setMessages((current) => current.filter((message) => message.id !== assistantMessage.id));
        }
        return;
      }

      if (!assistantText) {
        setMessages((current) => current.filter((message) => message.id !== assistantMessage.id));
      }

      setError(err instanceof Error ? err.message : "聊天请求失败，请稍后重试。");
      return;
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setIsStopping(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendMessage();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (isStreaming) {
      stopStreaming();
      return;
    }
    void sendMessage();
  };

  const clearConversation = () => {
    if (!messages.length) return;
    if (!window.confirm("确认要清空当前聊天记录吗？这只会删除当前浏览器里的本地记录。")) return;
    if (isStreaming) abortRef.current?.abort();
    setMessages([]);
    setError(null);
  };

  if (!apiKey) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border-dashed border-2 border-border/50 rounded-xl bg-card/50 min-h-[400px]">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-muted-foreground mb-4">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-xl font-bold mb-2">需要认证</h2>
        <p className="text-muted-foreground max-w-sm">请先输入服务密钥并进入仪表盘，再使用在线聊天。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <Card className="bg-secondary/20 shadow-none border-border/60">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-primary to-primary/50" />
              <h1 className="text-xl font-bold tracking-tight">在线聊天</h1>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              直接通过当前服务的 `/api/v1/chat/completions` 进行流式对话，聊天记录只保存在这个浏览器里。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,300px)_auto] sm:items-end">
            <label className="space-y-2">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">当前模型</div>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={!hasModels || isStreaming}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              >
                {hasModels ? (
                  chatModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))
                ) : (
                  <option value="">暂无可用文本模型</option>
                )}
              </select>
            </label>

            <button
              type="button"
              onClick={clearConversation}
              disabled={!messages.length}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={15} />
              新对话
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border font-medium",
            isStreaming
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
          )}>
            {isStreaming ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {isStreaming ? "生成中" : "就绪"}
          </span>
          {selectedModelMeta && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border border-border bg-background text-muted-foreground">
              <MessageSquare size={12} />
              {selectedModelMeta.provider} · {selectedModelMeta.id}
            </span>
          )}
        </div>
        {selectedModelMeta?.description && (
          <div className="mt-3 text-sm text-muted-foreground">
            {selectedModelMeta.description}
          </div>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div
          ref={messagesRef}
          className="min-h-[420px] max-h-[62vh] overflow-y-auto p-4 md:p-6 bg-gradient-to-b from-background to-secondary/10"
        >
          {messages.length === 0 ? (
            <div className="h-full min-h-[420px] flex items-center justify-center">
              <div className="max-w-md text-center space-y-4 text-muted-foreground">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                  <MessageSquare size={26} />
                </div>
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-foreground">开始一段在线对话</h2>
                  <p className="text-sm leading-relaxed">
                    这里适合直接验证模型可用性、临时问答和自用聊天。按 Enter 发送，Shift + Enter 换行。
                  </p>
                  {!hasModels && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      当前没有已启用的文本模型，请先去模型页开启至少一个聊天模型。
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((message, index) => {
                const isUser = message.role === "user";
                const isLastAssistant = !isUser && index === messages.length - 1;
                const showStreamingHint = isStreaming && isLastAssistant && !message.content;

                return (
                  <div key={message.id} className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
                    {!isUser && (
                      <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 border border-primary/15">
                        <Bot size={18} />
                      </div>
                    )}

                    <div className={cn("max-w-[85%] space-y-1", isUser && "items-end")}>
                      <div className={cn(
                        "rounded-2xl px-4 py-3 text-sm leading-7 whitespace-pre-wrap break-words shadow-sm",
                        isUser
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-secondary/70 border border-border/60 text-foreground rounded-bl-md",
                      )}>
                        {showStreamingHint ? (
                          <span className="inline-flex items-center gap-2 text-muted-foreground">
                            <Loader2 size={14} className="animate-spin" />
                            正在生成回复...
                          </span>
                        ) : (
                          message.content
                        )}
                      </div>
                      <div className={cn(
                        "text-[11px] text-muted-foreground px-1",
                        isUser ? "text-right" : "text-left",
                      )}>
                        {isUser ? "你" : "助手"} · {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </div>
                    </div>

                    {isUser && (
                      <div className="w-9 h-9 rounded-xl bg-secondary text-muted-foreground flex items-center justify-center flex-shrink-0 border border-border/60">
                        <User size={18} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border/60 bg-card p-4 md:p-5">
          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <div className="min-w-0 break-words">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={!hasModels}
              placeholder={hasModels ? "输入消息，按 Enter 发送，Shift + Enter 换行" : "暂无可用文本模型，请先到模型页启用"}
              rows={4}
              className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">
                当前会话共 <span className="font-mono text-foreground">{messages.length}</span> 条消息，本地自动保存。
              </div>

              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500/90 transition-colors"
                >
                  {isStopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={15} />}
                  {isStopping ? "停止中..." : "停止生成"}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim() || !selectedModel || !hasModels}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send size={16} />
                  发送消息
                </button>
              )}
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
