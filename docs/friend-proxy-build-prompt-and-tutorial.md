# 朋友节点 — 完整部署文档

> 本文档包含：完整构建提示词、技术架构说明、接入步骤与注意事项。
> 将构建提示词发给 Replit Agent，即可在任意 Replit 账号上一键部署朋友节点。

---

## 一、完整构建提示词

将以下内容完整粘贴给 Replit Agent：

```
在 Replit 上构建一个轻量 OpenAI 兼容代理服务，作为 AI 代理池的后端节点。

【技术栈】
- pnpm monorepo，两个 artifact：
    artifacts/api-server  （Express + TypeScript 后端）
    artifacts/api-portal  （React + Vite 前端状态页）
- 后端依赖：express、openai SDK、@anthropic-ai/sdk、pino-http、cors
- 前端：使用纯 inline styles，深色主题 hsl(222,47%,11%)，不使用 Tailwind 工具类
- esbuild 打包为单文件运行
- Body 限制 50mb，开启全局 CORS

【环境变量】
Secret：
  PROXY_API_KEY         — 统一鉴权密钥（所有接口使用）

Replit AI Integrations（在项目设置中开启 OpenAI + Anthropic 集成，自动注入）：
  AI_INTEGRATIONS_OPENAI_API_KEY
  AI_INTEGRATIONS_OPENAI_BASE_URL
  AI_INTEGRATIONS_ANTHROPIC_API_KEY
  AI_INTEGRATIONS_ANTHROPIC_BASE_URL

【鉴权】
所有 /v1/* 接口均要求鉴权，支持三种方式：
  1. Authorization: Bearer <PROXY_API_KEY>   （推荐）
  2. x-goog-api-key: <PROXY_API_KEY>          （兼容 Gemini 格式客户端）
  3. ?key=<PROXY_API_KEY>                     （URL 查询参数）

【接口】
GET  /api/healthz              → { status: "ok" }（不需要鉴权）
GET  /v1/models                → 返回 OpenAI 格式模型列表（需鉴权）
POST /v1/chat/completions      → 代理转发，支持流式和非流式（需鉴权）

【路由逻辑 — /v1/chat/completions 内部】

根据 model 名称决定后端：

1. 匹配 claude-* 开头 → 调用 Anthropic SDK（本地 AI 集成）

   Suffix 处理（调用前必须先剥离，不能把 suffix 传给 Anthropic）：
     model 以 -thinking-visible 结尾 → 剥离 suffix，thinkingVisible=true，thinkingEnabled=true
     model 以 -thinking 结尾         → 剥离 suffix，thinkingEnabled=true
     否则                             → 不启用 thinking

   Claude max_tokens 配置（必须遵守，不可更改）：
     claude-haiku-4-5                    → 8096
     claude-sonnet-4-5 / claude-sonnet-4-6 → 64000
     claude-opus-4-1 / claude-opus-4-5 / claude-opus-4-6 → 64000
     其余 claude-* 默认                  → 32000
   如果 thinkingEnabled=true，取 max(modelMax, 32000)

   Thinking 参数（thinkingEnabled 时加入请求）：
     { thinking: { type: "enabled", budget_tokens: 16000 } }

   消息格式转换：
     - system 角色消息 → 提取为 Anthropic system 字符串
     - image_url 内容块 → 转换为 Anthropic image source
       base64 data URI → { type: "base64", media_type, data }
       普通 URL        → { type: "url", url }

   流式输出（SSE，OpenAI 格式）：
     - message_start           → 发送 { delta: { role: "assistant", content: "" } }
     - content_block_start (thinking) → 发送 "<thinking>\n" 作为 content
     - content_block_start (text，thinking 之后) → 发送 "\n</thinking>\n\n" 作为 content
     - content_block_delta thinking_delta → 发送 thinking 文本作为 content
     - content_block_delta text_delta    → 发送正文文本（记录 TTFT）
     - message_delta           → 发送 finish_reason + usage
     - 每 5 秒发送 ": keepalive\n\n" 心跳防超时
     - 最后发送 "data: [DONE]\n\n"

   非流式输出：
     - 收集所有 thinking 块，用 <thinking>...</thinking> 包裹
     - 与正文用 \n\n 拼接，包装为 OpenAI chat completion JSON 返回

2. 其余模型 → 调用 OpenAI SDK（本地 AI 集成）

   流式：加 stream_options: { include_usage: true }
   非流式：直接返回 SDK 结果
   SSE 头：Content-Type: text/event-stream, Cache-Control: no-cache, X-Accel-Buffering: no
   每个 chunk 立即 flush

【模型列表（/v1/models 返回）】

OpenAI 系列：
  gpt-5.2, gpt-5.1, gpt-5, gpt-5-mini, gpt-5-nano
  gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
  gpt-4o, gpt-4o-mini
  o4-mini, o3, o3-mini
  o-series 另加 -thinking 别名：o4-mini-thinking, o3-thinking, o3-mini-thinking

Anthropic 系列（每个基础模型展开三个变体）：
  claude-opus-4-6  / claude-opus-4-6-thinking  / claude-opus-4-6-thinking-visible
  claude-opus-4-5  / claude-opus-4-5-thinking  / claude-opus-4-5-thinking-visible
  claude-opus-4-1  / claude-opus-4-1-thinking  / claude-opus-4-1-thinking-visible
  claude-sonnet-4-6 / claude-sonnet-4-6-thinking / claude-sonnet-4-6-thinking-visible
  claude-sonnet-4-5 / claude-sonnet-4-5-thinking / claude-sonnet-4-5-thinking-visible
  claude-haiku-4-5  / claude-haiku-4-5-thinking  / claude-haiku-4-5-thinking-visible

Gemini 系列（展示在列表中，实际路由依赖上游配置）：
  gemini-3.1-pro-preview / -thinking / -thinking-visible
  gemini-3-flash-preview / -thinking / -thinking-visible
  gemini-2.5-pro  / -thinking / -thinking-visible
  gemini-2.5-flash / -thinking / -thinking-visible

OpenRouter 系列（展示在列表中）：
  x-ai/grok-4.20, x-ai/grok-4.1-fast, x-ai/grok-4-fast
  meta-llama/llama-4-maverick, meta-llama/llama-4-scout
  deepseek/deepseek-v3.2, deepseek/deepseek-r1, deepseek/deepseek-r1-0528
  mistralai/mistral-small-2603, qwen/qwen3.5-122b-a10b
  google/gemini-2.5-pro, anthropic/claude-opus-4.6

【前端状态页（极简）】

使用纯 inline styles，不使用 Tailwind 工具类，深色背景 hsl(222,47%,11%)。

展示内容：
  - 页面标题："AI Proxy Node"
  - 服务在线状态徽章（调 GET /api/healthz，每 30 秒刷新）
  - Base URL（当前页面 origin，一键复制按钮）
  - 一行说明文字："Use this Base URL and your PROXY_API_KEY to connect."
  - 模型列表（分 OpenAI / Anthropic 两组折叠展示，每行显示模型 ID）

不需要：统计面板、用量图表、添加节点表单、SillyTavern 教程、CherryStudio 教程。
保持页面简洁，整体代码量尽可能少。

【不需要的功能】
- 不需要多节点轮询
- 不需要 /v1/stats 接口
- 不需要 /v1/admin/backends 接口
- 不需要 dynamic_backends.json 持久化
- 不需要后台健康检查定时器
- 不需要 per-backend 统计
```

---

## 二、技术架构说明

### 整体结构

```
pnpm monorepo
├── artifacts/
│   ├── api-server/    Express + TypeScript，绑定 $PORT
│   └── api-portal/    React + Vite，绑定 $PORT（独立端口）
└── pnpm-workspace.yaml
```

### 核心路由逻辑

```
POST /v1/chat/completions
│
├── model 以 claude-* 开头？
│   ├── 是 → Anthropic SDK
│   │        └── 剥离 -thinking / -thinking-visible suffix
│   │            启用 thinking 参数（budget=16000）
│   │            转换 messages 格式
│   │            流式：SSE → OpenAI chunk 格式
│   │            非流：包装为 OpenAI JSON
│   │
│   └── 否 → OpenAI SDK（直接透传）
│             流式：stream_options include_usage
│             非流：直接返回
```

### Claude max_tokens 对照表

| 模型 | max_tokens |
|------|-----------|
| claude-haiku-4-5 | 8,096 |
| claude-sonnet-4-5 | 64,000 |
| claude-sonnet-4-6 | 64,000 |
| claude-opus-4-1 | 64,000 |
| claude-opus-4-5 | 64,000 |
| claude-opus-4-6 | 64,000 |
| 其余 claude-* | 32,000 |

> 启用 thinking 时：`max(modelMax, 32000)`

### Thinking suffix 处理

```
请求 model 名         剥离后实际调用    thinkingEnabled
─────────────────────────────────────────────────────
claude-opus-4-6               claude-opus-4-6      false
claude-opus-4-6-thinking      claude-opus-4-6      true（思考过程隐藏）
claude-opus-4-6-thinking-visible  claude-opus-4-6  true（思考过程可见，包裹在 <thinking> 标签中）
```

### SSE 流式输出格式（Claude → OpenAI）

| Anthropic 事件 | 发出的 OpenAI chunk |
|---|---|
| `message_start` | `{ delta: { role: "assistant", content: "" } }` |
| `content_block_start` (thinking) | `<thinking>\n` 作为 content |
| `content_block_delta` thinking_delta | thinking 文本 |
| `content_block_start` (text，thinking 结束后) | `\n</thinking>\n\n` |
| `content_block_delta` text_delta | 正文文本 |
| `message_delta` | finish_reason + usage |
| 最终 | `data: [DONE]\n\n` |

> **keepalive**：每 5 秒发送 `: keepalive\n\n`，防止 Claude thinking 期间连接超时。

---

## 三、接入步骤

### 第一步：部署节点

1. 朋友用自己的 Replit 账号，把上方提示词发给 Agent 新建项目
2. 等待构建完成，日志显示 `Server listening`
3. 在项目 **Secrets** 面板中添加：

   | Key | Value |
   |---|---|
   | `PROXY_API_KEY` | 与主代理相同的密钥 |

4. 在 Replit 项目设置中开启 **AI Integrations**（OpenAI + Anthropic）
5. 点击 **Publish / Deploy**，获得公开地址：`https://xxx.replit.app`

### 第二步：验证节点

```bash
# 1. 检查在线状态
curl https://朋友的节点地址/api/healthz

# 2. 检查模型列表
curl https://朋友的节点地址/v1/models \
  -H "Authorization: Bearer 共用的PROXY_API_KEY"

# 3. 发送测试请求
curl https://朋友的节点地址/v1/chat/completions \
  -H "Authorization: Bearer 共用的PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}]}'

# 4. 测试 Claude（非流式）
curl https://朋友的节点地址/v1/chat/completions \
  -H "Authorization: Bearer 共用的PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"hi"}]}'
```

三个请求都正常返回 → 节点就绪。

### 第三步：加入主代理轮询池

在**主代理**的 Replit 环境变量中添加：

| Key | Value |
|---|---|
| `FRIEND_PROXY_URL` | `https://朋友节点地址`（已有则用 `_2`、`_3`…） |

重启主代理的 API Server 工作流，朋友节点自动加入轮询池。

---

## 四、注意事项

| 事项 | 说明 |
|---|---|
| **密钥必须一致** | 主代理和所有朋友节点必须使用完全相同的 `PROXY_API_KEY` |
| **保持发布状态** | 朋友项目必须 Deploy（发布），不能仅在开发模式运行 |
| **AI 集成配额** | 朋友节点使用的是朋友 Replit 账号自己的 AI Integrations 配额 |
| **节点自动探测** | 主代理每 30 秒健康检查一次，节点故障自动剔除，恢复后自动加回 |
| **无限扩展** | 继续添加 `FRIEND_PROXY_URL_4`、`_5`… 直到 `_20`，无需改代码 |
| **Gemini/OpenRouter** | 模型列表中展示，但这些模型的实际响应取决于上游配额情况 |
