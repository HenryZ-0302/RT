# RT Replit Install Guide

Use this document when installing or re-initializing this repository in a Replit workspace.

## Goal

Set up the latest repository code as a clean two-service Replit project:

- `API Server`
- `API Portal`

## Quick Steps

1. Replace the current business files with the latest repository contents.
   - Keep Replit local configuration and platform-generated files unchanged.
   - Delete all other files and folders not included in the repository.
   - Delete all folders inside the existing `artifacts` directory before replacing them with repository contents.
2. Run `pnpm install`.
3. Use the repository's `.replit-artifact/artifact.toml` files as the primary source of truth for artifacts and workflows.
4. Register missing repository artifacts only through Replit's artifact registration flow when the platform exposes that flow.
5. Wait for Replit to auto-generate workflows from the repository `artifact.toml` `[[services]]` definitions, then refresh and check again before taking any further workflow action.
6. Start or restart the two system-generated workflows:
   - `API Server`
   - `API Portal`

## Workflow Rules

- Prefer artifact registration first, then let Replit auto-generate workflows from `[[services]]`.
- Do not manually create workflows with `configureWorkflow()` or any equivalent manual workflow creation step.
- If workflows do not appear immediately, re-check the platform state after artifact registration or workspace refresh instead of creating manual duplicates.
- If duplicate workflows already exist, stop and report them instead of creating any new workflow.
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
3. Confirm the frontend page opens successfully.
4. Ignore the known `/api/service/settings/compatibility` `500` log.

## Reporting Rules

- Do not use `rsync`.
- Report every issue immediately, including small issues, warnings, retries, temporary failures, and non-blocking problems.
- If an error occurs during setup, dependency installation, artifact registration, duplicate workflow detection, or workflow startup, stop immediately.
- Do not edit files to fix errors without approval.
- Report the exact error, explain the proposed fix, and wait for approval before making changes.

## Final Reply

After completion, reply in one short sentence saying whether setup succeeded and whether any problems occurred.
