import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type KeycloakTokenResponse = {
  access_token: string;
  expires_in?: number;
};

export class KeycloakHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTrailingSlashRemoved(url: string): string {
  return url.replace(/\/+$/g, "");
}

function joinUrl(baseUrl: string, path: string): string {
  return `${withTrailingSlashRemoved(baseUrl)}${path.startsWith("/") ? "" : "/"}${path}`;
}

@Injectable()
export class KeycloakAdminClient {
  private tokenCache?: { accessToken: string; expiresAtMs: number };

  constructor(private readonly config: ConfigService) {}

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAtMs > now + 10_000) {
      return this.tokenCache.accessToken;
    }

    const baseUrl = this.config.get<string>("KEYCLOAK_BASE_URL")!;
    const grantType = this.config.get<string>("KEYCLOAK_TOKEN_GRANT_TYPE") ?? "password";

    const realm =
      this.config.get<string>("KEYCLOAK_TOKEN_REALM") ??
      (grantType === "client_credentials"
        ? (this.config.get<string>("KEYCLOAK_REALM") ?? "master")
        : "master");

    const tokenUrl = joinUrl(
      baseUrl,
      `/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`,
    );

    const params = new URLSearchParams();
    params.set("grant_type", grantType);

    const clientId = this.config.get<string>("KEYCLOAK_CLIENT_ID")!;
    params.set("client_id", clientId);

    if (grantType === "password") {
      const username = this.config.get<string>("KEYCLOAK_ADMIN_USERNAME")!;
      const password = this.config.get<string>("KEYCLOAK_ADMIN_PASSWORD")!;
      params.set("username", username);
      params.set("password", password);
    } else {
      const clientSecret = this.config.get<string>("KEYCLOAK_CLIENT_SECRET");
      if (!clientSecret) {
        throw new Error("KEYCLOAK_CLIENT_SECRET is required for client_credentials grant");
      }
      params.set("client_secret", clientSecret);
    }

    const timeoutMs = this.config.get<number>("KEYCLOAK_HTTP_TIMEOUT_MS") ?? 5000;
    const retryCount = this.config.get<number>("KEYCLOAK_HTTP_RETRY_COUNT") ?? 0;

    const res = await this.fetchJson<KeycloakTokenResponse>({
      method: "POST",
      url: tokenUrl,
      body: params.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      timeoutMs,
      retryCount,
    });

    const accessToken = res.access_token;
    const expiresInSec = res.expires_in ?? 60;
    this.tokenCache = {
      accessToken,
      expiresAtMs: now + expiresInSec * 1000,
    };

    return accessToken;
  }

  async getAdmin<T>(path: string): Promise<T> {
    return this.requestAdmin<T>("GET", path);
  }

  async postAdmin<T>(path: string, body?: unknown): Promise<{ data?: T; location?: string }> {
    return this.requestAdminWithLocation<T>("POST", path, body);
  }

  async putAdmin<T>(path: string, body?: unknown): Promise<T> {
    return this.requestAdmin<T>("PUT", path, body);
  }

  private async requestAdmin<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { data } = await this.requestAdminWithLocation<T>(method, path, body);
    return data as T;
  }

  private async requestAdminWithLocation<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data?: T; location?: string }> {
    const baseUrl = this.config.get<string>("KEYCLOAK_BASE_URL")!;
    const realm = this.config.get<string>("KEYCLOAK_REALM")!;
    const url = joinUrl(baseUrl, `/admin/realms/${encodeURIComponent(realm)}${path}`);

    const timeoutMs = this.config.get<number>("KEYCLOAK_HTTP_TIMEOUT_MS") ?? 5000;
    const retryCount = this.config.get<number>("KEYCLOAK_HTTP_RETRY_COUNT") ?? 0;
    const accessToken = await this.getAccessToken();

    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    };

    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const res = await this.fetchRaw({
      method,
      url,
      headers,
      body: payload,
      timeoutMs,
      retryCount,
    });

    const location = res.headers.get("location") ?? undefined;
    if (res.status === 204) return { location };

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return { location };

    const data = (await res.json()) as T;
    return { data, location };
  }

  private async fetchJson<T>(opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    retryCount: number;
  }): Promise<T> {
    const res = await this.fetchRaw(opts);
    return (await res.json()) as T;
  }

  private async fetchRaw(opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    retryCount: number;
  }): Promise<Response> {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= opts.retryCount; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

      try {
        const res = await fetch(opts.url, {
          method: opts.method,
          headers: opts.headers,
          body: opts.body,
          signal: controller.signal,
        });

        if (res.ok) return res;

        if (res.status >= 500 || res.status === 429) {
          lastErr = new KeycloakHttpError(`Keycloak HTTP ${res.status}`, res.status);
        } else {
          let details: unknown;
          try {
            details = await res.json();
          } catch {
            details = await res.text().catch(() => undefined);
          }
          throw new KeycloakHttpError(`Keycloak HTTP ${res.status}`, res.status, details);
        }
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < opts.retryCount) {
        await sleep(150 * (attempt + 1));
      }
    }

    throw lastErr;
  }
}
