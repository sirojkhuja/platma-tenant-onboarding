import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";

import { AppModule } from "../src/app.module";
import { KeycloakProvisioningService } from "../src/keycloak/keycloak.service";
import { TenantStatus } from "../src/tenants/tenant-status";
import { TenantsRepository } from "../src/tenants/tenants.repository";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand() {
  return Math.random().toString(16).slice(2, 10);
}

async function waitForPostgresReady() {
  const host = process.env.DATABASE_HOST || "127.0.0.1";
  const port = Number(process.env.DATABASE_PORT || 5432);
  const user = process.env.DATABASE_USERNAME || "platma";
  const password = process.env.DATABASE_PASSWORD || "platma";
  const database = process.env.DATABASE_NAME || "platma";

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const pool = new Pool({ host, port, user, password, database, max: 1 });
    try {
      await pool.query("select 1");
      await pool.end();
      return;
    } catch {
      try {
        await pool.end();
      } catch {
        // ignore
      }
      await sleep(1000);
    }
  }

  throw new Error("Postgres did not become ready. Run: docker-compose up -d");
}

async function waitForKeycloakReady() {
  const baseUrl = process.env.KEYCLOAK_BASE_URL || "http://127.0.0.1:8080";
  const tokenRealm = process.env.KEYCLOAK_TOKEN_REALM || "master";
  const clientId = process.env.KEYCLOAK_CLIENT_ID || "admin-cli";
  const username = process.env.KEYCLOAK_ADMIN_USERNAME || "admin";
  const password = process.env.KEYCLOAK_ADMIN_PASSWORD || "admin";

  const tokenUrl = `${baseUrl.replace(/\/+$/g, "")}/realms/${encodeURIComponent(
    tokenRealm,
  )}/protocol/openid-connect/token`;

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const body = new URLSearchParams({
        grant_type: "password",
        client_id: clientId,
        username,
        password,
      }).toString();

      const res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });

      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(1000);
  }

  throw new Error("Keycloak did not become ready. Run: docker-compose up -d");
}

// Integration tests require docker-compose dependencies.
// Run: docker-compose up -d
// Then: npm run test:integration
describe("tenants lifecycle (integration)", () => {
  let app: NestFastifyApplication;
  let repo: TenantsRepository;
  let keycloak: KeycloakProvisioningService;

  beforeAll(async () => {
    // Force Postgres usage in tests (DatabaseModule defaults to SQL.js for NODE_ENV=test).
    process.env.DATABASE_DRIVER = "postgres";

    process.env.DATABASE_HOST ||= "127.0.0.1";
    process.env.DATABASE_PORT ||= "5432";
    process.env.DATABASE_USERNAME ||= "platma";
    process.env.DATABASE_PASSWORD ||= "platma";
    process.env.DATABASE_NAME ||= "platma";

    process.env.KEYCLOAK_BASE_URL ||= "http://127.0.0.1:8080";
    process.env.KEYCLOAK_REALM ||= "platma";
    process.env.KEYCLOAK_TOKEN_GRANT_TYPE ||= "password";
    process.env.KEYCLOAK_TOKEN_REALM ||= "master";
    process.env.KEYCLOAK_CLIENT_ID ||= "admin-cli";
    process.env.KEYCLOAK_ADMIN_USERNAME ||= "admin";
    process.env.KEYCLOAK_ADMIN_PASSWORD ||= "admin";
    process.env.KEYCLOAK_HTTP_TIMEOUT_MS ||= "15000";
    process.env.KEYCLOAK_HTTP_RETRY_COUNT ||= "2";
    process.env.K8S_DEPLOY_MODE ||= "manifest";
    process.env.NODE_RED_PASSWORD_SEED ||= "dev-only-change-me-node-red-password-seed";

    await waitForPostgresReady();
    await waitForKeycloakReady();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();

    repo = app.get(TenantsRepository);
    keycloak = app.get(KeycloakProvisioningService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("create -> verify -> delete", async () => {
    const suffix = rand();
    const tenantName = `Acme Corp ${suffix}`;
    const adminEmail = `admin+${suffix}@acme.test`;

    const createRes = await app.inject({
      method: "POST",
      url: "/tenants",
      payload: { tenantName, adminEmail },
    });
    expect(createRes.statusCode).toBe(201);

    const created = createRes.json() as any;
    const tenantId = created.id as string;
    const clientId = created.keycloak.clientId as string;

    expect(created.manifests?.createYaml).toContain("kind: Deployment");
    expect(created.manifests?.createYaml).toContain("kind: PersistentVolumeClaim");
    expect(created.nodeRed?.deploymentMode).toBe("manifest");
    expect(created.nodeRed?.adminPassword).toBeTruthy();

    const row = await repo.findById(tenantId);
    expect(row?.status).toBe(TenantStatus.ACTIVE);
    expect(row?.nodeRedServiceName).toBe(created.nodeRed.serviceName);

    const client = await keycloak.findClientByClientId(clientId);
    expect(client).not.toBeNull();
    expect(client?.enabled).toBe(true);

    const user = await keycloak.findUserByUsername(adminEmail);
    expect(user).not.toBeNull();
    expect(user?.enabled).toBe(true);

    const deleteRes = await app.inject({ method: "DELETE", url: `/tenants/${tenantId}` });
    expect(deleteRes.statusCode).toBe(200);

    const deleted = deleteRes.json() as any;
    expect(deleted.status).toBe("INACTIVE");
    expect(deleted.manifests?.deleteYaml).toContain("kind: Service");
    expect(deleted.nodeRed?.deploymentMode).toBe("manifest");

    const row2 = await repo.findById(tenantId);
    expect(row2?.status).toBe(TenantStatus.INACTIVE);

    const client2 = await keycloak.findClientByClientId(clientId);
    expect(client2?.enabled).toBe(false);
  });
});
