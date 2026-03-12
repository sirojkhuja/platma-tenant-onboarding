import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module";
import { KeycloakProvisioningService } from "../src/keycloak/keycloak.service";
import { TenantStatus } from "../src/tenants/tenant-status";
import { TenantsRepository } from "../src/tenants/tenants.repository";

describe("tenants lifecycle (e2e)", () => {
  let app: NestFastifyApplication;
  let repo: TenantsRepository;

  const keycloakMock: Partial<KeycloakProvisioningService> = {
    ensureClient: jest.fn(async (clientId: string) => ({ clientId, internalId: "kc-client-1" })),
    ensureUser: jest.fn(async (username: string) => ({ userId: "kc-user-1", username })),
    disableClient: jest.fn(async () => ({ internalId: "kc-client-1" })),
  };

  beforeAll(async () => {
    process.env.K8S_DEPLOY_MODE ||= "manifest";
    process.env.NODE_RED_PASSWORD_SEED ||= "dev-only-change-me-node-red-password-seed";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KeycloakProvisioningService)
      .useValue(keycloakMock)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();

    repo = app.get(TenantsRepository);
  });

  afterAll(async () => {
    await app.close();
  });

  it("create -> verify -> delete", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/tenants",
      payload: { tenantName: "Acme Corp", adminEmail: "admin@acme.test" },
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as any;
    expect(created.slug).toBe("acme-corp");
    expect(created.status).toBe("ACTIVE");
    expect(created.manifests?.createYaml).toContain("kind: Deployment");
    expect(created.nodeRed?.namespace).toBe("default");
    expect(created.nodeRed?.serviceName).toContain("nodered-acme-corp-");
    expect(created.nodeRed?.adminUsername).toBe("admin");
    expect(created.nodeRed?.adminPassword).toBeTruthy();

    const tenantId = created.id as string;
    const row = await repo.findById(tenantId);
    expect(row?.status).toBe(TenantStatus.ACTIVE);
    expect(row?.keycloakClientId).toBe(created.keycloak.clientId);
    expect(row?.nodeRedAdminUsername).toBe("admin");

    const getRes = await app.inject({ method: "GET", url: `/tenants/${tenantId}` });
    expect(getRes.statusCode).toBe(200);
    const fetched = getRes.json() as any;
    expect(fetched.nodeRed?.adminUsername).toBe("admin");
    expect(fetched.nodeRed?.serviceName).toBe(created.nodeRed.serviceName);

    const deleteRes = await app.inject({ method: "DELETE", url: `/tenants/${tenantId}` });
    expect(deleteRes.statusCode).toBe(200);

    const deleted = deleteRes.json() as any;
    expect(deleted.status).toBe("INACTIVE");
    expect(deleted.manifests?.deleteYaml).toContain("kind: Service");
    expect(deleted.nodeRed?.deploymentMode).toBe("manifest");

    const row2 = await repo.findById(tenantId);
    expect(row2?.status).toBe(TenantStatus.INACTIVE);
  });

  it("returns 409 on duplicate slug", async () => {
    await app.inject({
      method: "POST",
      url: "/tenants",
      payload: { tenantName: "Dup Tenant", adminEmail: "admin1@dup.test" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/tenants",
      payload: { tenantName: "Dup Tenant", adminEmail: "admin2@dup.test" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("returns 404 for unknown tenant delete", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/tenants/00000000-0000-4000-8000-000000000000",
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for unknown tenant get", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/tenants/00000000-0000-4000-8000-000000000000",
    });

    expect(res.statusCode).toBe(404);
  });
});
