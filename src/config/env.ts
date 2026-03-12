import { z } from "zod";

const DEV_ONLY_NODE_RED_PASSWORD_SEED = "dev-only-change-me-node-red-password-seed";

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

    // Kubernetes runtime
    K8S_DEPLOY_MODE: z.enum(["manifest", "apply"]).default("manifest"),
    K8S_KUBECONFIG_PATH: z.string().optional(),
    K8S_CREATE_NAMESPACE: zBoolish.default(true),
    K8S_PUBLIC_HOST: z.string().optional(),
    K8S_ROLLOUT_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
    K8S_ROLLOUT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),

    // Node-RED workload
    NODE_RED_IMAGE: z.string().default("nodered/node-red:3.1.0"),
    NODE_RED_EDITOR_USERNAME: z.string().default("admin"),
    NODE_RED_PASSWORD_SEED: z.string().min(16).default(DEV_ONLY_NODE_RED_PASSWORD_SEED),
    NODE_RED_PASSWORD_LENGTH: z.coerce.number().int().min(16).max(64).default(24),
    NODE_RED_STORAGE_SIZE: z.string().default("1Gi"),
    NODE_RED_STORAGE_CLASS: z.string().optional(),
    NODE_RED_SERVICE_TYPE: z.enum(["ClusterIP", "NodePort"]).default("ClusterIP"),
    NODE_RED_ENABLE_INGRESS: zBoolish.default(false),
    NODE_RED_BASE_DOMAIN: z.string().optional(),
    NODE_RED_INGRESS_CLASS_NAME: z.string().optional(),
    NODE_RED_CPU_REQUEST: z.string().default("100m"),
    NODE_RED_CPU_LIMIT: z.string().default("500m"),
    NODE_RED_MEMORY_REQUEST: z.string().default("256Mi"),
    NODE_RED_MEMORY_LIMIT: z.string().default("512Mi"),
  })
  .passthrough()
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === "production" &&
      env.NODE_RED_PASSWORD_SEED === DEV_ONLY_NODE_RED_PASSWORD_SEED
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NODE_RED_PASSWORD_SEED must be explicitly set in production",
        path: ["NODE_RED_PASSWORD_SEED"],
      });
    }

    if (env.NODE_RED_ENABLE_INGRESS && !env.NODE_RED_BASE_DOMAIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NODE_RED_BASE_DOMAIN is required when NODE_RED_ENABLE_INGRESS=true",
        path: ["NODE_RED_BASE_DOMAIN"],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (parsed.success) return parsed.data;

  const flattened = parsed.error.flatten();
  const fieldErrors = flattened.fieldErrors as Record<string, string[] | undefined>;
  const msg = [
    "Invalid environment variables:",
    ...Object.entries(fieldErrors).flatMap(([k, errs]) => (errs ?? []).map((e) => `- ${k}: ${e}`)),
  ].join("\n");

  throw new Error(msg);
}
