# Production Readiness

This section covers how you would extend the service beyond the exercise.

## Applying Manifests for Real

Options:

1. Kubernetes API client from Node.js (e.g. `@kubernetes/client-node`):
   - Use server-side apply
   - Use a dedicated service account with scoped RBAC
2. GitOps approach:
   - Commit generated manifests to a repo
   - Let ArgoCD/Flux reconcile
3. Operator/Controller pattern:
   - Define a custom resource `Tenant`
   - A controller reconciles it into Deployments/Services

For a platform team, (2) or (3) is typically the most robust long-term approach.

## Security

- Do not use Keycloak admin username/password in production.
- Use service account client credentials with least privilege.
- Encrypt sensitive fields at rest if you store any (ideally store none).
- Add authentication/authorization to the onboarding API itself.

## Observability

- Structured logging (JSON) including request id, tenant id/slug.
- Metrics:
  - provisioning latency
  - Keycloak call latency and error counts
  - number of tenants by status
- Tracing: OpenTelemetry is worth it when multiple systems are involved.

## Reliability

- Move provisioning to async worker (outbox pattern).
- Add reconciliation job:
  - finds tenants stuck in PROVISIONING/DEPROVISIONING/FAILED
  - retries or alerts
- Rate-limit and backoff Keycloak calls.

## Operations

- Health checks:
  - liveness: process is alive
  - readiness: DB reachable; optionally Keycloak reachable (or degrade)
- Migrations run in CI/CD, not on every pod boot (depending on your standard).

## CI/CD

- Run lint/unit tests quickly.
- Run integration tests with container dependencies.
- Build and scan container images.
- Promote via environments.
