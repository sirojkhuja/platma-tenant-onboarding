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

    const tenantId = created.id as string;
    const row = await repo.findById(tenantId);
    expect(row?.status).toBe(TenantStatus.ACTIVE);
    expect(row?.keycloakClientId).toBe(created.keycloak.clientId);

    const deleteRes = await app.inject({ method: "DELETE", url: `/tenants/${tenantId}` });
    expect(deleteRes.statusCode).toBe(200);

    const deleted = deleteRes.json() as any;
    expect(deleted.status).toBe("INACTIVE");
    expect(deleted.manifests?.deleteYaml).toContain("kind: Service");

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
});
