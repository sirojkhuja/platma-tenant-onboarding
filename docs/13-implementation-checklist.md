# Implementation Checklist (Status-Tracked)

This is the execution checklist for implementing the service described in [TZ.md](../TZ.md).

Workflow per task (required):

1. Set task status to `IN_PROGRESS`.
2. Implement.
3. Test.
4. Lint.
5. Format.
6. Verify behavior manually where applicable.
7. Mark task `DONE`.
8. `git commit` and `git push`.

## Decisions (Locked In)

These decisions are made up front to keep momentum and avoid "architecture churn":

- Runtime/framework: NestJS + Fastify, TypeScript.
- Config: `@nestjs/config` + zod validation (fail fast).
- ORM: TypeORM + Postgres (`pg` driver).
  - IDs: app-generated UUIDs (no DB extension dependency).
  - DB schema: `synchronize=true` in dev/test for this exercise. For production, add migrations (documented in docs).
- Tenant lifecycle: `status` enum (`PROVISIONING`, `ACTIVE`, `DEPROVISIONING`, `INACTIVE`, `FAILED`).
- Delete semantics: idempotent (`DELETE` on an already-inactive tenant returns success with current state).
- Keycloak auth (dev): password grant using the built-in Keycloak admin user.
  - Token realm defaults to `master` (`KEYCLOAK_TOKEN_REALM=master`).
  - Client id defaults to `admin-cli`.
  - Also support `client_credentials` for production-like usage.
- Keycloak provisioning approach: "ensure" semantics for client/user to make retries safe.
- Manifests: generate multi-document YAML (Deployment + Service) using the `yaml` npm package.
  - Default output mode: include YAML in HTTP response.
  - Optional output mode: also write to disk (`MANIFEST_OUTPUT_MODE=both|disk`).
  - Node-RED image: pinned tag (not `latest`).
- Tests: Jest + `@nestjs/testing` + SuperTest e2e tests against real Postgres + Keycloak (docker-compose).

## Task List

Status values: `TODO`, `IN_PROGRESS`, `DONE`

1. Task: Repo bootstrap (root README, `.gitignore`, tooling scripts, base CI-ish scripts in `package.json`)
   Status: DONE
2. Task: NestJS app skeleton (ConfigModule + zod validation, global pipes, request id + logging)
   Status: DONE
3. Task: Database layer (TypeORM config, Tenant entity, repository/service, status enum, uniqueness on slug)
   Status: DONE
4. Task: Manifests module (slugify, deterministic names, YAML generation, disk output option)
   Status: DONE
5. Task: Keycloak module (token, admin REST calls, ensure client/user, disable client, timeouts/retries)
   Status: DONE
6. Task: Tenants module (POST/DELETE endpoints, orchestration, error mapping, idempotent delete)
   Status: DONE
7. Task: Local dev environment (docker-compose for Postgres + Keycloak, realm import file, docs update if needed)
   Status: DONE
8. Task: Integration tests (create -> verify -> delete against Postgres + Keycloak + YAML assertions)
   Status: TODO
9. Task: Lint/format/test hardening (eslint + prettier + jest config, run full suite cleanly)
   Status: TODO
10. Task: Final verification + polish (manual curl flow, docs aligned, progress 100%)
    Status: TODO
