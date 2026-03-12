import { randomUUID } from "crypto";
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { TenantStatus } from "./tenant-status";

@Entity({ name: "tenants" })
@Index("idx_tenants_status", ["status"])
export class TenantEntity {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", unique: true })
  slug!: string;

  @Column({ type: "text" })
  adminEmail!: string;

  @Column({
    default: TenantStatus.PROVISIONING,
    type: "text",
  })
  status!: TenantStatus;

  @Column({ type: "text", nullable: true })
  keycloakClientId!: string | null;

  @Column({ type: "text", nullable: true })
  keycloakClientInternalId!: string | null;

  @Column({ type: "text", nullable: true })
  keycloakAdminUserId!: string | null;

  @Column({ type: "text", nullable: true })
  k8sNamespace!: string | null;

  @Column({ type: "text", nullable: true })
  k8sResourceName!: string | null;

  @Column({ type: "text", nullable: true })
  nodeRedAdminUsername!: string | null;

  @Column({ type: "text", nullable: true })
  nodeRedIngressHost!: string | null;

  @Column({ type: "text", nullable: true })
  nodeRedServiceName!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  beforeInsert() {
    if (!this.id) this.id = randomUUID();
  }
}
