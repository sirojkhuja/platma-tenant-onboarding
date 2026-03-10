# Failure Handling

This service spans multiple systems. Partial failures are normal, so design for them.

## Typical Failure Scenarios

- DB insert succeeds, Keycloak client creation fails.
- Keycloak client succeeds, user creation fails.
- Keycloak succeeds, manifest generation fails.
- Delete: DB marks inactive but Keycloak disable fails (or vice versa).

## Minimal Viable Strategy (Synchronous)

You can start with a synchronous request model, but you must:

- Use explicit timeouts for Keycloak HTTP calls.
- Return clear errors (`502` for upstream Keycloak issues).
- Keep enough state in DB to retry safely.

Recommended: store `status` and external ids as soon as they are known.

## Compensating Transactions (Saga)

Because you cannot do a distributed transaction across Postgres + Keycloak, use a saga approach:

Create saga (orchestration pattern):

1. DB: create tenant (`PROVISIONING`)
2. Keycloak: create client
3. Keycloak: create user
4. Manifests: generate YAML
5. DB: mark tenant `ACTIVE`

If step 3 fails after step 2 succeeded, compensation can be:

- disable the client (or delete it) to return to a consistent "not provisioned" state

If compensation also fails, mark tenant `FAILED` and require retry/reconciliation.

## Outbox Pattern (Recommended for Production)

Instead of doing everything in the HTTP request, you can:

- write tenant row + an "outbox event" in a single DB transaction
- return `202 Accepted` quickly
- process provisioning asynchronously in a worker

Benefits:

- more resilient to Keycloak slowness/outages
- safe retries via outbox semantics

This is likely the most senior answer in a real system, but it changes the API contract.

## Idempotency and Retries

- Implement idempotency key support for POST.
- Make provisioning steps idempotent:
  - create client: if exists, treat as success if enabled and config matches
  - create user: if exists, treat as success
- Retry policy:
  - retry only on safe, transient errors (timeouts, 5xx)
  - use small retry counts with jitter
- Avoid retrying on 4xx errors except 409-like conflicts where you can safely treat it as already-created.

## Concurrency

Protect against parallel requests:

- Unique constraint on tenant slug prevents duplicate tenants.
- For delete vs create races, use DB row locking or status checks:
  - if `status=PROVISIONING`, deleting might either:
    - block and wait, or
    - mark as `DEPROVISIONING` and let reconciliation handle it
