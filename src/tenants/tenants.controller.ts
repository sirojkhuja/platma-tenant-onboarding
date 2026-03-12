import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";

import { CreateTenantDto } from "./dto/create-tenant.dto";
import { TenantsService } from "./tenants.service";

@Controller("tenants")
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(dto);
  }

  @Get(":id")
  getById(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.tenants.getTenant(id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  delete(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.tenants.deleteTenant(id);
  }
}
