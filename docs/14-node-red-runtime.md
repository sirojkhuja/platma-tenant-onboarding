# Node-RED Runtime Mode

This document explains the production-oriented Node-RED runtime that now sits behind the existing tenant onboarding flow.

## What changed

The service no longer stops at YAML generation.

When `K8S_DEPLOY_MODE=apply`:

1. `POST /tenants` creates the tenant row in Postgres.
2. Keycloak client/user provisioning is performed.
3. The service generates a Node-RED manifest bundle.
4. The bundle is applied to Kubernetes.
5. The service waits for the Deployment to become ready.
6. The tenant is marked `ACTIVE`.

When `DELETE /tenants/:id` is called in apply mode:

1. The tenant is marked `DEPROVISIONING`.
2. The Keycloak client is disabled.
3. The Kubernetes resources are deleted.
4. The service waits for the Deployment to disappear.
5. The tenant is marked `INACTIVE`.

When `K8S_DEPLOY_MODE=manifest`, the system keeps the previous behavior and only generates artifacts.

## Resources created per tenant

Each tenant gets the following Kubernetes resources:

- `Secret`
  Stores `NODE_RED_ADMIN_USERNAME` and the bcrypt-hashed admin password.
- `ConfigMap`
  Provides a generated `settings.js`, starter `flows.json`, and a first-boot seed script.
- `PersistentVolumeClaim`
  Mounts `/data` so flows survive pod restarts.
- `Deployment`
  Runs the Node-RED container.
- `Service`
  Exposes Node-RED internally on port `80`.
- `Ingress` (optional)
  Only created when `NODE_RED_ENABLE_INGRESS=true`.

## Why this is closer to production

Compared with the original exercise-only manifest generator, the runtime mode adds:

- persistent data storage
- editor credentials
- first-boot starter flow seeding
- readiness and liveness probes
- resource requests and limits
- optional ingress
- rollout waiting
- cleanup on delete

## Main configuration

### Kubernetes

- `K8S_DEPLOY_MODE=manifest|apply`
- `K8S_KUBECONFIG_PATH`
- `K8S_CREATE_NAMESPACE=true|false`
- `K8S_PUBLIC_HOST`
- `K8S_ROLLOUT_TIMEOUT_MS`
- `K8S_ROLLOUT_POLL_INTERVAL_MS`
- `K8S_NAMESPACE`

### Node-RED

- `NODE_RED_IMAGE`
- `NODE_RED_EDITOR_USERNAME`
- `NODE_RED_PASSWORD_SEED`
- `NODE_RED_PASSWORD_LENGTH`
- `NODE_RED_STORAGE_SIZE`
- `NODE_RED_STORAGE_CLASS`
- `NODE_RED_SERVICE_TYPE`
- `NODE_RED_ENABLE_INGRESS`
- `NODE_RED_BASE_DOMAIN`
- `NODE_RED_INGRESS_CLASS_NAME`
- `NODE_RED_CPU_REQUEST`
- `NODE_RED_CPU_LIMIT`
- `NODE_RED_MEMORY_REQUEST`
- `NODE_RED_MEMORY_LIMIT`

## Local workflow

1. Start Postgres and Keycloak:

```bash
npm run dev:deps:up
```

2. Start kind:

```bash
npm run dev:k8s:up
```

3. Configure `.env` for live apply mode:

```bash
K8S_DEPLOY_MODE=apply
K8S_KUBECONFIG_PATH=$HOME/.kube/config
NODE_RED_PASSWORD_SEED=replace-this-with-a-real-secret
NODE_RED_SERVICE_TYPE=NodePort
```

4. Start the API:

```bash
npm run start:dev
```

5. Run the smoke script:

```bash
npm run smoke:runtime
```

The smoke script validates:

- tenant creation succeeds
- Deployment, Service, and PVC exist
- Node-RED editor page responds
- `/flows` requires authentication
- tenant deletion removes the Deployment

When `NODE_RED_SERVICE_TYPE=NodePort`, the API resolves a stable `nodeRed.editorUrl` after rollout by reading the live Service `nodePort` and a reachable node address from Kubernetes. If you need a specific hostname or IP in that URL, set `K8S_PUBLIC_HOST`.

## Starter workspace

New tenant workspaces are no longer empty on first login.

The system seeds a starter `flows.json` that includes:

- `Welcome & Demo`
  A safe inject -> function -> debug flow that proves the editor is working.
- `Health`
  A read-only `GET /tenant-health` endpoint that returns tenant runtime metadata.
- `Errors`
  A `catch` -> `debug` flow so unhandled node errors are visible immediately.

The seed is copied by an init container only when `/data/flows.json` does not already exist. This matters because the PVC is persistent: tenant edits must survive restarts and later deploys.

## API additions

The system now has:

- `GET /tenants/:id`

That endpoint returns the persisted runtime metadata, including:

- Kubernetes namespace
- Kubernetes resource name
- Node-RED node port and public host, when using `NodePort`
- Node-RED service name
- Node-RED ingress host, when configured

The create response also returns the bootstrap Node-RED admin password once. That password is derived from `NODE_RED_PASSWORD_SEED` and tenant identity, while the live cluster only receives the bcrypt hash.
