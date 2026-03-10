# Requirements

## Goal

Build a NestJS service that onboards and offboards tenants across:

- PostgreSQL (system of record for tenants)
- Keycloak (identity provisioning: per-tenant client and admin user)
- Kubernetes (generate, but do not apply, per-tenant Node-RED Deployment + Service YAML)

## Functional Requirements

### Create Tenant (`POST /tenants`)

Input:

- Tenant name
- Admin email

Behavior:

1. Persist tenant record in PostgreSQL.
2. Provision Keycloak using the Admin REST API:
   - Create/register a Keycloak client for the tenant.
   - Create/register a Keycloak user for the tenant admin.
3. Generate Kubernetes YAML manifest for a per-tenant Node-RED instance:
   - Deployment + Service
   - Either return YAML in response or write it to disk (configurable; see docs).

### Delete Tenant (`DELETE /tenants/:id`)

Behavior:

1. Mark the tenant as inactive in PostgreSQL (soft deletion).
2. Disable the Keycloak client associated with the tenant.
3. Produce a "delete manifest" that corresponds to the create manifest, suitable for `kubectl delete -f`.

## Non-Goals (Explicit)

- Actually applying manifests to a real Kubernetes cluster.
- Fully-featured multi-tenant authorization model for the service itself (beyond basic service security).
- Complex role/permission mapping inside Keycloak beyond "client exists" and "admin user exists".

## Configuration Requirements

- All connection strings, URLs, credentials, and secrets must be provided via `@nestjs/config`.
- Support a local development environment through `docker-compose` running:
  - PostgreSQL
  - Keycloak

## Testing Requirements

- Integration tests using `@nestjs/testing` must cover:
  - Create tenant
  - Verify side effects (DB row, Keycloak objects, generated YAML)
  - Delete tenant
  - Verify side effects reversed (inactive DB state, client disabled, delete YAML)

## Acceptance Criteria (Concrete)

- `POST /tenants` returns `201` and includes a stable tenant identifier.
- On create, tenant is persisted with enough metadata to allow delete to find/disable the correct Keycloak client and regenerate the same manifest names.
- `DELETE /tenants/:id` returns `200` (or `204`) and results in:
  - tenant `isActive=false` (or `status=INACTIVE`)
  - Keycloak client `enabled=false`
  - delete YAML generated/returned
- Config is env-driven; no hardcoded secrets.
- Integration tests run against local Postgres + Keycloak and pass reliably.

## Assumptions (Make Explicit in Code/Docs)

- Tenant name uniqueness: recommended to enforce a unique "slug" derived from name (or accept a separate `tenantKey`).
- Tenant admin user:
  - Minimum: user exists with email/username set.
  - Password flow for dev/tests should be deterministic if tests require login; otherwise avoid.
- Keycloak organization model:
  - Recommended: one shared realm for the platform, one client per tenant.
  - Alternate: realm per tenant (heavier, but stronger isolation). The initial scope uses shared realm.
