import { Injectable } from "@nestjs/common";

import { KeycloakAdminClient } from "./keycloak-admin.client";

type KeycloakClientRep = {
  id: string;
  clientId: string;
  enabled?: boolean;
};

type KeycloakUserRep = {
  id: string;
  username: string;
  email?: string;
  enabled?: boolean;
};

function lastPathSegment(location?: string): string | undefined {
  if (!location) return undefined;
  const idx = location.lastIndexOf("/");
  if (idx < 0) return undefined;
  return location.slice(idx + 1) || undefined;
}

@Injectable()
export class KeycloakProvisioningService {
  constructor(private readonly admin: KeycloakAdminClient) {}

  async ensureClient(clientId: string): Promise<{ clientId: string; internalId: string }> {
    const existing = await this.findClientByClientId(clientId);
    if (existing) {
      if (existing.enabled === false) {
        const rep = await this.admin.getAdmin<any>(`/clients/${encodeURIComponent(existing.id)}`);
        rep.enabled = true;
        await this.admin.putAdmin(`/clients/${encodeURIComponent(existing.id)}`, rep);
      }

      return { clientId: existing.clientId, internalId: existing.id };
    }

    const rep = {
      clientId,
      enabled: true,
      protocol: "openid-connect",
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
    };

    const { location } = await this.admin.postAdmin(`/clients`, rep);
    const internalId = lastPathSegment(location);
    if (internalId) return { clientId, internalId };

    const created = await this.findClientByClientId(clientId);
    if (!created)
      throw new Error("Keycloak client creation returned no id and client was not found");
    return { clientId: created.clientId, internalId: created.id };
  }

  async disableClient(clientId: string, internalId?: string): Promise<{ internalId: string }> {
    const client = internalId
      ? await this.admin.getAdmin<any>(`/clients/${encodeURIComponent(internalId)}`)
      : await this.findClientByClientId(clientId);

    if (!client) throw new Error(`Keycloak client not found: ${clientId}`);

    const id = (client as any).id as string;
    const rep = internalId
      ? client
      : await this.admin.getAdmin<any>(`/clients/${encodeURIComponent(id)}`);
    rep.enabled = false;
    await this.admin.putAdmin(`/clients/${encodeURIComponent(id)}`, rep);

    return { internalId: id };
  }

  async ensureUser(username: string, email: string): Promise<{ userId: string; username: string }> {
    const existing = await this.findUserByUsername(username);
    if (existing) {
      if (existing.enabled === false) {
        const rep = await this.admin.getAdmin<any>(`/users/${encodeURIComponent(existing.id)}`);
        rep.enabled = true;
        await this.admin.putAdmin(`/users/${encodeURIComponent(existing.id)}`, rep);
      }

      return { userId: existing.id, username: existing.username };
    }

    const rep = {
      username,
      email,
      enabled: true,
      emailVerified: false,
    };

    const { location } = await this.admin.postAdmin(`/users`, rep);
    const userId = lastPathSegment(location);
    if (userId) return { userId, username };

    const created = await this.findUserByUsername(username);
    if (!created) throw new Error("Keycloak user creation returned no id and user was not found");
    return { userId: created.id, username: created.username };
  }

  async findClientByClientId(clientId: string): Promise<KeycloakClientRep | null> {
    const list = await this.admin.getAdmin<KeycloakClientRep[]>(
      `/clients?clientId=${encodeURIComponent(clientId)}`,
    );
    return list[0] ?? null;
  }

  async findUserByUsername(username: string): Promise<KeycloakUserRep | null> {
    const list = await this.admin.getAdmin<KeycloakUserRep[]>(
      `/users?username=${encodeURIComponent(username)}&exact=true`,
    );
    return list[0] ?? null;
  }
}
