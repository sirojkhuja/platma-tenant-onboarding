import { z } from "zod";

const zBoolish = z
  .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((v) => v === true || v === "true" || v === "1");

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),

    // DB
    DATABASE_DRIVER: z.enum(["postgres", "sqljs"]).optional(),
    DATABASE_HOST: z.string().default("localhost"),
    DATABASE_PORT: z.coerce.number().int().positive().default(5432),
    DATABASE_USERNAME: z.string().default("platma"),
    DATABASE_PASSWORD: z.string().default("platma"),
    DATABASE_NAME: z.string().default("platma"),
    DATABASE_SSL: zBoolish.default(false),

    // Keycloak
    KEYCLOAK_BASE_URL: z.string().url().default("http://localhost:8080"),
    KEYCLOAK_REALM: z.string().default("platma"),

    KEYCLOAK_TOKEN_GRANT_TYPE: z.enum(["password", "client_credentials"]).default("password"),
    KEYCLOAK_TOKEN_REALM: z.string().default("master"),

    KEYCLOAK_CLIENT_ID: z.string().default("admin-cli"),
    KEYCLOAK_CLIENT_SECRET: z.string().optional(),

    KEYCLOAK_ADMIN_USERNAME: z.string().default("admin"),
    KEYCLOAK_ADMIN_PASSWORD: z.string().default("admin"),

    KEYCLOAK_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    KEYCLOAK_HTTP_RETRY_COUNT: z.coerce.number().int().min(0).max(10).default(2),

    // Manifests
    MANIFEST_OUTPUT_MODE: z.enum(["response", "disk", "both"]).default("response"),
    MANIFEST_OUTPUT_DIR: z.string().default("./manifests"),
    K8S_NAMESPACE: z.string().default("default"),
  })
  .passthrough();

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (parsed.success) return parsed.data;

  const flattened = parsed.error.flatten();
  const msg = [
    "Invalid environment variables:",
    ...Object.entries(flattened.fieldErrors).flatMap(([k, errs]) =>
      (errs ?? []).map((e) => `- ${k}: ${e}`),
    ),
  ].join("\n");

  throw new Error(msg);
}
