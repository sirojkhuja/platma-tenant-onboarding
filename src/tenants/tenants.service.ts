import {
  BadGatewayException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";

import { KeycloakHttpError } from "../keycloak/keycloak-admin.client";
import { KeycloakProvisioningService } from "../keycloak/keycloak.service";
import { toTenantSlug, shortIdFromUuid } from "../manifests/k8s-naming";
import { ManifestsService } from "../manifests/manifests.service";

import { CreateTenantDto } from "./dto/create-tenant.dto";
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

@Injectable()
export class TenantsService {
  constructor(
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

    try {
      const client = await this.keycloak.ensureClient(clientId);
      clientInternalId = client.internalId;

      const user = await this.keycloak.ensureUser(dto.adminEmail, dto.adminEmail);

      await this.repo.update(tenant.id, {
        keycloakClientId: client.clientId,
        keycloakClientInternalId: client.internalId,
        keycloakAdminUserId: user.userId,
      });

      const createManifest = await this.manifests.generateCreateManifest({ id: tenant.id, slug });

      await this.repo.update(tenant.id, { status: TenantStatus.ACTIVE });

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
      };
    } catch (err) {
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

  async deleteTenant(id: string) {
    const tenant = await this.repo.findById(id);
    if (!tenant) throw new NotFoundException({ message: "Tenant not found" });

    if (tenant.status !== TenantStatus.INACTIVE) {
      await this.repo.update(id, { status: TenantStatus.DEPROVISIONING });
    }

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

    const deleteManifest = await this.manifests.generateDeleteManifest({
      id: tenant.id,
      slug: tenant.slug,
    });
    await this.repo.update(id, { status: TenantStatus.INACTIVE });

    return {
      id: tenant.id,
      status: TenantStatus.INACTIVE,
      keycloak: { clientEnabled: false },
      manifests: {
        deleteYaml: deleteManifest.yaml || undefined,
        deletePath: deleteManifest.filePath,
      },
    };
  }
}
