# Senior Discussion Guide (Expected Topics + Q&A + Examples)

This document is written as if you are walking an interviewer (or a senior reviewer) through design choices and tradeoffs for this project.

## 1. Clarifying Questions (What I Would Ask Up Front)

1. Should tenant names be globally unique, or do we need a separate immutable tenant key?
2. Do we want one Keycloak realm for all tenants (clients per tenant), or a realm per tenant?
3. What does "register a client and user" mean precisely:
   - do we need a client secret returned?
   - do we need to set an initial password for the admin user?
   - any roles/groups assigned?
4. What should `DELETE /tenants/:id` do if the tenant is already inactive?
   - idempotent success vs `409 Conflict`
5. Do we need to persist generated YAML to disk for audit, or is returning it enough?

My default assumptions for this exercise:

- Shared realm, per-tenant client.
- Delete is idempotent (safe to call multiple times).
- Return YAML in responses; optionally write to disk when configured.

## 2. Architectural Walkthrough (Senior-Level Explanation)

The core constraint here is that we're orchestrating changes across multiple systems (Postgres, Keycloak, and a generated artifact). There is no distributed transaction. So the design goal is: be deterministic, be retryable, and keep the system of record (Postgres) authoritative.

In concrete terms:

- I create the tenant row first and set `status=PROVISIONING`.
- I provision Keycloak and store the resulting correlation identifiers as soon as I have them.
- I generate Kubernetes YAML deterministically from the tenant id/slug so I can re-generate it later.
- Only when all steps succeed do I set `status=ACTIVE`.
- For delete, I transition to `DEPROVISIONING`, disable the Keycloak client, generate delete YAML, then set `INACTIVE`.

This gives me a state machine that supports retries and reconciliation.

## 3. Discussion Points You Should Expect

### Applying Manifests to a Real Cluster

If asked "how would you actually apply this YAML?":

- For a simple extension, I'd use `@kubernetes/client-node` and apply server-side.
- For a production platform, I'd strongly prefer GitOps (commit the YAML and let a reconciler apply it) or an operator/controller (Kubernetes-native reconciliation). Those approaches naturally handle drift, retries, and auditing.

### Handling Partial Failures

If asked "what if Keycloak succeeded but Postgres failed?":

- In the current synchronous approach, I avoid that ordering: Postgres write happens first, so if Postgres fails, I never touch Keycloak.
- The real problem is the opposite: Postgres succeeds but Keycloak fails. That is expected. The correct response is:
  - keep the tenant row in `PROVISIONING` (or `FAILED`)
  - return an error
  - allow retry and/or run reconciliation

If asked "do you compensate?":

- Sometimes yes: if I created a Keycloak client but then user creation failed, I can disable the client as compensation.
- Compensation itself can fail; you need a `FAILED` state and reconciliation logic.

### Idempotency

For create requests, idempotency is important. Clients will retry on network timeouts. Without idempotency, you create duplicate tenants or leave resources half-created.

Senior answer:

- Support `Idempotency-Key` for `POST /tenants`.
- Store key -> tenant id/result mapping.
- Make Keycloak provisioning idempotent (treat "already exists" as success if it matches expectations).

## 4. Senior Q&A (Questions with Answers)

### Q: Prisma or TypeORM, and why?

A: Either works. My default is Prisma when:

- the schema is small and I want fast, explicit migrations
- I want a good developer experience around typing and query building

I'd choose TypeORM when:

- the team already standardized on it
- decorators/entities are the dominant style across the codebase

The key point is not the ORM choice; it's that tenant state and external correlation ids must be persisted in a way that supports retries and reconciliation.

### Q: Why not do everything in a single DB transaction?

A: The DB transaction cannot include Keycloak or Kubernetes operations. The best you can do is use a DB transaction for your own writes, plus a saga for external side effects. If you want stronger guarantees, you use an outbox table in the same DB transaction and perform external actions asynchronously.

### Q: Would you delete Keycloak clients/users on tenant delete?

A: I would disable the client by default, not delete, because:

- it reduces risk of accidental permanent data loss
- it makes "undelete" possible
- it supports audit/compliance

If policy requires deletion, I'd schedule it asynchronously with a retention window.

### Q: How do you ensure Kubernetes resource names are stable and safe?

A: I store a `slug` in Postgres and generate names using `slug + shortTenantId`. I enforce DNS-1123 compliance in code and cap lengths. If names ever need to change, I'd store the generated names in DB so deletes always target the correct resources.

### Q: Would you make `DELETE /tenants/:id` idempotent?

A: Yes. Delete endpoints in distributed systems should be idempotent. If the tenant is already inactive and the Keycloak client is already disabled, returning success makes retries safe.

### Q: How would you test Keycloak integration reliably?

A: Integration tests should run against a real Keycloak container. Keycloak boot is slow, so tests need readiness polling and longer timeouts. I also avoid relying on UI flows; I validate via admin REST calls (client exists, enabled=false, user exists).

## 5. Practical Examples (Senior-Level)

### Example 0: Interview-Style Dialogue (How I’d Explain It)

Interviewer: "This is a pretty small service. Why are you talking about sagas and state machines?"

Senior answer: "Because the moment you touch multiple systems, failure modes become the main problem. A small happy-path implementation looks correct until you have timeouts, retries, and partial provisioning. A minimal state machine makes the behavior explicit, and it’s cheap to implement compared to debugging production drift."

### Example A: Saga-Orchestrated Provisioning (Pseudo-code)

```ts
async createTenant(dto: CreateTenantDto, idempotencyKey?: string) {
  // 1) idempotency check (optional)
  // 2) create row (PROVISIONING)
  const tenant = await db.tenants.create({
    data: {
      name: dto.tenantName,
      slug: slugify(dto.tenantName),
      adminEmail: dto.adminEmail,
      status: "PROVISIONING"
    }
  });

  try {
    // 3) keycloak client
    const kcClientId = buildClientId(tenant);
    await keycloak.ensureClient({ clientId: kcClientId });
    await db.tenants.update({ where: { id: tenant.id }, data: { keycloakClientId: kcClientId } });

    // 4) keycloak user
    await keycloak.ensureUser({ email: tenant.adminEmail });

    // 5) manifests
    const createYaml = manifests.generateCreateYaml(tenant);

    // 6) mark active
    await db.tenants.update({ where: { id: tenant.id }, data: { status: "ACTIVE" } });
    return { tenant, createYaml };
  } catch (e) {
    // Compensation best-effort (do not throw away original error context)
    if (tenant.keycloakClientId) {
      await keycloak.disableClientSafe(tenant.keycloakClientId);
    }
    await db.tenants.update({ where: { id: tenant.id }, data: { status: "FAILED" } });
    throw e;
  }
}
```

Key points:

- external operations happen after the DB row exists
- status tracks progress
- compensation is best-effort

### Example B: Outbox Pattern (What I'd Do in Production)

Instead of provisioning inside the HTTP request:

- Transaction 1 (DB):
  - create tenant row (`PROVISIONING`)
  - insert `tenant_events` outbox row (`TENANT_PROVISION_REQUESTED`)
- Return `202 Accepted` with tenant id.
- Worker consumes outbox events and performs Keycloak + YAML generation, updating tenant status.

This is the standard approach for reliability at scale.

### Example C: Making Keycloak Calls Safe (Timeouts + Retries)

Keycloak calls should have:

- per-request timeout (avoid hanging connections)
- small retry count with jitter on transient failures
- clear mapping of error types (4xx vs 5xx)

In NestJS, I'd encapsulate this in a `KeycloakAdminClient` so callers don't re-implement retry logic.

### Example D: DNS-1123 Slugging for K8s Names

The function must:

- lowercase
- replace invalid chars with `-`
- collapse duplicate `-`
- trim leading/trailing `-`
- ensure max length (63 for labels; names often longer but still have limits)

Persist `slug` once created; do not recompute on every request if tenant name could change.

### Example E: Slugify Implementation (Practical)

```ts
export function toTenantSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug) return "tenant";

  // Keep room for suffixes like "-<shortId>".
  return slug.slice(0, 40).replace(/-$/g, "");
}
```

Senior note: enforce uniqueness at the DB level. If you must support duplicate display names, add a separate immutable `tenantKey` and generate `slug` from that instead of the name.

### Example F: YAML Generation Without String Concatenation

```ts
import { stringify } from "yaml";

export function toMultiDocYaml(docs: object[]): string {
  return docs.map((d) => stringify(d).trimEnd()).join("\n---\n") + "\n";
}
```

Senior note: keep generated YAML free of secrets, and make it deterministic by sorting keys only if you need stable diffs (otherwise, tests should assert on key substrings, not full YAML equality).

### Example G: "Ensure Client" Logic (Conceptual)

```ts
async function ensureClient(clientId: string) {
  const existing = await kc.getClientByClientId(clientId);
  if (existing) {
    if (!existing.enabled) await kc.updateClient(existing.id, { ...existing, enabled: true });
    return existing;
  }

  const createdId = await kc.createClient({ clientId, enabled: true, protocol: "openid-connect" });
  return { id: createdId, clientId, enabled: true };
}
```

Senior note: this is what makes retries safe. A naive `createClient` that throws on 409 turns harmless retries into pager alerts.
