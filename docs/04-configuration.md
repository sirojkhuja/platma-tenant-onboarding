# Configuration

All configuration must be provided via `@nestjs/config`.

## Environment Variables

Suggested minimum set:

- `PORT=3000`
- `DATABASE_URL=postgresql://platma:platma@localhost:5432/platma?schema=public`
- `KEYCLOAK_BASE_URL=http://localhost:8080`
- `KEYCLOAK_REALM=platma`
- `KEYCLOAK_ADMIN_USERNAME=admin`
- `KEYCLOAK_ADMIN_PASSWORD=admin`

## Example `.env` (Reference)

```bash
PORT=3000
DATABASE_URL=postgresql://platma:platma@localhost:5432/platma?schema=public

KEYCLOAK_BASE_URL=http://localhost:8080
KEYCLOAK_REALM=platma

# Dev-only (admin user auth). In Keycloak, the default admin user is usually in the `master` realm.
KEYCLOAK_TOKEN_GRANT_TYPE=password
KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=admin
KEYCLOAK_TOKEN_REALM=master
KEYCLOAK_CLIENT_ID=admin-cli

# Manifest output
MANIFEST_OUTPUT_MODE=response
MANIFEST_OUTPUT_DIR=./manifests
K8S_NAMESPACE=default

# HTTP resilience
KEYCLOAK_HTTP_TIMEOUT_MS=5000
KEYCLOAK_HTTP_RETRY_COUNT=2
```

Recommended additions for better security/realism:

- `KEYCLOAK_CLIENT_ID=admin-cli` (or a dedicated service client)
- `KEYCLOAK_CLIENT_SECRET=...` (if using client credentials)
- `KEYCLOAK_TOKEN_GRANT_TYPE=password|client_credentials`
  - if `password`, consider `KEYCLOAK_TOKEN_REALM=master`

Manifest output:

- `MANIFEST_OUTPUT_MODE=response|disk|both` (default `response`)
- `MANIFEST_OUTPUT_DIR=./manifests` (used when mode includes disk)
- `K8S_NAMESPACE=default` (or a specific namespace)

HTTP resilience:

- `KEYCLOAK_HTTP_TIMEOUT_MS=5000`
- `KEYCLOAK_HTTP_RETRY_COUNT=2`

## Config Validation

In production-grade NestJS, validate envs at startup. Recommended:

- Use `zod` or `joi` schema validation in the config module.
- Fail fast if required vars are missing.

If you add `KEYCLOAK_TOKEN_REALM`, validate it explicitly; it's a common source of confusion when using the admin user (token realm `master`) vs service accounts in your working realm.

## Secrets Handling Notes

- Never commit `.env` files containing secrets.
- Do not log secrets (DB passwords, Keycloak admin password, client secret).
- Do not embed secrets in generated Kubernetes YAML.
