#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="${1:-${SCRIPT_DIR}/full-release.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

RELEASE_NAME=${RELEASE_NAME:-microsegx}
NAMESPACE=${NAMESPACE:-microsegx}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd helm
require_cmd kubectl

echo "==> Uninstalling Helm releases (if present)"
helm uninstall "${RELEASE_NAME}" -n "${NAMESPACE}" >/dev/null 2>&1 || true
helm uninstall "${RELEASE_NAME}-crd" -n "${NAMESPACE}" >/dev/null 2>&1 || true

echo "==> Deleting namespace ${NAMESPACE}"
kubectl delete namespace "${NAMESPACE}" --ignore-not-found --wait=false >/dev/null 2>&1 || true

echo "==> Deleting cluster-scoped resources labeled release=${RELEASE_NAME}"
kubectl delete \
  clusterrole,clusterrolebinding,validatingwebhookconfiguration,mutatingwebhookconfiguration,crd,priorityclass \
  -l "release=${RELEASE_NAME}" \
  --ignore-not-found >/dev/null 2>&1 || true

echo "==> Waiting for namespace ${NAMESPACE} to disappear"
for _ in $(seq 1 120); do
  if ! kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
    echo "Namespace ${NAMESPACE} is gone."
    echo "Reset complete."
    exit 0
  fi
  sleep 2
done

echo "Namespace ${NAMESPACE} is still terminating after 240 seconds." >&2
echo "Inspect finalizers before redeploying." >&2
exit 1
