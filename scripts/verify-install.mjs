import { existsSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();

const requiredPaths = [
  "AGENTS.md",
  "README.md",
  "docs/INDEX.md",
  "docs/INSTALL.md",
  "docs/MODEL_PROBING_PROMPT.md",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "version.json",
  "artifacts/api-server/package.json",
  "artifacts/api-server/.replit-artifact/artifact.toml",
  "artifacts/api-server/src/index.ts",
  "artifacts/api-portal/package.json",
  "artifacts/api-portal/.replit-artifact/artifact.toml",
  "artifacts/api-portal/src/App.tsx",
];

const unexpectedArtifactDirs = [
  "artifacts/server",
  "artifacts/web",
  "artifacts/api",
  "artifacts/portal",
];

const missing = requiredPaths.filter((path) => !existsSync(join(root, path)));
const unexpected = unexpectedArtifactDirs.filter((path) => existsSync(join(root, path)));

if (missing.length === 0 && unexpected.length === 0) {
  console.log("Install checklist passed.");
  exit(0);
}

if (missing.length > 0) {
  console.error("Missing required repository paths:");
  for (const path of missing) console.error(`- ${path}`);
}

if (unexpected.length > 0) {
  console.error("Unexpected legacy artifact directories:");
  for (const path of unexpected) console.error(`- ${path}`);
}

exit(1);
