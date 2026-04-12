# Unified Service Layer

This branch keeps the project in a minimal workspace layout while preserving the two runnable apps under `artifacts/`:

- `artifacts/api-server`
- `artifacts/api-portal`

The root files in this branch are intentionally reduced to the minimum set needed for workspace installs, TypeScript config inheritance, version metadata, and basic project onboarding.

## Included Root Files

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `tsconfig.json`
- `version.json`

## Notes

- The server exposes compatibility and management routes from `artifacts/api-server`.
- The portal UI is served from `artifacts/api-portal`.
- `version.json` is required by both the server and portal for version display and update metadata.

## Native Endpoint Scope

- OpenAI-compatible endpoints remain the primary integration surface: `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/images/generations`.
- Claude native compatibility currently covers `POST /v1/messages` only.
- Gemini native compatibility currently covers `GET /v1beta/models`, `GET /v1beta/models/:model`, and `POST /v1beta/models/:model:generateImages`.
- Native compatibility in this project is intentionally partial. It supports common request formats and selected endpoints, but it is not a full provider-by-provider API mirror.
