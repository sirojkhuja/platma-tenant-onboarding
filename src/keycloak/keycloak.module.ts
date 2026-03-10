import { Module } from "@nestjs/common";

import { KeycloakAdminClient } from "./keycloak-admin.client";
import { KeycloakProvisioningService } from "./keycloak.service";

@Module({
  providers: [KeycloakAdminClient, KeycloakProvisioningService],
  exports: [KeycloakProvisioningService],
})
export class KeycloakModule {}
