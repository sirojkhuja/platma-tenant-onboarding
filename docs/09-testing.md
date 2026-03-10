# Testing Strategy

The requirement asks for integration tests that walk through `create -> verify -> delete`.

## What "Integration" Means Here

The tests should exercise:

- NestJS HTTP layer (`@nestjs/testing` + SuperTest)
- Real PostgreSQL
- Real Keycloak (via docker-compose)
- Manifest generation logic

Avoid mocking Keycloak for these tests; mock only where unavoidable (for unit tests).

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
- Clean up:
  - Prefer soft delete behavior; tests can re-run without needing to fully delete users/clients, but be careful with uniqueness collisions.

## Example Integration Test Skeleton (Reference)

This is illustrative pseudo-code, not a drop-in file. The actual repo should implement something similar using `@nestjs/testing` and SuperTest.

```ts
import request from "supertest";

function randomSuffix() {
  return Math.random().toString(16).slice(2, 10);
}

async function waitForKeycloakReady() {
  // Poll token endpoint or health endpoint until it responds.
  // Keep it simple: a loop with sleep and an overall timeout.
}

describe("tenants lifecycle", () => {
  beforeAll(async () => {
    jest.setTimeout(120_000);
    await waitForKeycloakReady();
    // start Nest app using Test.createTestingModule(...)
  });

  it("create -> verify -> delete", async () => {
    const tenantName = `acme-${randomSuffix()}`;
    const adminEmail = `admin+${randomSuffix()}@acme.test`;

    const createRes = await request(app.getHttpServer())
      .post("/tenants")
      .send({ tenantName, adminEmail })
      .expect(201);

    const tenantId = createRes.body.id;
    expect(createRes.body.manifests.createYaml).toContain("kind: Deployment");

    // Verify in DB (via repository/Prisma client) and via Keycloak admin calls.

    const deleteRes = await request(app.getHttpServer()).delete(`/tenants/${tenantId}`).expect(200);

    expect(deleteRes.body.status).toBe("INACTIVE");
    expect(deleteRes.body.manifests.deleteYaml).toContain("kind: Service");
  });
});
```

## Optional: Testcontainers

If you want fully isolated tests without depending on `docker-compose up`, consider Testcontainers:

- Start Postgres and Keycloak per test suite.
- Seed realm configuration automatically.

This is more work but yields more reproducible CI behavior.
