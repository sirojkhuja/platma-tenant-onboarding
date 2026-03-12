import {
  BadGatewayException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";

import { KubernetesDeploymentService } from "../kubernetes/kubernetes.service";
import { KeycloakHttpError } from "../keycloak/keycloak-admin.client";
import { KeycloakProvisioningService } from "../keycloak/keycloak.service";
import { ManifestResult, ManifestsService } from "../manifests/manifests.service";
import { toTenantSlug, shortIdFromUuid } from "../manifests/k8s-naming";
import { NodeRedCredentialsService } from "../nodered/node-red-credentials.service";

import { CreateTenantDto } from "./dto/create-tenant.dto";
import { TenantEntity } from "./tenant.entity";
import { TenantStatus } from "./tenant-status";
import { TenantsRepository } from "./tenants.repository";

function isUniqueViolation(err: unknown): boolean {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? "");
  if (code === "23505") return true; // Postgres unique_violation
  if (code === "SQLITE_CONSTRAINT") return true;

  const msg = String(anyErr?.message ?? "").toLowerCase();
  return (
    msg.includes("unique") || msg.includes("duplicate key") || msg.includes("constraint failed")
  );
}

function toUpstreamException(err: unknown): BadGatewayException {
  const anyErr = err as any;
  if (err instanceof KeycloakHttpError) {
    return new BadGatewayException({
      message: "Keycloak request failed",
      status: err.status,
      details: err.details,
    });
  }
  if (anyErr?.name === "AbortError") {
    return new BadGatewayException({ message: "Keycloak request timed out" });
  }
  return new BadGatewayException({ message: "Keycloak request failed" });
}

function toEditorUrl(
  ingressHost: string | null | undefined,
  publicHost: string | null | undefined,
  nodePort: number | null | undefined,
): string | undefined {
  if (ingressHost) return `http://${ingressHost}`;
  if (publicHost && nodePort) return `http://${publicHost}:${nodePort}`;
  return undefined;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly kubernetes: KubernetesDeploymentService,
    private readonly nodeRedCredentials: NodeRedCredentialsService,
    private readonly repo: TenantsRepository,
    private readonly keycloak: KeycloakProvisioningService,
    private readonly manifests: ManifestsService,
  ) {}

  async createTenant(dto: CreateTenantDto) {
    const slug = toTenantSlug(dto.tenantName);

    let tenant = null as any;
    try {
      tenant = await this.repo.create({
        name: dto.tenantName,
        slug,
        adminEmail: dto.adminEmail,
        status: TenantStatus.PROVISIONING,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ message: "Tenant already exists", slug });
      }
      throw err;
    }

    const clientId = `tenant-${slug}-${shortIdFromUuid(tenant.id)}`;
    let clientInternalId: string | undefined;
    let createManifest: ManifestResult | undefined;
    const nodeRedCredentials = await this.nodeRedCredentials.getBootstrapCredentials(tenant.id);

    try {
      const client = await this.keycloak.ensureClient(clientId);
      clientInternalId = client.internalId;

      const user = await this.keycloak.ensureUser(dto.adminEmail, dto.adminEmail);

      createManifest = await this.manifests.generateCreateManifest({
        id: tenant.id,
        slug,
        nodeRedAdminPasswordHash: nodeRedCredentials.passwordHash,
        nodeRedAdminUsername: nodeRedCredentials.username,
      });

      const deployResult = await this.kubernetes.applyManifest(createManifest);
      const runtimeAccess = await this.kubernetes.getRuntimeAccess(createManifest);

      await this.repo.update(tenant.id, {
        k8sNamespace: createManifest.namespace,
        k8sResourceName: createManifest.resourceName,
        keycloakAdminUserId: user.userId,
        keycloakClientId: client.clientId,
        keycloakClientInternalId: client.internalId,
        nodeRedAdminUsername: nodeRedCredentials.username,
        nodeRedIngressHost: runtimeAccess.ingressHost ?? null,
        nodeRedNodePort: runtimeAccess.nodePort ?? null,
        nodeRedPublicHost: runtimeAccess.publicHost ?? null,
        nodeRedServiceName: createManifest.serviceName,
        nodeRedServiceType: runtimeAccess.serviceType,
        status: TenantStatus.ACTIVE,
      });

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        adminEmail: tenant.adminEmail,
        status: TenantStatus.ACTIVE,
        keycloak: {
          clientId: client.clientId,
          adminUsername: dto.adminEmail,
        },
        manifests: {
          createYaml: createManifest.yaml || undefined,
          createPath: createManifest.filePath,
        },
        nodeRed: {
          adminPassword: nodeRedCredentials.password,
          adminUsername: nodeRedCredentials.username,
          applied: deployResult.applied,
          deploymentMode: deployResult.mode,
          editorUrl: runtimeAccess.editorUrl,
          ingressHost: runtimeAccess.ingressHost,
          namespace: createManifest.namespace,
          nodePort: runtimeAccess.nodePort,
          publicHost: runtimeAccess.publicHost,
          resourceName: createManifest.resourceName,
          serviceName: createManifest.serviceName,
          serviceType: runtimeAccess.serviceType,
        },
      };
    } catch (err) {
      if (createManifest) {
        try {
          await this.kubernetes.deleteManifest(createManifest);
        } catch {
          // ignore
        }
      }

      // Best-effort compensation: disable client if it was created/enabled.
      try {
        await this.keycloak.disableClient(clientId, clientInternalId);
      } catch {
        // ignore
      }

      try {
        await this.repo.update(tenant.id, { status: TenantStatus.FAILED });
      } catch {
        // ignore
      }

      if (err instanceof KeycloakHttpError || (err as any)?.name === "AbortError") {
        throw toUpstreamException(err);
      }

      throw new InternalServerErrorException({ message: "Failed to create tenant" });
    }
  }

  async getTenant(id: string) {
    const tenant = await this.repo.findById(id);
    if (!tenant) throw new NotFoundException({ message: "Tenant not found" });

    return this.toTenantView(tenant);
  }

  async deleteTenant(id: string) {
    const tenant = await this.repo.findById(id);
    if (!tenant) throw new NotFoundException({ message: "Tenant not found" });

    if (tenant.status !== TenantStatus.INACTIVE) {
      await this.repo.update(id, { status: TenantStatus.DEPROVISIONING });
    }

    const nodeRedCredentials = await this.nodeRedCredentials.getBootstrapCredentials(tenant.id);
    const deleteManifest = await this.manifests.generateDeleteManifest({
      id: tenant.id,
      slug: tenant.slug,
      nodeRedAdminPasswordHash: nodeRedCredentials.passwordHash,
      nodeRedAdminUsername: tenant.nodeRedAdminUsername ?? nodeRedCredentials.username,
    });

    try {
      if (tenant.keycloakClientId) {
        await this.keycloak.disableClient(
          tenant.keycloakClientId,
          tenant.keycloakClientInternalId ?? undefined,
        );
      }
    } catch (err) {
      throw toUpstreamException(err);
    }

    const deleteResult = await this.kubernetes.deleteManifest(deleteManifest);
    await this.repo.update(id, { status: TenantStatus.INACTIVE });

    return {
      id: tenant.id,
      status: TenantStatus.INACTIVE,
      keycloak: { clientEnabled: false },
      manifests: {
        deleteYaml: deleteManifest.yaml || undefined,
        deletePath: deleteManifest.filePath,
      },
      nodeRed: {
        applied: deleteResult.applied,
        deploymentMode: deleteResult.mode,
        editorUrl: toEditorUrl(
          tenant.nodeRedIngressHost,
          tenant.nodeRedPublicHost,
          tenant.nodeRedNodePort,
        ),
        ingressHost: tenant.nodeRedIngressHost,
        namespace: deleteManifest.namespace,
        nodePort: tenant.nodeRedNodePort,
        publicHost: tenant.nodeRedPublicHost,
        resourceName: deleteManifest.resourceName,
        serviceName: deleteManifest.serviceName,
        serviceType: tenant.nodeRedServiceType ?? deleteManifest.serviceType,
      },
    };
  }

  private toTenantView(tenant: TenantEntity) {
    const editorUrl = toEditorUrl(
      tenant.nodeRedIngressHost,
      tenant.nodeRedPublicHost,
      tenant.nodeRedNodePort,
    );

    return {
      adminEmail: tenant.adminEmail,
      createdAt: tenant.createdAt,
      id: tenant.id,
      keycloak: {
        adminUserId: tenant.keycloakAdminUserId,
        clientId: tenant.keycloakClientId,
        clientInternalId: tenant.keycloakClientInternalId,
      },
      name: tenant.name,
      nodeRed: {
        adminUsername: tenant.nodeRedAdminUsername,
        editorUrl,
        ingressHost: tenant.nodeRedIngressHost,
        namespace: tenant.k8sNamespace,
        nodePort: tenant.nodeRedNodePort,
        publicHost: tenant.nodeRedPublicHost,
        resourceName: tenant.k8sResourceName,
        serviceName: tenant.nodeRedServiceName,
        serviceType: tenant.nodeRedServiceType ?? "ClusterIP",
      },
      slug: tenant.slug,
      status: tenant.status,
      updatedAt: tenant.updatedAt,
    };
  }
}
