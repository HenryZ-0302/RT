# RT Replit Install Guide

Use this document when installing, updating, or re-initializing this repository in a Replit workspace.

## Goal

Set up the latest repository code as a clean two-service Replit project:

- `API Server`
- `API Portal`

Use the same flow for first-time installs and later repository updates.

## Quick Steps

1. Overlay the latest repository contents onto the workspace.
   - Keep Replit local configuration and platform-generated files unchanged.
   - Do not delete existing artifact service directories before copying files. Keep `artifacts/api-server` and `artifacts/api-portal` present so Replit does not lose their artifact registrations.
   - After copying, remove only unrelated files or folders that are clearly not in the repository and are not Replit local/platform files.
2. Run `pnpm install`.
3. Run `pnpm run verify:install` to confirm the repository-level install checklist before workflow startup.
4. Treat the checked-in `.replit-artifact/artifact.toml` files as the source of truth for artifact type, service names, commands, paths, and ports.
5. Trigger Replit artifact recognition by opening/refreshing the preview or refreshing the workspace UI once after files are in place.
6. If either artifact is still missing after refresh, create/register the missing artifact through Replit's artifact flow using the checked-in `artifact.toml` values.
   - Use the existing artifact kind, title, service name, command, path, and port from `artifact.toml`.
   - Do not create a generic manual workflow.
   - Do not use `configureWorkflow()` or invent replacement workflow commands.
7. Start or restart the two artifact-backed workflows:
   - `API Server`
   - `API Portal`

## Workflow Rules

- Do not delete `artifacts/api-server` or `artifacts/api-portal` as a setup step; direct overlay is safer than delete-and-recreate.
- If Replit does not auto-recognize an artifact after refresh, create/register the missing artifact from the repository `artifact.toml`.
- Do not manually create standalone workflows with `configureWorkflow()` or equivalent commands.
- If duplicate workflows already exist, keep the artifact-backed workflows and report/remove the manual duplicates.
- Do not manually copy or invent placeholder artifact IDs.

## Expected Ports

- `API Server`: `8080`
- `API Portal`: `3000`

## Validation

After installation:

1. Confirm the API server starts and logs:
   - `Server listening`
   - `port: 8080`
2. Confirm `/api/service/status` returns `200`.
3. Confirm `/api/healthz` returns `200`.
4. Confirm the frontend page opens successfully.
5. Ignore the known `/api/service/settings/compatibility` `500` log.

## Reporting Rules

- Do not use `rsync`.
- Conduct the entire installation process in Chinese, including progress updates, error reports, and the final reply.
- Stop and wait for approval on blocking issues: `pnpm install` failure, artifact registration failure, duplicate workflow uncertainty, port conflict, build failure, or workflow startup failure.
- Do not stop on non-blocking warnings: deprecation warnings, bundle-size warnings, transient retries that recover, or the known `/api/service/settings/compatibility` `500` log. Summarize these in the final report instead.
- Do not edit files to fix errors without approval.
- Report the exact error, explain the proposed fix, and wait for approval before making changes.

## Final Reply

After completion, reply in one short Chinese sentence saying whether setup succeeded and whether any problems occurred.
