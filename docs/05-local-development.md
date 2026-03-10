# Local Development

## Local Dependencies

- Node.js (recommend LTS, e.g. Node 20+)
- Docker + docker-compose

## docker-compose Expectations

The repository should include a `docker-compose.yml` at the repo root that starts:

- `postgres`:
  - exposes `5432`
  - creates DB `platma` and user `platma` (or similar)
- `keycloak`:
  - exposes `8080`
  - uses a development admin account via `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`
  - persists its data (optional but recommended for dev)

Keycloak 17+ uses the `start-dev` command. Recommended dev flags:

- `start-dev`
- optional realm import:
  - `--import-realm`

## Example docker-compose.yml (Reference)

This is a reference compose file. For the actual project, place a real `docker-compose.yml` at repo root and tune versions/ports as needed.

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: platma
      POSTGRES_USER: platma
      POSTGRES_PASSWORD: platma
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U platma -d platma"]
      interval: 5s
      timeout: 5s
      retries: 20

  keycloak:
    image: quay.io/keycloak/keycloak:latest
    command: ["start-dev"]
    environment:
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
      KC_HEALTH_ENABLED: "true"
    ports:
      - "8080:8080"
    healthcheck:
      # This healthcheck assumes `curl` exists in the image. If it doesn't, remove it and rely on app-level readiness polling.
      test: ["CMD-SHELL", "curl -fsS http://localhost:8080/health/ready || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 40
```

## Bootstrapping Keycloak

You need a realm where tenant clients and users will be created.

Recommended approach:

- Create a realm `platma`.
- Use a dedicated service client to call Admin APIs (preferred for production):
  - client: `platma-provisioner`
  - type: confidential
  - service accounts enabled
  - assign realm-management roles required for:
    - manage-clients
    - manage-users
    - view-realm (as needed)

For a fast dev setup, you can use the built-in admin user + admin-cli. For production, do not.

## Common Workflows

- Start dependencies:
  - `docker-compose up -d`
- Run DB migrations (Prisma/TypeORM)
- Start API:
  - `npm run start:dev`
- Create tenant:
  - `curl -X POST http://localhost:3000/tenants -H 'content-type: application/json' -d '{"tenantName":"Acme","adminEmail":"admin@acme.test"}'`
- Delete tenant:
  - `curl -X DELETE http://localhost:3000/tenants/<id>`

## Troubleshooting Notes

- Keycloak can take time to start; tests should wait for readiness.
- If using realm import, confirm the realm exists after startup via Keycloak admin console.
