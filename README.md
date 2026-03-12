# Platma Tenant Onboarding (NestJS)

Tenant lifecycle service:

- `POST /tenants`: persist tenant in PostgreSQL, provision Keycloak (client + admin user), generate Kubernetes YAML, and optionally apply a real per-tenant Node-RED workload to Kubernetes.
- `GET /tenants/:id`: inspect stored tenant, Keycloak, and Node-RED runtime metadata.
- `DELETE /tenants/:id`: mark tenant inactive, disable the Keycloak client, generate the corresponding delete YAML, and optionally delete the live Kubernetes resources.

Docs live in [docs/README.md](./docs/README.md).

## Quickstart (Manifest Mode)

1. Start dependencies:

```bash
docker compose up -d
```

2. Configure env:

```bash
cp .env.example .env
```

3. Install and run:

```bash
npm install
npm run start:dev
```

4. Create a tenant:

```bash
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenantName":"Acme Corp","adminEmail":"admin@acme.test"}'
```

This default mode only generates manifests and stores runtime metadata. It does not apply anything to Kubernetes.

## Quickstart (Live Node-RED on Kubernetes)

Prerequisites:

- Docker
- `kubectl`
- `kind`

1. Start Postgres and Keycloak:

```bash
npm run dev:deps:up
```

2. Create a local kind cluster:

```bash
npm run dev:k8s:up
```

3. Configure env:

```bash
cp .env.example .env
```

Set at least:

```bash
K8S_DEPLOY_MODE=apply
K8S_KUBECONFIG_PATH=$HOME/.kube/config
NODE_RED_PASSWORD_SEED=replace-this-with-a-real-secret
NODE_RED_SERVICE_TYPE=NodePort
```

4. Start the API:

```bash
npm install
npm run start:dev
```

5. Run the end-to-end smoke flow:

```bash
PATH="$HOME/.local/bin:$PATH" npm run smoke:runtime
```

The smoke script creates a tenant, waits for Node-RED to roll out, verifies the editor page and protected `/flows` endpoint, deletes the tenant, and confirms cleanup.

In `NodePort` mode, the create response includes `nodeRed.editorUrl`, for example `http://192.168.32.3:32080/`. That URL stays up while the cluster and tenant service stay up, unlike `kubectl port-forward`.

After first login, Node-RED starts with a seeded starter workspace:

- `Welcome & Demo`: click the inject node and inspect the debug sidebar
- `Health`: exposes `GET /tenant-health`
- `Errors`: catches unhandled flow errors into the debug sidebar

The starter `flows.json` is only copied on first boot. After that, tenant edits stay on the PVC and are not overwritten by later deploys.

## Tests

- Unit/e2e (no external deps): `npm test`
- Integration (requires Postgres + Keycloak): `docker compose up -d && npm run test:integration`
- End-to-end runtime smoke (requires Postgres + Keycloak + kind cluster + running API in `K8S_DEPLOY_MODE=apply`): `npm run smoke:runtime`
- Full local check: `npm run verify:integration`
