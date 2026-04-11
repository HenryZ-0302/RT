# Unified Service Layer — V1.1.8

本次版本重点：
- 补充模型列表鉴权兼容，改善聊天客户端拉取模型列表的成功率
- 修复 Claude thinking 路径与 Opus 4.1 输出上限问题
- 门户改为前置服务密钥验证，并继续精简站内入口

## Project Summary

This project exposes a compatibility layer and operations portal for multiple model backends. Public naming is neutralized to “Unified Service Layer”, while legacy interfaces remain intact for existing clients.

## Core Runtime

- `/v1/chat/completions` for OpenAI-compatible chat
- `/v1/messages` for message-style requests
- `/v1/models` for model discovery
- `/v1/stats` and admin routes for metrics, routing, backends, and model toggles
- `/api/service/*` aliases for portal and neutral public docs
- `/api/service/release*` aliases for release status and apply flows

## Auth

Protected routes prefer `SERVICE_ACCESS_KEY`.
Legacy clients may continue using `PROXY_API_KEY`.

Supported request auth:

- `Authorization: Bearer <key>`
- `x-api-key: <key>`
- `x-goog-api-key: <key>`
- `?key=<key>` on the log stream endpoint

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `SERVICE_ACCESS_KEY` | Primary service access key |
| `PROXY_API_KEY` | Legacy access-key alias |
| `SERVICE_UPDATE_URL` | Primary release metadata source |
| `UPDATE_CHECK_URL` | Legacy release metadata alias |
| `SERVICE_UPSTREAM_REPO` | Optional upstream repo override |
| `SERVICE_UPSTREAM_BRANCH` | Optional upstream branch override |
| `AI_INTEGRATIONS_OPENAI_*` | OpenAI integration credentials |
| `AI_INTEGRATIONS_ANTHROPIC_*` | Anthropic integration credentials |
| `AI_INTEGRATIONS_GEMINI_*` | Gemini integration credentials |
| `AI_INTEGRATIONS_OPENROUTER_*` | OpenRouter integration credentials |

## Commands

- `pnpm run typecheck`
- `pnpm run build`
- `pnpm --filter @workspace/api-server run dev`

## Persistence Files

- `dynamic_backends.json`
- `disabled_models.json`
- `server_settings.json`
- `usage_stats.json`
