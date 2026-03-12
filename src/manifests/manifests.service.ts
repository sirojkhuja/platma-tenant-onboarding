import { Injectable } from "@nestjs/common";
import { KubernetesObject } from "@kubernetes/client-node";
import { ConfigService } from "@nestjs/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { stringify } from "yaml";

import { noderedResourceName } from "./k8s-naming";

export type ManifestDocument = KubernetesObject & Record<string, unknown>;

export type ManifestResult = {
  documents: ManifestDocument[];
  editorUrl?: string;
  ingressHost?: string;
  namespace: string;
  resourceName: string;
  serviceName: string;
  yaml: string;
  filePath?: string;
};

export type TenantRef = {
  id: string;
  slug: string;
  nodeRedAdminPasswordHash: string;
  nodeRedAdminUsername: string;
};

function toMultiDocYaml(docs: object[]): string {
  return docs.map((d) => stringify(d).trimEnd()).join("\n---\n") + "\n";
}

function buildNodeRedSettings(): string {
  return `module.exports = {
  uiPort: process.env.PORT || 1880,
  flowFile: "flows.json",
  flowFilePretty: true,
  adminAuth: {
    type: "credentials",
    users: [
      {
        username: process.env.NODE_RED_ADMIN_USERNAME || "admin",
        password: process.env.NODE_RED_ADMIN_PASSWORD_HASH,
        permissions: "*"
      }
    ]
  }
};\n`;
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
    const serviceName = resourceName;
    const secretName = `${resourceName}-auth`;
    const configMapName = `${resourceName}-settings`;
    const pvcName = `${resourceName}-data`;
    const baseDomain = this.config.get<string>("NODE_RED_BASE_DOMAIN");
    const ingressEnabled = this.config.get<boolean>("NODE_RED_ENABLE_INGRESS") ?? false;
    const ingressHost = ingressEnabled && baseDomain ? `${tenant.slug}.${baseDomain}` : undefined;
    const serviceType = this.config.get<string>("NODE_RED_SERVICE_TYPE") ?? "ClusterIP";
    const labels = {
      app: "nodered",
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
    };
    const nodeRedImage = this.config.get<string>("NODE_RED_IMAGE") ?? "nodered/node-red:3.1.0";
    const storageClassName = this.config.get<string>("NODE_RED_STORAGE_CLASS");
    const storageSize = this.config.get<string>("NODE_RED_STORAGE_SIZE") ?? "1Gi";

    const secret: ManifestDocument = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: secretName,
        namespace,
        labels,
      },
      stringData: {
        NODE_RED_ADMIN_PASSWORD_HASH: tenant.nodeRedAdminPasswordHash,
        NODE_RED_ADMIN_USERNAME: tenant.nodeRedAdminUsername,
      },
      type: "Opaque",
    };

    const configMap: ManifestDocument = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: configMapName,
        namespace,
        labels,
      },
      data: {
        "settings.js": buildNodeRedSettings(),
      },
    };

    const persistentVolumeClaim: ManifestDocument = {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: pvcName,
        namespace,
        labels,
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: {
          requests: {
            storage: storageSize,
          },
        },
        ...(storageClassName ? { storageClassName } : {}),
      },
    };

    const deployment: ManifestDocument = {
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
            securityContext: {
              fsGroup: 1000,
              runAsGroup: 1000,
              runAsNonRoot: true,
              runAsUser: 1000,
            },
            containers: [
              {
                name: "nodered",
                image: nodeRedImage,
                env: [
                  {
                    name: "NODE_RED_ADMIN_USERNAME",
                    valueFrom: {
                      secretKeyRef: {
                        name: secretName,
                        key: "NODE_RED_ADMIN_USERNAME",
                      },
                    },
                  },
                  {
                    name: "NODE_RED_ADMIN_PASSWORD_HASH",
                    valueFrom: {
                      secretKeyRef: {
                        name: secretName,
                        key: "NODE_RED_ADMIN_PASSWORD_HASH",
                      },
                    },
                  },
                ],
                livenessProbe: {
                  httpGet: {
                    path: "/",
                    port: "http",
                  },
                  initialDelaySeconds: 30,
                  periodSeconds: 10,
                  timeoutSeconds: 5,
                },
                readinessProbe: {
                  httpGet: {
                    path: "/",
                    port: "http",
                  },
                  initialDelaySeconds: 10,
                  periodSeconds: 5,
                  timeoutSeconds: 3,
                },
                ports: [{ containerPort: 1880, name: "http" }],
                resources: {
                  limits: {
                    cpu: this.config.get<string>("NODE_RED_CPU_LIMIT") ?? "500m",
                    memory: this.config.get<string>("NODE_RED_MEMORY_LIMIT") ?? "512Mi",
                  },
                  requests: {
                    cpu: this.config.get<string>("NODE_RED_CPU_REQUEST") ?? "100m",
                    memory: this.config.get<string>("NODE_RED_MEMORY_REQUEST") ?? "256Mi",
                  },
                },
                volumeMounts: [
                  {
                    mountPath: "/data",
                    name: "data",
                  },
                  {
                    mountPath: "/data/settings.js",
                    name: "settings",
                    subPath: "settings.js",
                  },
                ],
              },
            ],
            volumes: [
              {
                name: "data",
                persistentVolumeClaim: {
                  claimName: pvcName,
                },
              },
              {
                configMap: {
                  name: configMapName,
                },
                name: "settings",
              },
            ],
          },
        },
      },
    };

    const service: ManifestDocument = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: serviceName,
        namespace,
        labels,
      },
      spec: {
        selector: {
          app: labels.app,
          tenantId: labels.tenantId,
        },
        type: serviceType,
        ports: [{ name: "http", port: 80, targetPort: 1880 }],
      },
    };

    const ingress = ingressHost
      ? ({
          apiVersion: "networking.k8s.io/v1",
          kind: "Ingress",
          metadata: {
            name: resourceName,
            namespace,
            labels,
          },
          spec: {
            ...(this.config.get<string>("NODE_RED_INGRESS_CLASS_NAME")
              ? { ingressClassName: this.config.get<string>("NODE_RED_INGRESS_CLASS_NAME") }
              : {}),
            rules: [
              {
                host: ingressHost,
                http: {
                  paths: [
                    {
                      backend: {
                        service: {
                          name: serviceName,
                          port: {
                            number: 80,
                          },
                        },
                      },
                      path: "/",
                      pathType: "Prefix",
                    },
                  ],
                },
              },
            ],
          },
        } as ManifestDocument)
      : undefined;

    const documents: ManifestDocument[] = [
      secret,
      configMap,
      persistentVolumeClaim,
      deployment,
      service,
    ];
    if (ingress) documents.push(ingress);

    const yaml = toMultiDocYaml(documents);
    const editorUrl = ingressHost ? `http://${ingressHost}` : undefined;

    if (outputMode === "disk" || outputMode === "both") {
      await mkdir(outputDir, { recursive: true });
      const fileName = `${resourceName}-${action}.yaml`;
      const filePath = path.resolve(outputDir, fileName);
      await writeFile(filePath, yaml, "utf8");

      return {
        documents,
        editorUrl,
        filePath,
        ingressHost,
        namespace,
        resourceName,
        serviceName,
        yaml: outputMode === "disk" ? "" : yaml,
      };
    }

    return {
      documents,
      editorUrl,
      ingressHost,
      namespace,
      resourceName,
      serviceName,
      yaml,
    };
  }
}
