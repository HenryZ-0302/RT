# RT Agent Notes

This file applies to the whole repository.

## Replit update/install workflow

When updating or installing this project from the `mask_min` branch:

1. Pull the latest repository code and fully replace business code in the current project.
2. Preserve Replit local/platform-generated files and directories. Do not overwrite or delete local environment-only configuration.
3. Do not use `rsync`. Use normal commands such as `cp`, `find`, and `rm` when copying or cleaning files.
4. Run `pnpm install` after the code is updated.
5. If a service directory already contains `artifact.toml`, rely on artifact-based service discovery. Do not manually register the same workflow again.
6. Only register a new artifact/service with Replit if the repository contains it and the platform has not already recognized it.
7. Restart these workflows after update/install:
   - `artifacts/api-server: API Server`
   - `artifacts/api-portal: web`

## Notes

- Old business code does not need to be preserved during sync.
- `/api/service/settings/compatibility` returning HTTP 500 in logs can be ignored during deployment/update checks.

## Expected final report

Reply in one sentence with:

- whether the update succeeded
- the latest commit hash
- whether both workflows restarted successfully
- any issues encountered during the process
