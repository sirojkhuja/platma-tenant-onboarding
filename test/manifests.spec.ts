import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { validateEnv } from "../src/config/env";
import { toTenantSlug } from "../src/manifests/k8s-naming";
import { ManifestsModule } from "../src/manifests/manifests.module";
import { ManifestsService } from "../src/manifests/manifests.service";

describe("manifests", () => {
  it("slugifies tenant names", () => {
    expect(toTenantSlug(" Acme Corp!! ")).toBe("acme-corp");
    expect(toTenantSlug("---")).toBe("tenant");
  });

  it("generates deterministic Node-RED manifests", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: validateEnv,
        }),
        ManifestsModule,
      ],
    }).compile();

    const svc = moduleRef.get(ManifestsService);

    const tenant = {
      id: "b4b1e8b6-4d71-4e1d-a28c-2d4a0f6f1c9b",
      slug: "acme-corp",
    };

    const res = await svc.generateCreateManifest(tenant);

    expect(res.resourceName).toBe("nodered-acme-corp-b4b1e8b6");
    expect(res.yaml).toContain("kind: Deployment");
    expect(res.yaml).toContain("kind: Service");
    expect(res.yaml).toContain("name: nodered-acme-corp-b4b1e8b6");

    await moduleRef.close();
  });
});
