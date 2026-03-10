# Kubernetes Manifest Generation

The service generates (but does not apply) Kubernetes YAML for a hypothetical per-tenant Node-RED instance.

## Naming Rules

Kubernetes names must be DNS-1123 compatible and within length limits.

Recommendations:

- Derive a stable `tenantSlug` (lowercase, alphanumeric + `-` only, trim to safe length).
- Include a short suffix from tenant UUID to avoid collisions.

Example names:

- Deployment: `nodered-acme-corp-b4b1e8b6`
- Service: `nodered-acme-corp-b4b1e8b6`

## Labels

Add labels that make ownership explicit:

- `app: nodered`
- `tenantId: <uuid>`
- `tenantSlug: <slug>`

These labels help with debugging, cleanup, and future automation.

## Manifest Format

Prefer generating YAML from JS objects using a YAML library. Avoid string concatenation to reduce escaping bugs.

## Example Create Manifest (Deployment + Service)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nodered-acme-corp-b4b1e8b6
  labels:
    app: nodered
    tenantId: b4b1e8b6-4d71-4e1d-a28c-2d4a0f6f1c9b
    tenantSlug: acme-corp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nodered
      tenantId: b4b1e8b6-4d71-4e1d-a28c-2d4a0f6f1c9b
  template:
    metadata:
      labels:
        app: nodered
        tenantId: b4b1e8b6-4d71-4e1d-a28c-2d4a0f6f1c9b
        tenantSlug: acme-corp
    spec:
      containers:
        - name: nodered
          image: nodered/node-red:latest
          ports:
            - containerPort: 1880
---
apiVersion: v1
kind: Service
metadata:
  name: nodered-acme-corp-b4b1e8b6
  labels:
    app: nodered
    tenantId: b4b1e8b6-4d71-4e1d-a28c-2d4a0f6f1c9b
    tenantSlug: acme-corp
spec:
  selector:
    app: nodered
    tenantId: b4b1e8b6-4d71-4e1d-a28c-2d4a0f6f1c9b
  ports:
    - name: http
      port: 80
      targetPort: 1880
```

## Delete Manifest

For `kubectl delete -f`, the "delete manifest" is typically the same resource definitions.

Practical approach:

- Generate the same YAML as create, but in API response name it `deleteYaml` and, if writing to disk, use a `*-delete.yaml` filename.

## Production Considerations (Future)

- Add resource requests/limits.
- Add liveness/readiness probes.
- Use a pinned image tag (not `latest`).
- Use namespaces (per tenant or shared) depending on isolation requirements.
