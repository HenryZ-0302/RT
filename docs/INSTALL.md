# RT Replit Install Guide

Use this document when installing, updating, or re-initializing this repository in a Replit workspace.

## Goal

Set up the latest repository code as a clean two-service Replit project:

- `API Server`
- `API Portal`

The same workflow waiting and artifact rules apply both to first-time installs and later repository updates.

## Quick Steps

1. Replace the current business files with the latest repository contents.
   - Keep Replit local configuration and platform-generated files unchanged.
   - Delete all other files and folders not included in the repository.
   - Delete all folders inside the existing `artifacts` directory before replacing them with repository contents.
2. Run `pnpm install`.
3. Use the repository's `.replit-artifact/artifact.toml` files as the primary source of truth for artifacts and workflows.
4. Register missing repository artifacts only through Replit's artifact registration flow when the platform exposes that flow.
5. After copying the repository files and running `pnpm install`, wait for Replit to auto-scan the repository `.replit-artifact/artifact.toml` files and auto-generate workflows from the `[[services]]` definitions.
6. Poll the platform state before doing anything workflow-related:
   - re-check every 5 seconds
   - wait up to 90 seconds total
   - do not manually create fallback workflows during this wait window
7. If the two artifact-backed workflows appear within that 90 second window, use those system-generated workflows directly.
8. If the workflows still do not appear after 90 seconds, stop and report the exact state to the user instead of creating manual duplicates.
9. If duplicate workflows already exist because system workflows appeared after an earlier manual attempt, keep the system-generated workflows and remove the manual duplicates.
10. Start or restart the two system-generated workflows:
   - `API Server`
   - `API Portal`

## Workflow Rules

- Prefer artifact registration first, then let Replit auto-generate workflows from `[[services]]`.
- Do not manually create workflows with `configureWorkflow()` or any equivalent manual workflow creation step.
- Treat artifact auto-registration as asynchronous. A missing workflow immediately after file sync does not mean registration failed.
- If workflows do not appear immediately, keep polling and refreshing the platform state instead of creating manual duplicates.
- If duplicate workflows already exist, resolve them in favor of the system-generated workflows from repository artifacts.
- Do not manually copy or invent placeholder artifact IDs.
- If a separate long-running helper task is needed during setup, use one clearly named temporary workflow, remove it immediately after the task finishes, and mention that cleanup in the final report.

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
