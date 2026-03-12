# Platma Tenant Onboarding

NestJS service that implements the lifecycle described in `TZ.md`.

## Implemented Scope

- `POST /tenants`
  - creates a tenant record in PostgreSQL via TypeORM
  - provisions a Keycloak client and admin user via the Admin REST API
  - generates Kubernetes YAML for a per-tenant Node-RED `Deployment` and `Service`
- `DELETE /tenants/:id`
  - marks the tenant as inactive in PostgreSQL
  - disables the corresponding Keycloak client
  - generates the matching delete manifest
- `GET /health`
  - simple health endpoint for the API

The service generates manifests only. It does not apply them to a live Kubernetes cluster, which matches the task scope in `TZ.md`.

## Stack

- NestJS + Fastify
- TypeScript
- PostgreSQL + TypeORM
- Keycloak Admin REST API
- `@nestjs/config` with environment validation
- Jest + `@nestjs/testing`

## Project Structure

- `src/tenants`: HTTP endpoints and tenant lifecycle orchestration
- `src/keycloak`: token handling and Keycloak Admin API integration
- `src/manifests`: deterministic Kubernetes YAML generation
- `src/database`: database configuration
- `test`: unit/e2e and integration tests
- `docker-compose.yml`: local PostgreSQL + Keycloak

## Local Setup

1. Start local dependencies:

```bash
docker compose up -d
```

2. Copy environment file:

```bash
cp .env.example .env
```

3. Install dependencies and run the API:

```bash
npm install
npm run start:dev
```

By default:

- API: `http://localhost:3000`
- Keycloak: `http://localhost:8080`
- Postgres: `localhost:5432`

If you override `KEYCLOAK_PORT` in your shell or local environment, also update `KEYCLOAK_BASE_URL` in `.env` to match.

## API Usage

Create tenant:

```bash
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenantName":"Acme Corp","adminEmail":"admin@acme.test"}'
```

Delete tenant:

```bash
curl -X DELETE http://localhost:3000/tenants/<tenant-id>
```

## Tests

- Unit/e2e: `npm test`
- Integration: `npm run test:integration`
- Full verification: `npm run verify:integration`

Integration tests require local PostgreSQL and Keycloak from `docker compose up -d`.
