# AI Proxy Gateway — V1.1.7

## 项目概述

统一 AI API 网关，OpenAI 兼容格式，支持 OpenAI / Anthropic / Gemini / OpenRouter 四大后端。
通过 Replit Remix 分发，每位用户独立配置自己的 PROXY_API_KEY。

## 核心功能

- `/v1/chat/completions` — OpenAI 兼容接口（自动路由到 OpenAI / Claude / Gemini / OpenRouter）
- `/v1/messages` — Anthropic 原生接口（支持 Cherry Studio、Claude.ai 等 Anthropic 型客户端）
- `/v1/models` — 模型列表
- `/v1/stats` — 用量统计（含按节点 + 按模型 token 统计，支持按模型定价计算开销）
- `/v1/admin/backends` — 动态管理 Friend Proxy 节点
- `/v1/admin/logs` — 请求日志历史（ring buffer, 最近 200 条）
- `/v1/admin/logs/stream` — 实时日志 SSE 流（支持 `?key=` 查询参数认证）
- SillyTavern 兼容模式（对 Claude 自动追加「继续」消息，通过 `/api/settings/sillytavern` 持久化）
- 版本检测与自动更新（`/api/update/version` + `/api/update/apply`，需配置 `UPDATE_CHECK_URL`）
- 设置向导（首次访问自动显示，引导 AI 集成初始化 + PROXY_API_KEY 设置）
- 假流式（Fake Streaming）— 将非流式 JSON 自动模拟为 SSE 流

## Portal 前端 Tabs

| Tab | 组件 | 说明 |
|-----|------|------|
| 概览 | `PageHome` (inline) | 状态、连接信息、API Key 输入 |
| 统计 | `PageStats` (inline) | 节点用量、路由策略设置 |
| 模型 | `PageModels` (inline) | 模型启用/禁用管理 |
| 日志 | `PageLogs` | SSE 实时日志查看器，支持过滤/下载/清空 |
| 文档 | `PageDocs` | 技术文档手风琴式展示 |

## 路由架构

- **外部客户端**（CherryStudio 等）直接访问 api-server 域名，使用 `/v1/*` 路径
- **Portal 内部调用**通过 Replit 路由代理，使用 `/api/v1/*` 路径（api-server 双重挂载 proxyRouter 在 `/` 和 `/api`）

## 后端路由

| Provider | 路由方式 | SDK / Client |
|----------|---------|-------------|
| OpenAI | `handleOpenAI()` + `makeLocalOpenAI()` | OpenAI SDK → `AI_INTEGRATIONS_OPENAI_*` |
| Anthropic | `handleClaude()` + `makeLocalAnthropic()` | Anthropic SDK → `AI_INTEGRATIONS_ANTHROPIC_*` |
| Gemini | `handleGemini()` + `makeLocalGemini()` | `@google/genai` SDK → `AI_INTEGRATIONS_GEMINI_*` |
| OpenRouter | `handleOpenAI()` + `makeLocalOpenRouter()` | OpenAI SDK → `AI_INTEGRATIONS_OPENROUTER_*` |
| Friend 节点 | `handleFriendProxy()` | 直接 fetch 转发 |

## 认证

所有 `/v1/*` 和 `/settings/*` 路由均受 `PROXY_API_KEY` 保护，支持：
- `Authorization: Bearer <key>`（OpenAI 风格）
- `x-api-key: <key>`（Anthropic 风格）
- `?key=<key>` 查询参数（仅限 SSE 日志流端点）

## 环境变量

| 变量 | 说明 |
|------|------|
| `PROXY_API_KEY` | 必填，保护代理的访问密钥 |
| `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` | Replit AI 集成自动注入 |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` / `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Replit AI 集成自动注入 |
| `AI_INTEGRATIONS_GEMINI_API_KEY` / `AI_INTEGRATIONS_GEMINI_BASE_URL` | Replit AI 集成自动注入 |
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` / `AI_INTEGRATIONS_OPENROUTER_BASE_URL` | Replit AI 集成自动注入 |
| `UPDATE_CHECK_URL` | 可选，远端 `version.json` URL，用于版本检测 |
| `FRIEND_PROXY_URL` / `FRIEND_PROXY_URL_2` ... | 可选，Friend Proxy 节点 URL |

## 版本

当前版本：**V1.1.7**（见 `version.json`）

## 持久化文件

- `dynamic_backends.json` — 动态 Friend Proxy 节点列表
- `server_settings.json` — 服务器设置（含 SillyTavern 模式开关）
- `usage_stats.json` — 用量统计（按节点 + 按模型，10s 去抖 + 5min 安全写入）
- `disabled_models.json` — 禁用模型列表

## Workspace

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
