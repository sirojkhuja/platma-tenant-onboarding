#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
NAMESPACE="${K8S_NAMESPACE:-default}"
PORT_FORWARD_PORT="${PORT_FORWARD_PORT:-1880}"
SUFFIX="$(date +%s)"
TENANT_NAME="Runtime Smoke ${SUFFIX}"
ADMIN_EMAIL="admin+${SUFFIX}@smoke.test"

cleanup() {
  if [[ -n "${PORT_FORWARD_PID:-}" ]]; then
    kill "${PORT_FORWARD_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

curl -fsS "${API_BASE_URL}/health" >/dev/null

CREATE_RESPONSE="$(
  curl -fsS -X POST "${API_BASE_URL}/tenants" \
    -H "content-type: application/json" \
    -d "{\"tenantName\":\"${TENANT_NAME}\",\"adminEmail\":\"${ADMIN_EMAIL}\"}"
)"

TENANT_ID="$(printf '%s' "${CREATE_RESPONSE}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).id")"
SERVICE_NAME="$(printf '%s' "${CREATE_RESPONSE}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).nodeRed.serviceName")"
EDITOR_URL="$(printf '%s' "${CREATE_RESPONSE}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).nodeRed.editorUrl || ''")"
ADMIN_USERNAME="$(printf '%s' "${CREATE_RESPONSE}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).nodeRed.adminUsername")"
ADMIN_PASSWORD="$(printf '%s' "${CREATE_RESPONSE}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).nodeRed.adminPassword")"

kubectl -n "${NAMESPACE}" get deployment "${SERVICE_NAME}" >/dev/null
kubectl -n "${NAMESPACE}" get service "${SERVICE_NAME}" >/dev/null
kubectl -n "${NAMESPACE}" get pvc "${SERVICE_NAME}-data" >/dev/null

if [[ -n "${EDITOR_URL}" ]]; then
  NODE_RED_BASE_URL="${EDITOR_URL%/}"
else
  kubectl -n "${NAMESPACE}" port-forward "svc/${SERVICE_NAME}" "${PORT_FORWARD_PORT}:80" >/tmp/platma-port-forward.log 2>&1 &
  PORT_FORWARD_PID="$!"
  sleep 5
  NODE_RED_BASE_URL="http://127.0.0.1:${PORT_FORWARD_PORT}"
fi

EDITOR_PAGE="$(curl -fsS "${NODE_RED_BASE_URL}/")"
printf '%s' "${EDITOR_PAGE}" | grep -qi "Node-RED"

FLOWS_STATUS="$(curl -s -o /tmp/platma-flows-response.txt -w '%{http_code}' "${NODE_RED_BASE_URL}/flows")"
if [[ "${FLOWS_STATUS}" != "401" ]]; then
  echo "Expected /flows to require authentication, got HTTP ${FLOWS_STATUS}."
  exit 1
fi

curl -fsS -X DELETE "${API_BASE_URL}/tenants/${TENANT_ID}" >/tmp/platma-delete-response.json

ATTEMPTS=60
for _ in $(seq 1 "${ATTEMPTS}"); do
  if ! kubectl -n "${NAMESPACE}" get deployment "${SERVICE_NAME}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if kubectl -n "${NAMESPACE}" get deployment "${SERVICE_NAME}" >/dev/null 2>&1; then
  echo "Deployment ${SERVICE_NAME} still exists after delete."
  exit 1
fi

echo "Runtime smoke test passed."
echo "Tenant id: ${TENANT_ID}"
echo "Node-RED service: ${SERVICE_NAME}"
echo "Node-RED editor URL: ${NODE_RED_BASE_URL}"
echo "Node-RED admin username: ${ADMIN_USERNAME}"
echo "Node-RED admin password: ${ADMIN_PASSWORD}"
