import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { validateEnv } from "../src/config/env";
import { KubernetesDeploymentService } from "../src/kubernetes/kubernetes.service";
import { ManifestResult } from "../src/manifests/manifests.service";

describe("kubernetes runtime access", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns ingress editor URL directly", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: validateEnv,
        }),
      ],
      providers: [KubernetesDeploymentService],
    }).compile();

    const service = moduleRef.get(KubernetesDeploymentService);
    const manifest: ManifestResult = {
      documents: [],
      editorUrl: "http://acme.localtest.me",
      ingressHost: "acme.localtest.me",
      namespace: "default",
      resourceName: "nodered-acme",
      serviceName: "nodered-acme",
      serviceType: "ClusterIP",
      yaml: "",
    };

    await expect(service.getRuntimeAccess(manifest)).resolves.toEqual({
      editorUrl: "http://acme.localtest.me",
      ingressHost: "acme.localtest.me",
      serviceType: "ClusterIP",
    });

    await moduleRef.close();
  });

  it("builds a nodeport editor URL from the live service", async () => {
    process.env.K8S_DEPLOY_MODE = "apply";

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: validateEnv,
        }),
      ],
      providers: [KubernetesDeploymentService],
    }).compile();

    const service = moduleRef.get(KubernetesDeploymentService);
    (service as any).clients = {
      appsApi: {},
      coreApi: {
        listNode: jest.fn(async () => ({
          items: [
            {
              status: {
                addresses: [{ address: "192.168.32.3", type: "InternalIP" }],
              },
            },
          ],
        })),
        readNamespacedService: jest.fn(async () => ({
          spec: {
            ports: [{ name: "http", nodePort: 32080, port: 80 }],
          },
        })),
      },
      objectApi: {},
    };

    const manifest: ManifestResult = {
      documents: [],
      namespace: "default",
      resourceName: "nodered-acme",
      serviceName: "nodered-acme",
      serviceType: "NodePort",
      yaml: "",
    };

    await expect(service.getRuntimeAccess(manifest)).resolves.toEqual({
      editorUrl: "http://192.168.32.3:32080",
      nodePort: 32080,
      publicHost: "192.168.32.3",
      serviceType: "NodePort",
    });

    await moduleRef.close();
  });
});
