# Testing Strategy

The requirement asks for integration tests that walk through `create -> verify -> delete`.

## What "Integration" Means Here

The tests should exercise:

- NestJS HTTP layer (`@nestjs/testing` + NestJS Fastify adapter)
  - The test harness uses `app.inject()` so tests do not need to bind a TCP port (`app.listen()`).
- Real PostgreSQL
- Real Keycloak (via docker-compose)
- Manifest generation logic

Avoid mocking Keycloak for these tests; mock only where unavoidable (for unit/e2e tests that must run without docker-compose).

## Test Suites In This Repo

- Unit/e2e (default `npm test`):
  - Keycloak is mocked.
  - DB defaults to SQL.js in-memory (`NODE_ENV=test` + `DATABASE_DRIVER` not set to `postgres`).
- Integration (`npm run test:integration`):
  - Uses real Postgres + Keycloak (docker-compose).
  - Still uses `app.inject()` (no TCP bind).

## Test Cases (Minimum)

1. Create tenant:
   - `POST /tenants` returns `201`
   - response has `id`, `slug`, and `createYaml`
2. Verify side effects:
   - tenant row exists in DB and is ACTIVE
   - Keycloak client exists and is enabled
   - Keycloak user exists and is enabled
   - YAML contains expected resource names/labels
3. Delete tenant:
   - `DELETE /tenants/:id` returns `200`
4. Verify reversal:
   - tenant status is INACTIVE
   - Keycloak client is disabled
   - delete YAML contains the same resource names as create YAML

## Reliability Tips

- Implement Keycloak readiness polling in test setup (wait for token endpoint).
- Use unique tenant names per test run (include random suffix) unless you implement idempotency cleanup.
- Timeouts:
  - Keycloak may be slow on cold start; set Jest timeouts accordingly.
- Clean up: prefer soft delete behavior; tests can re-run without needing to fully delete users/clients, but be careful with uniqueness collisions.

## Example Integration Test Skeleton (Reference)

This is illustrative pseudo-code, not a drop-in file. The actual repo should implement something similar using `@nestjs/testing` + `app.inject()`.

```ts
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module";

function randomSuffix() {
  return Math.random().toString(16).slice(2, 10);
}

async function waitForKeycloakReady() {
  // Poll token endpoint or health endpoint until it responds.
  // Keep it simple: a loop with sleep and an overall timeout.
}

describe("tenants lifecycle", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    jest.setTimeout(120_000);
    await waitForKeycloakReady();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
  });

  it("create -> verify -> delete", async () => {
    const tenantName = `acme-${randomSuffix()}`;
    const adminEmail = `admin+${randomSuffix()}@acme.test`;

    const createRes = await app.inject({
      method: "POST",
      url: "/tenants",
      payload: { tenantName, adminEmail },
    });
    expect(createRes.statusCode).toBe(201);

    const created = createRes.json() as any;
    const tenantId = created.id;
    expect(created.manifests.createYaml).toContain("kind: Deployment");

    // Verify in DB (via repository/Prisma client) and via Keycloak admin calls.

    const deleteRes = await app.inject({ method: "DELETE", url: `/tenants/${tenantId}` });
    expect(deleteRes.statusCode).toBe(200);

    const deleted = deleteRes.json() as any;
    expect(deleted.status).toBe("INACTIVE");
    expect(deleted.manifests.deleteYaml).toContain("kind: Service");
  });
});
```

## Optional: Testcontainers

If you want fully isolated tests without depending on `docker-compose up`, consider Testcontainers:

- Start Postgres and Keycloak per test suite.
- Seed realm configuration automatically.

This is more work but yields more reproducible CI behavior.
