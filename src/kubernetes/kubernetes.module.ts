import { Module } from "@nestjs/common";

import { KubernetesDeploymentService } from "./kubernetes.service";

@Module({
  providers: [KubernetesDeploymentService],
  exports: [KubernetesDeploymentService],
})
export class KubernetesModule {}
