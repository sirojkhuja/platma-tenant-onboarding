# Architecture

## High-Level Components

- **HTTP API (NestJS)**: receives tenant lifecycle requests.
- **Database (PostgreSQL)**: source of truth for tenant state and correlation IDs to external systems.
- **Keycloak Provisioner**: integrates with Keycloak Admin REST API to create/disable clients and create admin users.
- **Manifest Generator**: deterministically generates Kubernetes YAML for Node-RED Deployment + Service.

## Recommended NestJS Module Layout

This is a pragmatic layout that keeps boundaries clean:

- `TenantsModule`
  - `TenantsController` (HTTP)
  - `TenantsService` (orchestration)
  - `TenantRepository` (DB access, wraps Prisma/TypeORM)
- `KeycloakModule`
  - `KeycloakAdminClient` (token + HTTP calls)
  - `KeycloakProvisioningService` (create client/user, disable client)
- `ManifestsModule`
  - `ManifestService` (generate YAML, optionally write to disk)
  - `K8sNaming` (slug + DNS-1123 helpers)
- `ConfigModule` (`@nestjs/config`)

Avoid mixing HTTP, persistence, and Keycloak logic in one service. Keep orchestration in `TenantsService`.

## Tenant State Model (Recommended)

Single boolean `isActive` is sufficient for the requirement, but you will quickly want a state machine for robustness.

Recommended `status` enum:

- `PROVISIONING`
- `ACTIVE`
- `DEPROVISIONING`
- `INACTIVE`
- `FAILED`

This enables safe retries and correct behavior on partial failures.

## Create Flow (Sequence)

Target behavior for `POST /tenants`:

1. Validate input; compute `tenantSlug`.
2. Insert tenant row in DB with `status=PROVISIONING`.
3. Provision Keycloak:
   - Create tenant client (store `keycloakClientId` and/or internal UUID)
   - Create tenant admin user (store `keycloakUserId` or username)
4. Generate manifest:
   - `Deployment` and `Service` names based on stable identifiers (prefer slug + tenant id suffix)
   - Return YAML and/or write to `MANIFEST_OUTPUT_DIR`
5. Update tenant row: `status=ACTIVE`.

### Why create DB row first?

- You need a durable, internal id to correlate external actions.
- It allows retries and reconciliation if the request crashes mid-flight.

## Delete Flow (Sequence)

Target behavior for `DELETE /tenants/:id`:

1. Load tenant by id.
2. Update DB: `status=DEPROVISIONING` (or directly `isActive=false` if you keep it minimal).
3. Disable Keycloak client (`enabled=false`).
4. Generate "delete manifest" (same resource definitions, intended for `kubectl delete -f`).
5. Update DB: `status=INACTIVE`.

If Keycloak disable fails, do not mark tenant INACTIVE; return failure and keep state for retry.

## Deterministic Naming (Critical)

You must be able to regenerate the same K8s names at delete time. Options:

- Persist all generated resource names in DB; or
- Derive them deterministically from immutable fields (recommended):
  - `tenantSlug` (persisted)
  - `tenantId` (immutable)

Example:

- Deployment: `nodered-${tenantSlug}-${shortId}`
- Service: `nodered-${tenantSlug}-${shortId}`
- Labels: `tenantId`, `tenantSlug`, `app=nodered`

Where `shortId` is the first 8 chars of a UUID (or another deterministic truncation), keeping under Kubernetes name limits.

## Storage Strategy for Manifests

Pick one:

1. **Return in response only** (stateless API): simplest, good for platforms that persist outputs elsewhere.
2. **Write to disk** (audit/debug): return YAML and also write to `MANIFEST_OUTPUT_DIR`.

If you write to disk, ensure:

- directory exists and is configurable
- file naming uses tenant id and action (`create`/`delete`)
- no secrets are embedded in YAML

## Error Handling and Idempotency

At minimum:

- Treat `tenantName` duplicates as `409 Conflict`.
- Treat delete for unknown id as `404 Not Found`.

For robustness:

- Add `Idempotency-Key` header support on `POST /tenants`.
- Store the idempotency key + resulting tenant id in DB with unique constraint.
- If the same key is re-used, return the original result.

## Observability

Even in a small service, add:

- request correlation id (header `X-Request-Id`, generate if missing)
- structured logs with tenant id/slug
- explicit timeouts around Keycloak HTTP calls
