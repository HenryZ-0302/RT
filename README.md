# Unified Service Layer

Unified Service Layer is a neutral service access layer for model routing, compatibility, and operations. It keeps the existing runtime behavior intact while standardizing the public-facing portal, docs, and management aliases.

## What It Provides

- OpenAI-compatible access through `/v1/chat/completions`, `/v1/models`, and `/v1/messages`
- Neutral management aliases under `/api/service/*`
- A portal for health checks, bootstrap status, routing, model toggles, logs, and release status
- Primary access key support via `SERVICE_ACCESS_KEY`, with `PROXY_API_KEY` kept for compatibility
- Primary update source support via `SERVICE_UPDATE_URL`, with `UPDATE_CHECK_URL` kept for compatibility

## Quick Start

1. Install dependencies with `pnpm install`.
2. Configure the service access key:
   `SERVICE_ACCESS_KEY=your-secret`
3. Provide any platform-injected backend credentials you need:
   `AI_INTEGRATIONS_OPENAI_*`
   `AI_INTEGRATIONS_ANTHROPIC_*`
   `AI_INTEGRATIONS_GEMINI_*`
   `AI_INTEGRATIONS_OPENROUTER_*`
4. Run checks with `pnpm run typecheck`.
5. Build with `pnpm run build`.

## Public Routes

| Purpose | Preferred route | Legacy route |
| --- | --- | --- |
| Health | `/api/service/status` | `/api/healthz` |
| Bootstrap status | `/api/service/bootstrap` | `/api/setup-status` |
| Model catalog | `/api/service/catalog` | `/v1/models` |
| Chat | `/api/service/chat` | `/v1/chat/completions` |
| Messages | `/api/service/messages` | `/v1/messages` |
| Metrics | `/api/service/metrics` | `/v1/stats` |
| Logs | `/api/service/logs` | `/v1/admin/logs` |
| Release info | `/api/service/release` | `/api/update/version` |

## Authentication

Protected routes accept any of the following:

- `Authorization: Bearer YOUR_SERVICE_ACCESS_KEY`
- `x-api-key: YOUR_SERVICE_ACCESS_KEY`
- `x-goog-api-key: YOUR_SERVICE_ACCESS_KEY`
- `?key=YOUR_SERVICE_ACCESS_KEY` for the log stream endpoint

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `SERVICE_ACCESS_KEY` | Primary service access key |
| `PROXY_API_KEY` | Legacy alias for the access key |
| `SERVICE_UPDATE_URL` | Primary remote release metadata URL |
| `UPDATE_CHECK_URL` | Legacy alias for the remote release metadata URL |
| `SERVICE_UPSTREAM_REPO` | Optional upstream repo in `owner/repo` form |
| `SERVICE_UPSTREAM_BRANCH` | Optional upstream branch name |
| `AI_INTEGRATIONS_*` | Platform-injected backend credentials and base URLs |

## Notes

- Existing `/v1/*`, `/api/*`, `/update/*`, and `/settings/*` routes remain available.
- The portal defaults to the neutral `/api/service/*` aliases.
- Responses now include `X-Service-Version` and keep `X-Proxy-Version` for backward compatibility.
