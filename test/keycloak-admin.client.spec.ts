import { ConfigService } from "@nestjs/config";

import { KeycloakAdminClient } from "../src/keycloak/keycloak-admin.client";

function configFrom(map: Record<string, unknown>): ConfigService {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (key: string) => map[key] as any,
  } as ConfigService;
}

describe("KeycloakAdminClient", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("requests a password-grant token and caches it", async () => {
    const cfg = configFrom({
      KEYCLOAK_BASE_URL: "http://localhost:8080",
      KEYCLOAK_REALM: "platma",
      KEYCLOAK_TOKEN_GRANT_TYPE: "password",
      KEYCLOAK_TOKEN_REALM: "master",
      KEYCLOAK_CLIENT_ID: "admin-cli",
      KEYCLOAK_ADMIN_USERNAME: "admin",
      KEYCLOAK_ADMIN_PASSWORD: "admin",
      KEYCLOAK_HTTP_TIMEOUT_MS: 5000,
      KEYCLOAK_HTTP_RETRY_COUNT: 0,
    });

    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "t1", expires_in: 60 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = fetchMock;

    const client = new KeycloakAdminClient(cfg);
    const t1 = await client.getAccessToken();
    const t2 = await client.getAccessToken();

    expect(t1).toBe("t1");
    expect(t2).toBe("t1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, req] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/realms/master/protocol/openid-connect/token");
    expect(req.method).toBe("POST");
    expect(req.body).toContain("grant_type=password");
    expect(req.body).toContain("client_id=admin-cli");
    expect(req.body).toContain("username=admin");
    expect(req.body).toContain("password=admin");
  });

  it("requires client secret for client_credentials", async () => {
    const cfg = configFrom({
      KEYCLOAK_BASE_URL: "http://localhost:8080",
      KEYCLOAK_REALM: "platma",
      KEYCLOAK_TOKEN_GRANT_TYPE: "client_credentials",
      KEYCLOAK_CLIENT_ID: "platma-provisioner",
      KEYCLOAK_HTTP_TIMEOUT_MS: 5000,
      KEYCLOAK_HTTP_RETRY_COUNT: 0,
    });

    const client = new KeycloakAdminClient(cfg);
    await expect(client.getAccessToken()).rejects.toThrow(/KEYCLOAK_CLIENT_SECRET/);
  });
});
