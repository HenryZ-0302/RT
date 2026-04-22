const DEFAULT_GITHUB_OWNER = "HenryZ-0302";
const DEFAULT_GITHUB_REPO = "RT";
const DEFAULT_GITHUB_BRANCH = "mask";

export const SERVICE_ACCESS_KEY_ENV = "SERVICE_ACCESS_KEY";
export const LEGACY_ACCESS_KEY_ENV = "PROXY_API_KEY";
export const SERVICE_UPDATE_URL_ENV = "SERVICE_UPDATE_URL";
export const LEGACY_UPDATE_URL_ENV = "UPDATE_CHECK_URL";

export function getServiceAccessKey(): string | undefined {
  return process.env[SERVICE_ACCESS_KEY_ENV] || process.env[LEGACY_ACCESS_KEY_ENV];
}

export function getServiceUpdateUrl(): string | undefined {
  return process.env[SERVICE_UPDATE_URL_ENV] || process.env[LEGACY_UPDATE_URL_ENV];
}

export function getConfiguredUpstreamRepo(): string | undefined {
  return process.env.SERVICE_UPSTREAM_REPO?.trim() || undefined;
}

type RepoConfig = {
  owner: string;
  repo: string;
  branch: string;
  explicitlyConfigured: boolean;
};

function parseRepoSpec(spec: string): { owner: string; repo: string } | null {
  const trimmed = spec.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  const githubMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (githubMatch) {
    return { owner: githubMatch[1], repo: githubMatch[2] };
  }

  const parts = trimmed.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] };
  }

  return null;
}

export function getUpstreamRepoConfig(): RepoConfig {
  const configuredRepo = getConfiguredUpstreamRepo();
  const branch = process.env.SERVICE_UPSTREAM_BRANCH?.trim() || DEFAULT_GITHUB_BRANCH;
  const parsed = configuredRepo ? parseRepoSpec(configuredRepo) : null;

  if (parsed) {
    return {
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      explicitlyConfigured: true,
    };
  }

  return {
    owner: DEFAULT_GITHUB_OWNER,
    repo: DEFAULT_GITHUB_REPO,
    branch,
    explicitlyConfigured: false,
  };
}

export function getUpstreamRepoUrl(): string {
  const { owner, repo } = getUpstreamRepoConfig();
  return `https://github.com/${owner}/${repo}`;
}

export function getUpstreamRawVersionUrl(): string {
  const { owner, repo, branch } = getUpstreamRepoConfig();
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/version.json`;
}
