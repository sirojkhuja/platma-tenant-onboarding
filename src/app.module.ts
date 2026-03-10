import "reflect-metadata";

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { validateEnv } from "./config/env";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { KeycloakModule } from "./keycloak/keycloak.module";
import { ManifestsModule } from "./manifests/manifests.module";
import { TenantsModule } from "./tenants/tenants.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    TenantsModule,
    ManifestsModule,
    KeycloakModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
