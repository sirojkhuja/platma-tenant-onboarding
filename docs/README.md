# Project Docs (Platma Tenant Onboarding)

This documentation set describes how to implement and operate the NestJS "tenant onboarding" service described in [TZ.md](../TZ.md).

The core behavior:

- `POST /tenants`: create a tenant record in Postgres, provision Keycloak (client + admin user), generate Kubernetes YAML, and optionally apply a live per-tenant Node-RED instance to Kubernetes.
- `GET /tenants/:id`: inspect the stored tenant state and runtime metadata.
- `DELETE /tenants/:id`: mark tenant inactive in Postgres, disable the Keycloak client, and delete the corresponding Kubernetes resources when apply mode is enabled.

Kubernetes apply/delete is now optional and controlled by configuration (`K8S_DEPLOY_MODE=manifest|apply`).

## Contents

- [01-requirements.md](./01-requirements.md): functional scope, non-goals, assumptions, acceptance criteria.
- [02-architecture.md](./02-architecture.md): module boundaries, flows, state machine, data model, idempotency, error strategy.
- [03-api.md](./03-api.md): endpoint contracts, examples, error codes, idempotency guidance.
- [04-configuration.md](./04-configuration.md): environment variables, config validation, secrets.
- [05-local-development.md](./05-local-development.md): docker-compose expectations, bootstrapping Keycloak for dev, common workflows.
- [06-database.md](./06-database.md): schema proposal (Prisma/TypeORM-friendly), constraints, migrations notes.
- [07-keycloak.md](./07-keycloak.md): Admin REST API usage, token strategy, recommended realm/client setup, pitfalls.
- [08-k8s-manifests.md](./08-k8s-manifests.md): YAML generation strategy, naming rules, example manifests.
- [09-testing.md](./09-testing.md): integration test plan (create -> verify -> delete), reliability tips.
- [10-failure-handling.md](./10-failure-handling.md): partial failures, retries/timeouts, sagas/compensations, outbox approach.
- [11-production-readiness.md](./11-production-readiness.md): how to extend to apply manifests, security/ops, scaling, CI/CD.
- [12-senior-discussion.md](./12-senior-discussion.md): expected discussion points + senior-level Q&A + practical examples.
- [13-implementation-checklist.md](./13-implementation-checklist.md): pragmatic build checklist (what to implement, in what order).
- [14-node-red-runtime.md](./14-node-red-runtime.md): how the live Node-RED runtime mode works, what gets deployed, and how to test it locally.
