import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { TenantEntity } from "./tenant.entity";
import { TenantStatus } from "./tenant-status";

export type CreateTenantRow = {
  name: string;
  slug: string;
  adminEmail: string;
  status?: TenantStatus;
};

@Injectable()
export class TenantsRepository {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly repo: Repository<TenantEntity>,
  ) {}

  async create(data: CreateTenantRow): Promise<TenantEntity> {
    const tenant = this.repo.create({
      name: data.name,
      slug: data.slug,
      adminEmail: data.adminEmail,
      status: data.status ?? TenantStatus.PROVISIONING,
    });

    return this.repo.save(tenant);
  }

  async findById(id: string): Promise<TenantEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findBySlug(slug: string): Promise<TenantEntity | null> {
    return this.repo.findOne({ where: { slug } });
  }

  async setStatus(id: string, status: TenantStatus): Promise<void> {
    await this.repo.update({ id }, { status });
  }
}
