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
  serviceType: "ClusterIP" | "NodePort";
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

function buildSeedFlowsScript(): string {
  return `#!/bin/sh
set -eu

if [ ! -f /data/flows.json ]; then
  cp /seed/flows.json /data/flows.json
fi
`;
}

function buildStarterFlows(tenant: TenantRef, namespace: string, serviceName: string): string {
  const flows = [
    {
      id: "tab-welcome",
      type: "tab",
      label: "Welcome & Demo",
      disabled: false,
      info: "",
    },
    {
      id: "welcome-comment",
      type: "comment",
      z: "tab-welcome",
      name: "Welcome",
      info: [
        "This Node-RED workspace was provisioned automatically for this tenant.",
        "",
        "What to do next:",
        "1. Click the button on the `Run starter demo` node.",
        "2. Open the debug sidebar to inspect the payload.",
        "3. Change the flow and click Deploy.",
        "",
        "Your flows are stored on the tenant PVC, so they survive pod restarts.",
      ].join("\n"),
      x: 250,
      y: 80,
      wires: [],
    },
    {
      id: "tenant-metadata-comment",
      type: "comment",
      z: "tab-welcome",
      name: "Tenant metadata",
      info: [
        `tenantId: ${tenant.id}`,
        `tenantSlug: ${tenant.slug}`,
        `namespace: ${namespace}`,
        `serviceName: ${serviceName}`,
      ].join("\n"),
      x: 250,
      y: 160,
      wires: [],
    },
    {
      id: "starter-demo-inject",
      type: "inject",
      z: "tab-welcome",
      name: "Run starter demo",
      props: [{ p: "payload" }, { p: "topic", vt: "str" }],
      repeat: "",
      crontab: "",
      once: false,
      onceDelay: 0.1,
      topic: "starter-demo",
      payload: "",
      payloadType: "date",
      x: 170,
      y: 280,
      wires: [["starter-demo-function"]],
    },
    {
      id: "starter-demo-function",
      type: "function",
      z: "tab-welcome",
      name: "Build starter payload",
      func: `msg.payload = {
  message: "Node-RED starter flow is ready",
  tenantId: "${tenant.id}",
  tenantSlug: "${tenant.slug}",
  namespace: "${namespace}",
  serviceName: "${serviceName}",
  timestamp: new Date().toISOString()
};
return msg;`,
      outputs: 1,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 430,
      y: 280,
      wires: [["starter-demo-debug"]],
    },
    {
      id: "starter-demo-debug",
      type: "debug",
      z: "tab-welcome",
      name: "Starter output",
      active: true,
      tosidebar: true,
      console: false,
      tostatus: false,
      complete: "payload",
      targetType: "msg",
      statusVal: "",
      statusType: "auto",
      x: 690,
      y: 280,
      wires: [],
    },
    {
      id: "tab-health",
      type: "tab",
      label: "Health",
      disabled: false,
      info: "",
    },
    {
      id: "health-comment",
      type: "comment",
      z: "tab-health",
      name: "Health endpoint",
      info: [
        "This flow exposes a read-only HTTP endpoint at `GET /tenant-health`.",
        "Use it to verify that the tenant Node-RED runtime is alive without opening the editor.",
      ].join("\n"),
      x: 280,
      y: 80,
      wires: [],
    },
    {
      id: "tenant-health-in",
      type: "http in",
      z: "tab-health",
      name: "GET /tenant-health",
      url: "/tenant-health",
      method: "get",
      upload: false,
      swaggerDoc: "",
      x: 170,
      y: 220,
      wires: [["tenant-health-function"]],
    },
    {
      id: "tenant-health-function",
      type: "function",
      z: "tab-health",
      name: "Build health response",
      func: `msg.headers = { "content-type": "application/json" };
msg.payload = {
  status: "ok",
  tenantId: "${tenant.id}",
  tenantSlug: "${tenant.slug}",
  namespace: "${namespace}",
  serviceName: "${serviceName}"
};
return msg;`,
      outputs: 1,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 440,
      y: 220,
      wires: [["tenant-health-response"]],
    },
    {
      id: "tenant-health-response",
      type: "http response",
      z: "tab-health",
      name: "Return JSON",
      statusCode: "200",
      headers: {},
      x: 700,
      y: 220,
      wires: [],
    },
    {
      id: "tab-errors",
      type: "tab",
      label: "Errors",
      disabled: false,
      info: "",
    },
    {
      id: "errors-comment",
      type: "comment",
      z: "tab-errors",
      name: "Error handling",
      info: "Unhandled flow errors are sent to the debug sidebar here.",
      x: 240,
      y: 80,
      wires: [],
    },
    {
      id: "catch-errors",
      type: "catch",
      z: "tab-errors",
      name: "Catch flow errors",
      scope: null,
      uncaught: false,
      x: 180,
      y: 200,
      wires: [["debug-errors"]],
    },
    {
      id: "debug-errors",
      type: "debug",
      z: "tab-errors",
      name: "Flow errors",
      active: true,
      tosidebar: true,
      console: false,
      tostatus: true,
      complete: "true",
      targetType: "full",
      statusVal: "error.message",
      statusType: "msg",
      x: 430,
      y: 200,
      wires: [],
    },
  ];

  return JSON.stringify(flows, null, 2) + "\n";
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
    const serviceType =
      (this.config.get<string>("NODE_RED_SERVICE_TYPE") as "ClusterIP" | "NodePort" | undefined) ??
      "ClusterIP";
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
        "flows.json": buildStarterFlows(tenant, namespace, serviceName),
        "seed-flows.sh": buildSeedFlowsScript(),
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
            initContainers: [
              {
                name: "seed-flows",
                image: nodeRedImage,
                command: ["/bin/sh", "/seed/seed-flows.sh"],
                volumeMounts: [
                  {
                    mountPath: "/data",
                    name: "data",
                  },
                  {
                    mountPath: "/seed",
                    name: "runtime-config",
                  },
                ],
              },
            ],
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
                    name: "runtime-config",
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
                name: "runtime-config",
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
        serviceType,
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
      serviceType,
      serviceName,
      yaml,
    };
  }
}
