export const SERVICE_STORAGE_KEY = "service_access_key";
export const SERVICE_KEY_ENV = "SERVICE_ACCESS_KEY";
export const NODE_HEALTHCHECK_MODEL_KEY = "node_healthcheck_model";

export function getStoredServiceKey(): string {
  return localStorage.getItem(SERVICE_STORAGE_KEY) ?? "";
}

export function storeServiceKey(value: string): void {
  localStorage.setItem(SERVICE_STORAGE_KEY, value);
}

export function getStoredNodeHealthcheckModel(): string {
  return localStorage.getItem(NODE_HEALTHCHECK_MODEL_KEY) ?? "gpt-4o-mini";
}

export function storeNodeHealthcheckModel(value: string): void {
  localStorage.setItem(NODE_HEALTHCHECK_MODEL_KEY, value.trim());
}

function serviceBase(baseUrl: string): string {
  return `${baseUrl}/api/service`;
}

export const servicePaths = {
  status(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/status`;
  },
  healthcheck(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/healthcheck`;
  },
  bootstrap(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/bootstrap`;
  },
  metrics(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/metrics`;
  },
  logs(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/logs`;
  },
  logsStream(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/logs/stream`;
  },
  backends(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/backends`;
  },
  backend(baseUrl: string, label: string): string {
    return `${serviceBase(baseUrl)}/backends/${label}`;
  },
  routing(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/routing`;
  },
  models(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/models`;
  },
  compatibility(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/settings/compatibility`;
  },
  release(baseUrl: string): string {
    return `${serviceBase(baseUrl)}/release`;
  },
};
