import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module";
import { TenantStatus } from "../src/tenants/tenant-status";
import { TenantsRepository } from "../src/tenants/tenants.repository";

describe("TenantsRepository", () => {
  it("creates a tenant and enforces unique slug", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    try {
      const repo = moduleRef.get(TenantsRepository);

      const created = await repo.create({
        name: "Acme",
        slug: "acme",
        adminEmail: "admin@acme.test",
      });

      expect(created.id).toBeTruthy();
      expect(created.status).toBe(TenantStatus.PROVISIONING);

      await expect(
        repo.create({
          name: "Acme 2",
          slug: "acme",
          adminEmail: "admin2@acme.test",
        }),
      ).rejects.toThrow();
    } finally {
      await moduleRef.close();
    }
  });
});
