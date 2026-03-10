import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { TenantEntity } from "./tenant.entity";
import { TenantsRepository } from "./tenants.repository";

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity])],
  providers: [TenantsRepository],
  exports: [TenantsRepository],
})
export class TenantsModule {}
