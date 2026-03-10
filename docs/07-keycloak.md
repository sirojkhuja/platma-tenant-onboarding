# Keycloak Integration

This document focuses on using Keycloak Admin REST APIs to provision tenant resources.

## Recommended Model

- One shared realm (example: `platma`)
- One client per tenant (example clientId: `tenant-${slug}-${shortTenantId}`)
- One user per tenant admin (username/email: `adminEmail`)

Alternate model (not required here):

- Realm per tenant (stronger isolation, higher operational overhead)

## Authentication to the Admin API

There are two common approaches:

1. Use Keycloak admin user credentials (dev only).
2. Use a dedicated confidential client with service account (recommended for production).

Token endpoint (varies by realm):

- `POST {KEYCLOAK_BASE_URL}/realms/{tokenRealm}/protocol/openid-connect/token`

Important note:

- If you authenticate as the built-in Keycloak admin user (from `KEYCLOAK_ADMIN`), that user typically lives in the `master` realm.
- If you authenticate via a service account client you created inside `platma`, the token realm will be `platma`.

Grant types:

- `password` grant (admin username/password)
- `client_credentials` grant (service account)

In production, prefer `client_credentials` with least privileges.

## Minimum Permissions (Service Account)

If you use a provisioner client with a service account, grant only what you need. For this exercise, typical realm-management roles include:

- `manage-clients`
- `view-clients`
- `manage-users`
- `view-users`

Exact role names can vary slightly depending on Keycloak version and configuration. Verify in the Keycloak admin console under `Client roles -> realm-management`.

## Bootstrap (UI Steps)

Fast dev setup in the admin console:

1. Create realm: `platma`
2. Create client: `platma-provisioner`
   - Client type: OpenID Connect
   - Client authentication: ON (confidential)
   - Service accounts: ON
3. Assign roles to the service account:
   - Realm `platma` -> Clients -> `realm-management` -> assign needed roles (see above)
4. Store the client secret and configure the service to use `client_credentials`.

## Bootstrap (kcadm.sh Reference)

If you prefer CLI bootstrapping, the `kcadm.sh` tool inside the Keycloak container can do it.

1. Authenticate against `master` realm:

```bash
/opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user admin \
  --password admin
```

2. Create realm:

```bash
/opt/keycloak/bin/kcadm.sh create realms -s realm=platma -s enabled=true
```

3. Create provisioner client:

```bash
/opt/keycloak/bin/kcadm.sh create clients -r platma \
  -s clientId=platma-provisioner \
  -s enabled=true \
  -s protocol=openid-connect \
  -s publicClient=false \
  -s serviceAccountsEnabled=true \
  -s standardFlowEnabled=false \
  -s directAccessGrantsEnabled=false
```

4. Assign roles to the service account:

The exact commands are verbose and version-dependent. The reliable approach is:

- Find the provisioner client UUID in realm `platma`
- Find the service account user for that client
- Map realm-management roles to that service account user

If the repository later includes a bootstrap script, prefer that over hand-running these steps.

## Token Request Examples

Password grant (dev-only, typically `tokenRealm=master`):

```bash
curl -sS -X POST \
  "$KEYCLOAK_BASE_URL/realms/$KEYCLOAK_TOKEN_REALM/protocol/openid-connect/token" \
  -H "content-type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=$KEYCLOAK_CLIENT_ID" \
  -d "username=$KEYCLOAK_ADMIN_USERNAME" \
  -d "password=$KEYCLOAK_ADMIN_PASSWORD"
```

Client credentials (preferred for prod, token realm is typically `platma`):

```bash
curl -sS -X POST \
  "$KEYCLOAK_BASE_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/token" \
  -H "content-type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$KEYCLOAK_CLIENT_ID" \
  -d "client_secret=$KEYCLOAK_CLIENT_SECRET"
```

## Admin REST Calls (Typical)

Base:

- `{KEYCLOAK_BASE_URL}/admin/realms/{realm}`

### Create Client

- `POST /clients`

Minimal payload (example):

```json
{
  "clientId": "tenant-acme-corp-b4b1e8b6",
  "enabled": true,
  "protocol": "openid-connect",
  "publicClient": false,
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false
}
```

Notes:

- If you need a client secret, you can fetch it after create (Keycloak exposes it via dedicated endpoints).
- Consider setting `redirectUris` and `webOrigins` only when the consumer is defined.

### Create User

- `POST /users`

Minimal payload:

```json
{
  "username": "admin@acme.example",
  "email": "admin@acme.example",
  "enabled": true,
  "emailVerified": false
}
```

If you set an initial password (often useful for tests), use:

- `PUT /users/{id}/reset-password`

### Disable Client

You typically:

1. Find the client internal id by `clientId`:
   - `GET /clients?clientId=tenant-acme-corp-b4b1e8b6`
2. Update the client representation with `enabled=false`:
   - `PUT /clients/{internalId}`

Do not delete by default; disabling is safer and reversible.

## Practical Pitfalls

- Keycloak "clientId" is not always the same as the internal UUID used in admin endpoints.
- Some endpoints return `201` with `Location` header; you may need to parse it to get the created entity id.
- If you plan to run integration tests repeatedly, make create idempotent:
  - if client exists, treat as success if configuration matches expected
  - same for user existence
- Always set HTTP timeouts; Keycloak startup in docker-compose can be slow.

## Recommended "Ensure" Semantics

Senior-grade provisioning is usually written as "ensure X exists", not "blindly create X":

- `ensureClient(clientId)`: creates if missing; if exists, updates only if needed.
- `ensureUser(username/email)`: creates if missing; if exists, ensures it is enabled.

This makes retries safe and makes your integration tests much less flaky.
