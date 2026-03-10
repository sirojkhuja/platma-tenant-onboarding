import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { stringify } from "yaml";

import { noderedResourceName } from "./k8s-naming";

export type ManifestResult = {
  resourceName: string;
  yaml: string;
  filePath?: string;
};

export type TenantRef = {
  id: string;
  slug: string;
};

function toMultiDocYaml(docs: object[]): string {
  return docs.map((d) => stringify(d).trimEnd()).join("\n---\n") + "\n";
}

@Injectable()
export class ManifestsService {
  constructor(private readonly config: ConfigService) {}

  async generateCreateManifest(tenant: TenantRef): Promise<ManifestResult> {
    return this.generateManifest(tenant, "create");
  }

  async generateDeleteManifest(tenant: TenantRef): Promise<ManifestResult> {
    return this.generateManifest(tenant, "delete");
  }

  private async generateManifest(
    tenant: TenantRef,
    action: "create" | "delete",
  ): Promise<ManifestResult> {
    const namespace = this.config.get<string>("K8S_NAMESPACE") ?? "default";
    const outputMode = this.config.get<string>("MANIFEST_OUTPUT_MODE") ?? "response";
    const outputDir = this.config.get<string>("MANIFEST_OUTPUT_DIR") ?? "./manifests";

    const resourceName = noderedResourceName(tenant.slug, tenant.id);
    const labels = {
      app: "nodered",
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
    };

    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: resourceName,
        namespace,
        labels,
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: {
            app: labels.app,
            tenantId: labels.tenantId,
          },
        },
        template: {
          metadata: {
            labels,
          },
          spec: {
            containers: [
              {
                name: "nodered",
                image: "nodered/node-red:3.1.0",
                ports: [{ containerPort: 1880 }],
              },
            ],
          },
        },
      },
    };

    const service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: resourceName,
        namespace,
        labels,
      },
      spec: {
        selector: {
          app: labels.app,
          tenantId: labels.tenantId,
        },
        ports: [{ name: "http", port: 80, targetPort: 1880 }],
      },
    };

    const yaml = toMultiDocYaml([deployment, service]);

    if (outputMode === "disk" || outputMode === "both") {
      await mkdir(outputDir, { recursive: true });
      const fileName = `${resourceName}-${action}.yaml`;
      const filePath = path.resolve(outputDir, fileName);
      await writeFile(filePath, yaml, "utf8");

      return { resourceName, yaml: outputMode === "disk" ? "" : yaml, filePath };
    }

    return { resourceName, yaml };
  }
}

