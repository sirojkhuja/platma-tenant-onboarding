import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { KeycloakModule } from "../keycloak/keycloak.module";
import { ManifestsModule } from "../manifests/manifests.module";

import { TenantEntity } from "./tenant.entity";
import { TenantsController } from "./tenants.controller";
import { TenantsRepository } from "./tenants.repository";
import { TenantsService } from "./tenants.service";

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity]), KeycloakModule, ManifestsModule],
  controllers: [TenantsController],
  providers: [TenantsRepository, TenantsService],
  exports: [TenantsRepository, TenantsService],
})
export class TenantsModule {}
