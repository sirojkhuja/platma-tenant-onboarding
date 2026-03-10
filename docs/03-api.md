# API Contract

This is a proposed API contract consistent with TZ.md. If you change it, keep it stable and update integration tests accordingly.

## `POST /tenants`

### Request

`Content-Type: application/json`

```json
{
  "tenantName": "Acme Corp",
  "adminEmail": "admin@acme.example"
}
```

Recommended headers:

- `Idempotency-Key: <uuid>` for safe retries
- `X-Request-Id: <uuid>` for tracing/logging

### Response (201)

```json
{
  "id": "b4b1e8b6-4d71-4e1d-a28c-2d4a0f6f1c9b",
  "name": "Acme Corp",
  "slug": "acme-corp",
  "adminEmail": "admin@acme.example",
  "status": "ACTIVE",
  "keycloak": {
    "clientId": "tenant-acme-corp-b4b1e8b6",
    "adminUsername": "admin@acme.example"
  },
  "manifests": {
    "createYaml": "---\napiVersion: apps/v1\nkind: Deployment\n..."
  }
}
```

Notes:

- Do not return Keycloak client secrets in API responses.
- If writing manifests to disk, you can include:
  - `manifests.createPath` alongside `createYaml`, or omit YAML and return only the path (but tests should validate something deterministically).

### Errors

- `400`: validation errors (missing name/email, invalid email, etc.)
- `409`: tenant slug already exists (or tenantName unique constraint)
- `502`: upstream Keycloak failure
- `500`: unexpected internal failures

## `DELETE /tenants/:id`

### Response (200)

```json
{
  "id": "b4b1e8b6-4d71-4e1d-a28c-2d4a0f6f1c9b",
  "status": "INACTIVE",
  "keycloak": {
    "clientEnabled": false
  },
  "manifests": {
    "deleteYaml": "---\napiVersion: apps/v1\nkind: Deployment\n..."
  }
}
```

You may also choose `204 No Content`, but returning a body is useful for tests and consumers.

### Errors

- `404`: unknown tenant id
- `409`: tenant is already inactive (optional; you can make delete idempotent and return success)
- `502`: Keycloak failure
- `500`: internal failures

## Idempotency Guidance

Recommended behavior:

- `POST /tenants`:
  - If `Idempotency-Key` is new: process request and store response metadata.
  - If key already exists: return the previously stored result.
- `DELETE /tenants/:id`:
  - Prefer idempotent delete: deleting an inactive tenant returns `200` with current state.
