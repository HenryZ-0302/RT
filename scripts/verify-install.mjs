import { existsSync, readFileSync } from "node:fs";
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
const failures = [];

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function extractStringValue(toml, key) {
  const match = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1] ?? null;
}

function extractNumberValue(toml, key) {
  const match = toml.match(new RegExp(`^${key}\\s*=\\s*(\\d+)`, "m"));
  return match ? Number(match[1]) : null;
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(label, text, expected) {
  if (!text.includes(expected)) {
    failures.push(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

if (!missing.includes("artifacts/api-server/.replit-artifact/artifact.toml")) {
  const serverToml = readText("artifacts/api-server/.replit-artifact/artifact.toml");
  assertEqual("API Server artifact kind", extractStringValue(serverToml, "kind"), "api");
  assertEqual("API Server artifact title", extractStringValue(serverToml, "title"), "API Server");
  assertIncludes("API Server service name", serverToml, 'name = "API Server"');
  assertEqual("API Server local port", extractNumberValue(serverToml, "localPort"), 8080);
  assertEqual("API Server startup health path", extractStringValue(serverToml, "path"), "/api/healthz");
  assertIncludes("API Server production PORT", serverToml, 'PORT = "8080"');
}

if (!missing.includes("artifacts/api-portal/.replit-artifact/artifact.toml")) {
  const portalToml = readText("artifacts/api-portal/.replit-artifact/artifact.toml");
  assertEqual("API Portal artifact kind", extractStringValue(portalToml, "kind"), "web");
  assertEqual("API Portal artifact title", extractStringValue(portalToml, "title"), "API Portal");
  assertIncludes("API Portal service name", portalToml, 'name = "API Portal"');
  assertEqual("API Portal local port", extractNumberValue(portalToml, "localPort"), 3000);
  assertIncludes("API Portal PORT env", portalToml, 'PORT = "3000"');
  assertIncludes("API Portal BASE_PATH env", portalToml, 'BASE_PATH = "/"');
  assertIncludes("API Portal static public dir", portalToml, 'publicDir = "artifacts/api-portal/dist/public"');
}

if (missing.length === 0 && unexpected.length === 0 && failures.length === 0) {
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

if (failures.length > 0) {
  console.error("Artifact contract check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
}

exit(1);
