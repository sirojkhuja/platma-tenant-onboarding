# Platma Tenant Onboarding (NestJS)

Tenant lifecycle service:

- `POST /tenants`: persist tenant in PostgreSQL, provision Keycloak (client + admin user), and generate Kubernetes YAML (Deployment + Service) for a per-tenant Node-RED instance.
- `DELETE /tenants/:id`: mark tenant inactive, disable Keycloak client, and generate corresponding "delete" YAML.

Docs live in [docs/README.md](./docs/README.md).

## Quickstart (Local)

1. Start dependencies:

```bash
docker compose up -d
```

2. Configure env:

```bash
cp .env.example .env
```

3. Install and run:

```bash
npm install
npm run start:dev
```

4. Create a tenant:

```bash
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenantName":"Acme Corp","adminEmail":"admin@acme.test"}'
```

## Tests

- Unit/e2e (no external deps): `npm test`
- Integration (requires Postgres + Keycloak): `docker compose up -d && npm run test:integration`
- Full local check: `npm run verify:integration`
