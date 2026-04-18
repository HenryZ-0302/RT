export interface Env {
  AUTH_TOKEN: string;
  ACCOUNT_COOLDOWN_MS?: string;
  ROUTER_STATE: DurableObjectNamespace;
}

type AccountRecord = {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  extraHeaders?: Record<string, string>;
  unhealthyUntil?: number;
};

type AccountInput = {
  id: string;
  label?: string;
  baseUrl: string;
  apiKey: string;
  enabled?: boolean;
  extraHeaders?: Record<string, string>;
};

const ACCOUNTS_KEY = "accounts";
const CURSOR_KEY = "cursor";

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function getBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function ensureAuthorized(request: Request, token: string): Response | null {
  if (!token || getBearer(request) !== token) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function sanitizeAccountInput(payload: AccountInput): AccountRecord {
  if (!payload.id?.trim()) throw new Error("Account id is required");
  if (!payload.baseUrl?.trim()) throw new Error("Account baseUrl is required");
  if (!payload.apiKey?.trim()) throw new Error("Account apiKey is required");
  return {
    id: payload.id.trim(),
    label: payload.label?.trim() || payload.id.trim(),
    baseUrl: normalizeBaseUrl(payload.baseUrl),
    apiKey: payload.apiKey.trim(),
    enabled: payload.enabled !== false,
    extraHeaders: payload.extraHeaders,
    unhealthyUntil: 0,
  };
}

function redactAccount(account: AccountRecord) {
  return {
    id: account.id,
    label: account.label,
    baseUrl: account.baseUrl,
    enabled: account.enabled,
    extraHeaders: account.extraHeaders ?? {},
    unhealthyUntil: account.unhealthyUntil ?? 0,
  };
}

async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/health") {
      return json({ ok: true });
    }
    const stub = env.ROUTER_STATE.getByName("router");
    return stub.fetch(request);
  },
};

export class RouterState extends DurableObject<Env> {
  private accountsCache: AccountRecord[] | null = null;

  private async getAccounts(): Promise<AccountRecord[]> {
    if (this.accountsCache) return this.accountsCache;
    const saved = await this.ctx.storage.get<AccountRecord[]>(ACCOUNTS_KEY);
    this.accountsCache = Array.isArray(saved) ? saved : [];
    return this.accountsCache;
  }

  private async saveAccounts(accounts: AccountRecord[]): Promise<void> {
    this.accountsCache = accounts;
    await this.ctx.storage.put(ACCOUNTS_KEY, accounts);
  }

  private async getCursor(): Promise<number> {
    return (await this.ctx.storage.get<number>(CURSOR_KEY)) ?? 0;
  }

  private async setCursor(value: number): Promise<void> {
    await this.ctx.storage.put(CURSOR_KEY, value);
  }

  private getCooldownMs(): number {
    return Number(this.env.ACCOUNT_COOLDOWN_MS || 30000);
  }

  private async markHealthy(id: string): Promise<void> {
    const accounts = await this.getAccounts();
    const target = accounts.find((item) => item.id === id);
    if (!target) return;
    target.unhealthyUntil = 0;
    await this.saveAccounts(accounts);
  }

  private async markUnhealthy(id: string): Promise<void> {
    const accounts = await this.getAccounts();
    const target = accounts.find((item) => item.id === id);
    if (!target) return;
    target.unhealthyUntil = Date.now() + this.getCooldownMs();
    await this.saveAccounts(accounts);
  }

  private async pickAccount(excluded: Set<string> = new Set()): Promise<AccountRecord | null> {
    const accounts = await this.getAccounts();
    const now = Date.now();
    const enabled = accounts.filter((item) => item.enabled && !excluded.has(item.id));
    const healthy = enabled.filter((item) => (item.unhealthyUntil ?? 0) <= now);
    const pool = healthy.length > 0 ? healthy : enabled;
    if (pool.length === 0) return null;

    const cursor = await this.getCursor();
    const account = pool[cursor % pool.length];
    await this.setCursor(cursor + 1);
    return account;
  }

  private buildUpstreamUrl(account: AccountRecord, requestUrl: URL): string {
    return `${account.baseUrl}${requestUrl.pathname}${requestUrl.search}`;
  }

  private async proxyRequest(request: Request): Promise<Response> {
    const authError = ensureAuthorized(request, this.env.AUTH_TOKEN);
    if (authError) return authError;

    const requestUrl = new URL(request.url);
    if (!requestUrl.pathname.startsWith("/v1/")) {
      return json({ error: "Only /v1/* routes are supported" }, { status: 404 });
    }

    const requestBody = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

    const excluded = new Set<string>();
    while (true) {
      const account = await this.pickAccount(excluded);
      if (!account) {
        return json({ error: "No available accounts" }, { status: 503 });
      }

      try {
        const headers = new Headers(request.headers);
        headers.set("authorization", `Bearer ${account.apiKey}`);
        headers.delete("host");
        if (account.extraHeaders) {
          for (const [key, value] of Object.entries(account.extraHeaders)) {
            headers.set(key, value);
          }
        }

        const upstream = await fetch(this.buildUpstreamUrl(account, requestUrl), {
          method: request.method,
          headers,
          body: requestBody,
          redirect: "manual",
        });

        if (upstream.status >= 500) {
          excluded.add(account.id);
          await this.markUnhealthy(account.id);
          if (excluded.size >= (await this.getAccounts()).filter((item) => item.enabled).length) {
            return this.withProxyHeaders(upstream, account.id);
          }
          continue;
        }

        await this.markHealthy(account.id);
        return this.withProxyHeaders(upstream, account.id);
      } catch (error) {
        excluded.add(account.id);
        await this.markUnhealthy(account.id);
        const enabledCount = (await this.getAccounts()).filter((item) => item.enabled).length;
        if (excluded.size >= enabledCount) {
          return json(
            {
              error: "All accounts failed",
              details: error instanceof Error ? error.message : String(error),
            },
            { status: 502 },
          );
        }
      }
    }
  }

  private withProxyHeaders(response: Response, accountId: string): Response {
    const headers = new Headers(response.headers);
    headers.set("x-router-account", accountId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private async handleAdmin(request: Request): Promise<Response> {
    const authError = ensureAuthorized(request, this.env.AUTH_TOKEN);
    if (authError) return authError;

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/admin/accounts" && request.method === "GET") {
      const accounts = await this.getAccounts();
      return json({ accounts: accounts.map(redactAccount) });
    }

    if (pathname === "/admin/accounts" && request.method === "POST") {
      const payload = sanitizeAccountInput(await readJsonBody<AccountInput>(request));
      const accounts = await this.getAccounts();
      const next = accounts.filter((item) => item.id !== payload.id);
      next.push(payload);
      await this.saveAccounts(next);
      return json({ ok: true, account: redactAccount(payload) }, { status: 201 });
    }

    const match = pathname.match(/^\/admin\/accounts\/([^/]+)$/);
    if (!match) return json({ error: "Not found" }, { status: 404 });

    const accountId = decodeURIComponent(match[1]);
    const accounts = await this.getAccounts();
    const target = accounts.find((item) => item.id === accountId);
    if (!target) return json({ error: "Account not found" }, { status: 404 });

    if (request.method === "DELETE") {
      await this.saveAccounts(accounts.filter((item) => item.id !== accountId));
      return json({ ok: true });
    }

    if (request.method === "PATCH") {
      const payload = await readJsonBody<Partial<AccountInput>>(request);
      if (typeof payload.label === "string") target.label = payload.label.trim() || target.label;
      if (typeof payload.baseUrl === "string" && payload.baseUrl.trim()) target.baseUrl = normalizeBaseUrl(payload.baseUrl);
      if (typeof payload.apiKey === "string" && payload.apiKey.trim()) target.apiKey = payload.apiKey.trim();
      if (typeof payload.enabled === "boolean") target.enabled = payload.enabled;
      if (payload.extraHeaders && typeof payload.extraHeaders === "object") {
        target.extraHeaders = payload.extraHeaders;
      }
      await this.saveAccounts(accounts);
      return json({ ok: true, account: redactAccount(target) });
    }

    return json({ error: "Method not allowed" }, { status: 405 });
  }

  override async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/admin/")) {
      try {
        return await this.handleAdmin(request);
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : "Bad request" },
          { status: 400 },
        );
      }
    }
    return this.proxyRequest(request);
  }
}
