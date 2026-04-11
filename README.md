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
