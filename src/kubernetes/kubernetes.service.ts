import type {
  AppsV1Api,
  CoreV1Api,
  KubernetesObject,
  KubernetesObjectApi,
  V1Node,
  V1Namespace,
} from "@kubernetes/client-node";
import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ManifestDocument, ManifestResult } from "../manifests/manifests.service";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadKubernetesModule() {
  const dynamicImport = new Function("specifier", "return import(specifier)");
  return (await dynamicImport(
    "@kubernetes/client-node",
  )) as typeof import("@kubernetes/client-node");
}

function isNotFoundError(err: unknown): boolean {
  const anyErr = err as any;
  return anyErr?.statusCode === 404 || anyErr?.body?.code === 404 || anyErr?.code === 404;
}

function isConflictError(err: unknown): boolean {
  const anyErr = err as any;
  return anyErr?.statusCode === 409 || anyErr?.body?.code === 409 || anyErr?.code === 409;
}

export type KubernetesApplyResult = {
  applied: boolean;
  mode: "manifest" | "apply";
};

export type NodeRedRuntimeAccess = {
  editorUrl?: string;
  ingressHost?: string;
  nodePort?: number;
  publicHost?: string;
  serviceType: "ClusterIP" | "NodePort";
};

@Injectable()
export class KubernetesDeploymentService {
  private readonly logger = new Logger(KubernetesDeploymentService.name);
  private clients:
    | {
        appsApi: AppsV1Api;
        coreApi: CoreV1Api;
        objectApi: KubernetesObjectApi;
      }
    | undefined;

  constructor(private readonly config: ConfigService) {}

  async applyManifest(manifest: ManifestResult): Promise<KubernetesApplyResult> {
    if (!this.isApplyModeEnabled()) {
      return { applied: false, mode: "manifest" };
    }

    const { objectApi } = await this.getClients();
    await this.ensureNamespace(manifest.namespace);

    for (const document of manifest.documents) {
      await this.upsertObject(objectApi, document);
    }

    await this.waitForDeploymentReady(manifest.namespace, manifest.resourceName);
    return { applied: true, mode: "apply" };
  }

  async deleteManifest(manifest: ManifestResult): Promise<KubernetesApplyResult> {
    if (!this.isApplyModeEnabled()) {
      return { applied: false, mode: "manifest" };
    }

    const { objectApi } = await this.getClients();
    const documents = [...manifest.documents].reverse();

    for (const document of documents) {
      await this.deleteObject(objectApi, document);
    }

    await this.waitForDeploymentDeleted(manifest.namespace, manifest.resourceName);
    return { applied: true, mode: "apply" };
  }

  async getRuntimeAccess(manifest: ManifestResult): Promise<NodeRedRuntimeAccess> {
    if (manifest.ingressHost) {
      return {
        editorUrl: manifest.editorUrl,
        ingressHost: manifest.ingressHost,
        serviceType: manifest.serviceType,
      };
    }

    if (manifest.serviceType !== "NodePort") {
      return { serviceType: manifest.serviceType };
    }

    if (!this.isApplyModeEnabled()) {
      return { serviceType: manifest.serviceType };
    }

    const { coreApi } = await this.getClients();
    const service = await coreApi.readNamespacedService({
      name: manifest.serviceName,
      namespace: manifest.namespace,
    });
    const nodePort = service.spec?.ports?.find((port) => port.name === "http")?.nodePort;

    if (!nodePort) {
      return { serviceType: manifest.serviceType };
    }

    const publicHost = await this.getPublicHost(coreApi);

    return {
      editorUrl: publicHost ? `http://${publicHost}:${nodePort}` : undefined,
      nodePort,
      publicHost,
      serviceType: manifest.serviceType,
    };
  }

  private isApplyModeEnabled(): boolean {
    return (this.config.get<string>("K8S_DEPLOY_MODE") ?? "manifest") === "apply";
  }

  private async getClients() {
    if (this.clients) return this.clients;

    const { AppsV1Api, CoreV1Api, KubeConfig, KubernetesObjectApi } = await loadKubernetesModule();
    const kubeConfig = new KubeConfig();
    const kubeconfigPath = this.config.get<string>("K8S_KUBECONFIG_PATH");

    if (kubeconfigPath) kubeConfig.loadFromFile(kubeconfigPath);
    else kubeConfig.loadFromDefault();

    this.clients = {
      appsApi: kubeConfig.makeApiClient(AppsV1Api),
      coreApi: kubeConfig.makeApiClient(CoreV1Api),
      objectApi: KubernetesObjectApi.makeApiClient(kubeConfig),
    };

    return this.clients;
  }

  private async ensureNamespace(namespace: string) {
    if (!(this.config.get<boolean>("K8S_CREATE_NAMESPACE") ?? true)) return;

    const { coreApi } = await this.getClients();

    try {
      await coreApi.readNamespace({ name: namespace });
      return;
    } catch (err) {
      if (!isNotFoundError(err)) throw this.toKubernetesException(err, "Failed to read namespace");
    }

    const body: V1Namespace = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: namespace },
    };

    try {
      await coreApi.createNamespace({ body });
    } catch (err) {
      if (!isConflictError(err)) {
        throw this.toKubernetesException(err, "Failed to create namespace");
      }
    }
  }

  private async upsertObject(objectApi: KubernetesObjectApi, document: ManifestDocument) {
    const spec = structuredClone(document);
    const resourceRef = this.toObjectRef(spec);

    try {
      const existing = await objectApi.read(resourceRef);
      spec.metadata = spec.metadata ?? {};
      spec.metadata.resourceVersion = existing.metadata?.resourceVersion;
      await objectApi.replace(spec);
      this.logger.log(`Replaced ${spec.kind}/${spec.metadata?.name}`);
    } catch (err) {
      if (isNotFoundError(err)) {
        await objectApi.create(spec);
        this.logger.log(`Created ${spec.kind}/${spec.metadata?.name}`);
        return;
      }

      throw this.toKubernetesException(
        err,
        `Failed to apply ${spec.kind}/${spec.metadata?.namespace ?? "default"}/${spec.metadata?.name}`,
      );
    }
  }

  private async deleteObject(objectApi: KubernetesObjectApi, document: ManifestDocument) {
    const spec = this.toObjectRef(document);

    try {
      await objectApi.delete(spec, undefined, undefined, 0, undefined, "Background");
      this.logger.log(`Deleted ${spec.kind}/${spec.metadata?.name}`);
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw this.toKubernetesException(
        err,
        `Failed to delete ${spec.kind}/${spec.metadata?.namespace ?? "default"}/${spec.metadata?.name}`,
      );
    }
  }

  private async waitForDeploymentReady(namespace: string, name: string) {
    const { appsApi } = await this.getClients();
    const timeoutMs = this.config.get<number>("K8S_ROLLOUT_TIMEOUT_MS") ?? 180000;
    const pollIntervalMs = this.config.get<number>("K8S_ROLLOUT_POLL_INTERVAL_MS") ?? 2000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const deployment = await appsApi.readNamespacedDeployment({ name, namespace });
      const desiredReplicas = deployment.spec?.replicas ?? 1;
      const availableReplicas = deployment.status?.availableReplicas ?? 0;
      const observedGeneration = deployment.status?.observedGeneration ?? 0;
      const generation = deployment.metadata?.generation ?? 0;

      if (availableReplicas >= desiredReplicas && observedGeneration >= generation) {
        return;
      }

      await sleep(pollIntervalMs);
    }

    throw new InternalServerErrorException({
      message: "Kubernetes deployment did not become ready in time",
      namespace,
      resourceName: name,
    });
  }

  private async waitForDeploymentDeleted(namespace: string, name: string) {
    const { appsApi } = await this.getClients();
    const timeoutMs = this.config.get<number>("K8S_ROLLOUT_TIMEOUT_MS") ?? 180000;
    const pollIntervalMs = this.config.get<number>("K8S_ROLLOUT_POLL_INTERVAL_MS") ?? 2000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        await appsApi.readNamespacedDeployment({ name, namespace });
      } catch (err) {
        if (isNotFoundError(err)) return;
        throw this.toKubernetesException(err, "Failed while waiting for deployment deletion");
      }

      await sleep(pollIntervalMs);
    }

    throw new InternalServerErrorException({
      message: "Kubernetes deployment was not deleted in time",
      namespace,
      resourceName: name,
    });
  }

  private async getPublicHost(coreApi: CoreV1Api): Promise<string | undefined> {
    const configuredPublicHost = this.config.get<string>("K8S_PUBLIC_HOST");
    if (configuredPublicHost) return configuredPublicHost;

    const nodes = await coreApi.listNode();
    return this.selectNodeAddress(nodes.items);
  }

  private selectNodeAddress(nodes: V1Node[]): string | undefined {
    for (const addressType of ["ExternalIP", "InternalIP"] as const) {
      for (const node of nodes) {
        const address = node.status?.addresses?.find((candidate) => candidate.type === addressType);
        if (address?.address) return address.address;
      }
    }

    return undefined;
  }

  private toObjectRef(document: ManifestDocument) {
    const name = document.metadata?.name;
    if (!name) {
      throw new InternalServerErrorException({
        message: "Manifest document is missing metadata.name",
        kind: document.kind,
      });
    }

    return {
      apiVersion: document.apiVersion,
      kind: document.kind,
      metadata: {
        name,
        namespace: document.metadata?.namespace,
      },
    } satisfies KubernetesObject;
  }

  private toKubernetesException(err: unknown, message: string) {
    const anyErr = err as any;
    return new InternalServerErrorException({
      message,
      details: anyErr?.body ?? anyErr?.message ?? String(err),
    });
  }
}
