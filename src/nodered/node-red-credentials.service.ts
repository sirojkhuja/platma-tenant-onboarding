import { createHmac } from "crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { hash } from "bcryptjs";

export type NodeRedBootstrapCredentials = {
  password: string;
  passwordHash: string;
  username: string;
};

@Injectable()
export class NodeRedCredentialsService {
  constructor(private readonly config: ConfigService) {}

  async getBootstrapCredentials(tenantId: string): Promise<NodeRedBootstrapCredentials> {
    const username = this.config.get<string>("NODE_RED_EDITOR_USERNAME") ?? "admin";
    const password = this.derivePassword(tenantId);
    const passwordHash = await hash(password, 10);

    return { username, password, passwordHash };
  }

  private derivePassword(tenantId: string): string {
    const seed = this.config.get<string>("NODE_RED_PASSWORD_SEED")!;
    const passwordLength = this.config.get<number>("NODE_RED_PASSWORD_LENGTH") ?? 24;
    const digest = createHmac("sha256", seed).update(tenantId).digest("base64url");

    return (digest + digest).slice(0, passwordLength);
  }
}
