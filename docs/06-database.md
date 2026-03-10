# Database

This document proposes a schema that works well for either Prisma or TypeORM.

## Tenants Table (Proposed)

Fields:

- `id` (UUID, primary key)
- `name` (string, original display name)
- `slug` (string, DNS-safe key used for Keycloak/K8s naming)
- `adminEmail` (string)
- `status` (enum: PROVISIONING, ACTIVE, DEPROVISIONING, INACTIVE, FAILED)
- `isActive` (boolean, optional if you prefer derived from status)
- `keycloakClientId` (string, the clientId used in Keycloak)
- `keycloakUserId` (string, optional)
- `createdAt`, `updatedAt`

Constraints:

- unique index on `slug`
- optionally unique on `name` if you want strict name uniqueness
- index on `status` for reconciliation jobs

## Idempotency (Optional but Recommended)

If you support `Idempotency-Key` on create:

Table `idempotency_keys`:

- `key` (string, PK/unique)
- `method` (string)
- `path` (string)
- `requestHash` (string, optional)
- `responseCode` (int)
- `responseBody` (jsonb)
- `createdAt`

This provides safe retries even if the client repeats requests due to timeouts.

## Migrations

- Prisma: use `prisma migrate dev` for local and `prisma migrate deploy` in CI/CD.
- TypeORM: use migration files and run them on startup or via pipeline.

In either case, ensure:

- no destructive migrations in production without approval
- migrations are deterministic and tracked
