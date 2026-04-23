import { Router, type IRouter, type Request, type Response } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, statSync, mkdirSync,
} from "fs";
import { resolve, join, dirname, relative } from "path";
import {
  getServiceUpdateUrl,
  getUpstreamRawVersionUrl,
  getUpstreamRepoConfig,
  getUpstreamRepoUrl,
} from "../lib/serviceConfig";
import { ensureApiKey } from "../middleware/auth";
import { readLocalVersionInfo, type ServiceVersionInfo } from "../lib/version";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);

const WORKSPACE_ROOT = resolve(process.cwd(), "../../");

export function safeVersionHeader(version: string): string {
  return version.replace(/[^\x00-\x7F]/g, "");
}

function getGitHubApiBase(): string {
  const { owner, repo } = getUpstreamRepoConfig();
  return `https://api.github.com/repos/${owner}/${repo}`;
}

function githubHeaders(withToken = true): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Unified-Service-Layer-Updater",
  };
  const token = process.env.GITHUB_TOKEN;
  if (withToken && token) headers.Authorization = `token ${token}`;
  return headers;
}

function sendUpdateError(
  res: Response,
  status: number,
  message: string,
  type: "server_error" | "invalid_request_error" | "conflict_error" = "server_error",
): void {
  res.status(status).json({ error: { message, type } });
}

function parseVersion(version: string): { nums: number[]; pre: string } {
  const clean = version.replace(/^v/i, "").trim();
  const match = clean.match(/^([\d]+(?:\.[\d]+)*)(.*)$/);
  if (!match) return { nums: [0], pre: "" };
  return {
    nums: match[1].split(".").map((part) => parseInt(part, 10) || 0),
    pre: match[2].trim(),
  };
}

function isNewer(remote: string, local: string): boolean {
  const remoteVersion = parseVersion(remote);
  const localVersion = parseVersion(local);
  const length = Math.max(remoteVersion.nums.length, localVersion.nums.length);

  for (let index = 0; index < length; index++) {
    const remotePart = remoteVersion.nums[index] ?? 0;
    const localPart = localVersion.nums[index] ?? 0;
    if (remotePart > localPart) return true;
    if (remotePart < localPart) return false;
  }

  if (!remoteVersion.pre && localVersion.pre) return true;
  if (remoteVersion.pre && !localVersion.pre) return false;
  if (remoteVersion.pre && localVersion.pre) return remoteVersion.pre > localVersion.pre;
  return false;
}

function checkApiKey(req: Request, res: Response): boolean {
  return ensureApiKey(req, res);
}

const BUNDLE_INCLUDE_DIRS = [
  "artifacts/api-server/src",
  "docs",
  "artifacts/api-portal/src",
  "artifacts/api-portal/public",
];

const BUNDLE_INCLUDE_FILES = [
  "version.json",
  "artifacts/api-portal/index.html",
  "artifacts/api-server/.replit-artifact/artifact.toml",
  "artifacts/api-portal/.replit-artifact/artifact.toml",
  "artifacts/api-server/build.mjs",
  "artifacts/api-portal/package.json",
  "artifacts/api-portal/tsconfig.json",
  "artifacts/api-portal/vite.config.ts",
  "artifacts/api-server/package.json",
  "artifacts/api-server/tsconfig.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "README.md",
  "AGENTS.md",
];

const BUNDLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".html", ".md", ".yaml", ".yml", ".svg"]);
const BUNDLE_EXCLUDE = new Set(["node_modules", "dist", ".git", ".cache"]);

function scanDir(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(dir)) return files;

  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (BUNDLE_EXCLUDE.has(entry)) continue;
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const ext = entry.slice(entry.lastIndexOf("."));
      if (!BUNDLE_EXTENSIONS.has(ext)) continue;

      const relPath = relative(WORKSPACE_ROOT, fullPath);
      try {
        files[relPath] = readFileSync(fullPath, "utf8");
      } catch {}
    }
  };

  walk(dir);
  return files;
}

function buildBundle(): Record<string, string> {
  const files: Record<string, string> = {};

  for (const dir of BUNDLE_INCLUDE_DIRS) {
    Object.assign(files, scanDir(join(WORKSPACE_ROOT, dir)));
  }

  for (const relPath of BUNDLE_INCLUDE_FILES) {
    const fullPath = join(WORKSPACE_ROOT, relPath);
    try {
      if (existsSync(fullPath)) files[relPath] = readFileSync(fullPath, "utf8");
    } catch {}
  }

  return files;
}

async function applyFromGitHub(): Promise<{ written: number }> {
  const { branch } = getUpstreamRepoConfig();
  const githubApiBase = getGitHubApiBase();

  const treeRes = await fetch(`${githubApiBase}/git/trees/${branch}?recursive=1`, {
    headers: githubHeaders(),
  });
  if (!treeRes.ok) throw new Error(`Failed to fetch upstream tree: HTTP ${treeRes.status}`);

  const treeData = await treeRes.json() as {
    tree: { path: string; type: string }[];
  };

  const bundleFiles = new Set(BUNDLE_INCLUDE_FILES);
  const filesToFetch = treeData.tree.filter((item) => {
    if (item.type !== "blob") return false;
    if (bundleFiles.has(item.path)) return true;
    return BUNDLE_INCLUDE_DIRS.some((dir) => item.path.startsWith(`${dir}/`));
  });

  let written = 0;

  for (const file of filesToFetch) {
    try {
      const response = await fetch(`${githubApiBase}/contents/${file.path}?ref=${branch}`, {
        headers: githubHeaders(),
      });
      if (!response.ok) {
        console.warn(`[update] skip ${file.path}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json() as { content: string };
      const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
      const fullPath = join(WORKSPACE_ROOT, file.path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, "utf8");
      written++;
    } catch (error) {
      console.warn(`[update] write failed ${file.path}:`, error);
    }
  }

  return { written };
}

function isGitHubCheckUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes("raw.githubusercontent.com") || url.includes("github.com");
}

function deriveBundleUrl(checkUrl: string): string {
  if (checkUrl.endsWith("/service/release")) {
    return checkUrl.replace(/\/service\/release$/, "/service/release/bundle");
  }
  if (checkUrl.endsWith("/update/version")) {
    return checkUrl.replace(/\/update\/version$/, "/update/bundle");
  }
  return checkUrl;
}

function getUpstreamRepoUrlForUi(): string | undefined {
  return getUpstreamRepoUrl();
}

async function sendVersion(_req: Request, res: Response) {
  const local = readLocalVersionInfo();
  const checkUrl = getServiceUpdateUrl() || getUpstreamRawVersionUrl();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(checkUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const remote = await response.json() as ServiceVersionInfo;
    res.json({
      ...local,
      hasUpdate: isNewer(remote.version, local.version),
      latestVersion: remote.version,
      latestReleaseNotes: remote.releaseNotes,
      latestReleaseDate: remote.releaseDate,
      source: isGitHubCheckUrl(checkUrl) ? "github" : "service",
      upstreamRepoUrl: getUpstreamRepoUrlForUi(),
    });
  } catch (error) {
    res.json({
      ...local,
      hasUpdate: false,
      checkError: error instanceof Error ? error.message : "check failed",
      upstreamRepoUrl: getUpstreamRepoUrlForUi(),
    });
  }
}

function sendBundle(_req: Request, res: Response) {
  try {
    const local = readLocalVersionInfo();
    const files = buildBundle();
    res.json({
      version: local.version,
      releaseNotes: local.releaseNotes,
      fileCount: Object.keys(files).length,
      files,
    });
  } catch (error) {
    sendUpdateError(res, 500, error instanceof Error ? error.message : "bundle failed", "server_error");
  }
}

let updateInProgress = false;

async function applyUpdate(req: Request, res: Response) {
  if (!checkApiKey(req, res)) return;
  if (updateInProgress) {
    sendUpdateError(res, 409, "Update already in progress, please wait", "conflict_error");
    return;
  }

  const checkUrl = getServiceUpdateUrl();
  const useGitHub = !checkUrl || isGitHubCheckUrl(checkUrl) || process.env.GITHUB_APPLY === "true";

  res.json({
    status: "started",
    source: useGitHub ? "github" : "service",
    message: useGitHub
      ? "Syncing the latest code from the configured upstream source. The service will restart automatically in ~30-60s."
      : "Downloading the update bundle from the configured upstream service. The service will restart automatically in ~30s.",
  });
  updateInProgress = true;

  void (async () => {
    try {
      if (useGitHub) {
        const { written } = await applyFromGitHub();
        console.log(`[update] wrote ${written} files from upstream GitHub source`);
      } else if (checkUrl) {
        const bundleUrl = deriveBundleUrl(checkUrl);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(bundleUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`Download failed HTTP ${response.status}`);

        const bundle = await response.json() as { files: Record<string, string> };
        for (const [relPath, content] of Object.entries(bundle.files)) {
          const fullPath = join(WORKSPACE_ROOT, relPath);
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, content, "utf8");
        }
        console.log(`[update] wrote ${Object.keys(bundle.files).length} files from upstream service bundle`);
      }

      await execFileAsync("pnpm", ["install", "--no-frozen-lockfile"], { cwd: WORKSPACE_ROOT });
      setTimeout(() => process.exit(0), 500);
    } catch (error) {
      updateInProgress = false;
      console.error("[update] update failed:", error instanceof Error ? error.message : error);
    }
  })();
}

function sendUpdateStatus(_req: Request, res: Response) {
  res.json({
    inProgress: updateInProgress,
    upstreamRepoUrl: getUpstreamRepoUrlForUi(),
    upstreamVersionUrl: getServiceUpdateUrl() || getUpstreamRawVersionUrl(),
  });
}

router.get("/service/release", sendVersion);
router.get("/service/release/bundle", sendBundle);
router.post("/service/release/apply", applyUpdate);
router.get("/service/release/status", sendUpdateStatus);

export default router;
