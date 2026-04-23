# RT

RT is a Replit-first two-service workspace:

- `artifacts/api-server`
- `artifacts/api-portal`

The server provides unified AI proxying, management routes, model controls, update support, and usage stats.
The portal provides the self-hosted control panel for setup, status, models, routing, logs, chat, and docs.

## Quick Start

For a fresh Replit install or re-initialization:

1. Sync the repository files into the workspace.
2. Run `pnpm install`.
3. Start:
   - `API Server`
   - `API Portal`
4. Verify:
   - server listens on `8080`
   - portal serves on `3000`
   - `/api/service/status` returns `200`

Full instructions live in [docs/INSTALL.md](/C:/Users/z6798/Documents/Codex/RT/docs/INSTALL.md).

## Docs

- [Docs Index](/C:/Users/z6798/Documents/Codex/RT/docs/INDEX.md)
- [Installation Guide](/C:/Users/z6798/Documents/Codex/RT/docs/INSTALL.md)
- [Model Discovery Prompt](/C:/Users/z6798/Documents/Codex/RT/docs/MODEL_PROBING_PROMPT.md)

## Workflow Source Of Truth

The preferred source of truth is the repository's `.replit-artifact/artifact.toml` files.

Do not manually create fallback workflows. If Replit does not show the artifact-generated workflows immediately, refresh and re-check the platform state first, then resolve duplicates in favor of the system-generated workflows.

## Native Endpoint Scope

- Recommended OpenAI-compatible entrypoint: `/api/v1`
- Claude native compatibility currently covers `POST /api/v1/messages`
- Gemini native compatibility currently covers:
  - `GET /api/v1beta/models`
  - `GET /api/v1beta/models/:model`
  - `POST /api/v1beta/models/:model:generateImages`

Native compatibility is intentionally partial. It supports the common flows this project needs, not a full provider-by-provider mirror.
