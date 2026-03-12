import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { KeycloakModule } from "../keycloak/keycloak.module";
import { ManifestsModule } from "../manifests/manifests.module";
import { NodeRedCredentialsService } from "../nodered/node-red-credentials.service";

import { TenantEntity } from "./tenant.entity";
import { TenantsController } from "./tenants.controller";
import { TenantsRepository } from "./tenants.repository";
import { TenantsService } from "./tenants.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantEntity]),
    KeycloakModule,
    KubernetesModule,
    ManifestsModule,
  ],
  controllers: [TenantsController],
  providers: [NodeRedCredentialsService, TenantsRepository, TenantsService],
  exports: [TenantsRepository, TenantsService],
})
export class TenantsModule {}
