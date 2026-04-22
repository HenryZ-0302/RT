import { servicePaths } from "./service";

export interface PortalVersionInfo {
  version: string;
  name?: string;
  releaseDate?: string;
  releaseNotes?: string;
  hasUpdate?: boolean;
  latestVersion?: string;
  latestReleaseDate?: string;
  latestReleaseNotes?: string;
  checkError?: string;
  source?: string;
  upstreamRepoUrl?: string;
}

export const FALLBACK_VERSION_INFO: PortalVersionInfo = {
  version: "1.2.6",
  name: "Unified Service Layer",
  releaseDate: "2026-04-21",
  releaseNotes:
    "v1.2.6：删除未使用的 /api/service/healthcheck/history 健康历史接口，精简服务端对应历史存储逻辑；移除旧版 service key 与更新地址兼容键名，统一只保留 SERVICE_ACCESS_KEY、SERVICE_UPDATE_URL 和 service_access_key，减少自用部署与多账号初始化时的兼容分支。",
};

export function mergePortalVersionInfo(
  data: Partial<PortalVersionInfo> | null | undefined,
): PortalVersionInfo {
  return {
    version: data?.version ?? FALLBACK_VERSION_INFO.version,
    name: data?.name ?? FALLBACK_VERSION_INFO.name,
    releaseDate: data?.releaseDate ?? FALLBACK_VERSION_INFO.releaseDate,
    releaseNotes: data?.releaseNotes ?? FALLBACK_VERSION_INFO.releaseNotes,
    hasUpdate: data?.hasUpdate,
    latestVersion: data?.latestVersion,
    latestReleaseDate: data?.latestReleaseDate,
    latestReleaseNotes: data?.latestReleaseNotes,
    checkError: data?.checkError,
    source: data?.source,
    upstreamRepoUrl: data?.upstreamRepoUrl,
  };
}

export async function fetchPortalVersionInfo(baseUrl: string): Promise<PortalVersionInfo> {
  const response = await fetch(servicePaths.release(baseUrl), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load version info: HTTP ${response.status}`);
  }

  const data = await response.json() as Partial<PortalVersionInfo>;
  return mergePortalVersionInfo(data);
}
