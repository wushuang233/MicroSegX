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

: "${DEPLOY_MODE:=registry}"
: "${IMAGE_NAMESPACE:?IMAGE_NAMESPACE is required}"
: "${CORE_TAG:?CORE_TAG is required}"
: "${SCANNER_TAG:?SCANNER_TAG is required}"

if [[ "${DEPLOY_MODE}" == "local" ]]; then
  REGISTRY=${REGISTRY:-${LOCAL_IMAGE_REGISTRY:-local.microsegx}}
else
  : "${REGISTRY:?REGISTRY is required}"
fi

RELEASE_NAME=${RELEASE_NAME:-microsegx}
NAMESPACE=${NAMESPACE:-microsegx}
ARTIFACT_DIR=${ARTIFACT_DIR:-"${SCRIPT_DIR}"}
VALUES_FILE="${ARTIFACT_DIR}/values.generated.yaml"
EXTRA_VALUES_FILES=${EXTRA_VALUES_FILES:-}

if [[ -d "${SCRIPT_DIR}/charts/core" && -d "${SCRIPT_DIR}/charts/crd" ]]; then
  CHART_ROOT="${SCRIPT_DIR}/charts"
elif [[ -d "${ARTIFACT_DIR}/bundle/charts/core" && -d "${ARTIFACT_DIR}/bundle/charts/crd" ]]; then
  CHART_ROOT="${ARTIFACT_DIR}/bundle/charts"
else
  REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
  CHART_ROOT="${REPO_ROOT}/microsegx-helm/charts"
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd helm
require_cmd kubectl

if [[ -z "${BOOTSTRAP_PASSWORD:-}" ]]; then
  existing_pvc=false
  existing_controller=false
  if kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
    if kubectl get pvc -n "${NAMESPACE}" microsegx-data >/dev/null 2>&1; then
      existing_pvc=true
    fi
    if kubectl get deployment -n "${NAMESPACE}" microsegx-controller-pod >/dev/null 2>&1; then
      existing_controller=true
    fi
  fi

  if [[ "${existing_pvc}" != "true" && "${existing_controller}" != "true" ]]; then
    echo "BOOTSTRAP_PASSWORD is required for a fresh Kubernetes deployment." >&2
    echo "Set BOOTSTRAP_PASSWORD in your env file so deploy-core.sh can create microsegx-bootstrap-secret." >&2
    exit 1
  fi
fi

if [[ "${ENABLE_REGISTRY_ADAPTER:-false}" == "true" && "${MIRROR_REGISTRY_ADAPTER:-false}" != "true" ]]; then
  echo "ENABLE_REGISTRY_ADAPTER=true requires MIRROR_REGISTRY_ADAPTER=true." >&2
  exit 1
fi

if [[ "${ENABLE_CONTROLLER_PRIME:-false}" == "true" && "${MIRROR_COMPLIANCE_CONFIG:-false}" != "true" ]]; then
  echo "ENABLE_CONTROLLER_PRIME=true requires MIRROR_COMPLIANCE_CONFIG=true." >&2
  exit 1
fi

if [[ "${DEPLOY_MODE}" == "local" && "${MIRROR_UPDATER:-true}" != "true" ]]; then
  echo "DEPLOY_MODE=local requires MIRROR_UPDATER=true." >&2
  exit 1
fi

MANAGER_INGRESS_ENABLED=false
if [[ -n "${MANAGER_HOST:-}" ]]; then
  MANAGER_INGRESS_ENABLED=true
fi

K3S_ENABLED=${K3S_ENABLED:-false}
CONTAINERD_ENABLED=${CONTAINERD_ENABLED:-false}
if [[ "${LOCAL_RUNTIME:-}" == "k3s" ]]; then
  K3S_ENABLED=true
fi
if [[ "${LOCAL_RUNTIME:-}" == "containerd" ]]; then
  CONTAINERD_ENABLED=true
fi
if [[ "${RUNTIME_PATH:-}" == /run/k3s/containerd/* ]]; then
  K3S_ENABLED=true
fi

CONTROLLER_REPLICAS=${CONTROLLER_REPLICAS:-1}

if [[ -z "${CONTROLLER_PVC_ENABLED:-}" ]]; then
  if [[ "${DEPLOY_MODE}" == "local" && "${K3S_ENABLED}" == "true" ]]; then
    CONTROLLER_PVC_ENABLED=true
  else
    CONTROLLER_PVC_ENABLED=false
  fi
fi

if [[ "${CONTROLLER_PVC_ENABLED}" == "true" ]]; then
  if [[ -z "${CONTROLLER_PVC_ACCESS_MODE:-}" ]]; then
    if [[ "${DEPLOY_MODE}" == "local" && "${K3S_ENABLED}" == "true" && "${CONTROLLER_REPLICAS}" == "1" ]]; then
      CONTROLLER_PVC_ACCESS_MODE=ReadWriteOnce
    else
      CONTROLLER_PVC_ACCESS_MODE=ReadWriteMany
    fi
  fi

  : "${CONTROLLER_PVC_CAPACITY:=2Gi}"

  if [[ -z "${CONTROLLER_PVC_STORAGE_CLASS:-}" && "${DEPLOY_MODE}" == "local" && "${K3S_ENABLED}" == "true" ]]; then
    CONTROLLER_PVC_STORAGE_CLASS=local-path
  fi

  if [[ "${CONTROLLER_PVC_ACCESS_MODE}" == "ReadWriteOnce" && "${CONTROLLER_REPLICAS}" != "1" ]]; then
    echo "ReadWriteOnce controller persistence only supports CONTROLLER_REPLICAS=1." >&2
    exit 1
  fi

  if [[ "${CONTROLLER_PVC_STORAGE_CLASS:-}" == "local-path" && "${CONTROLLER_PVC_ACCESS_MODE}" != "ReadWriteOnce" ]]; then
    echo "StorageClass local-path does not support controller.pvc.accessModes=${CONTROLLER_PVC_ACCESS_MODE}. Use ReadWriteOnce." >&2
    exit 1
  fi
fi

if [[ "${CONTROLLER_PVC_ENABLED}" == "true" && "${CONTROLLER_PVC_ACCESS_MODE:-}" == "ReadWriteOnce" && "${CONTROLLER_REPLICAS}" == "1" ]]; then
  CONTROLLER_STRATEGY_TYPE=Recreate
else
  CONTROLLER_STRATEGY_TYPE=${CONTROLLER_STRATEGY_TYPE:-RollingUpdate}
fi

if [[ -n "${CONTROLLER_PVC_EXISTING_CLAIM:-}" ]]; then
  CONTROLLER_PVC_EXISTING_CLAIM_YAML="\"${CONTROLLER_PVC_EXISTING_CLAIM}\""
else
  CONTROLLER_PVC_EXISTING_CLAIM_YAML=false
fi

if [[ "${CONTROLLER_STRATEGY_TYPE}" == "Recreate" ]]; then
  CONTROLLER_STRATEGY_YAML=$(cat <<EOF
  strategy:
    type: Recreate
    rollingUpdate: null
EOF
)
else
  CONTROLLER_STRATEGY_YAML=$(cat <<EOF
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
EOF
)
fi

if [[ "${CONTROLLER_PVC_ENABLED}" == "true" ]]; then
  CONTROLLER_PVC_YAML=$(cat <<EOF
  pvc:
    enabled: true
    existingClaim: ${CONTROLLER_PVC_EXISTING_CLAIM_YAML}
    accessModes:
      - ${CONTROLLER_PVC_ACCESS_MODE}
    storageClass: ${CONTROLLER_PVC_STORAGE_CLASS:-}
    capacity: ${CONTROLLER_PVC_CAPACITY}
EOF
)
else
  CONTROLLER_PVC_YAML=$(cat <<EOF
  pvc:
    enabled: false
EOF
)
fi

UPDATER_REGISTRY=${REGISTRY}
UPDATER_REPOSITORY=${IMAGE_NAMESPACE}/updater
if [[ "${MIRROR_UPDATER:-true}" != "true" ]]; then
  UPDATER_REGISTRY=docker.io
  UPDATER_REPOSITORY=microsegx/updater
fi

IMAGE_PULL_POLICY=IfNotPresent
if [[ "${DEPLOY_MODE}" == "local" ]]; then
  IMAGE_PULL_POLICY=Never
fi

if [[ -n "${KUBECONFIG:-}" ]]; then
  export KUBECONFIG
fi

if [[ ! -d "${CHART_ROOT}/core" || ! -d "${CHART_ROOT}/crd" ]]; then
  echo "Charts not found under ${CHART_ROOT}" >&2
  exit 1
fi

if [[ "${CONTROLLER_PVC_ENABLED}" == "true" && -z "${CONTROLLER_PVC_EXISTING_CLAIM:-}" && -n "${CONTROLLER_PVC_STORAGE_CLASS:-}" ]]; then
  if ! kubectl get storageclass "${CONTROLLER_PVC_STORAGE_CLASS}" >/dev/null 2>&1; then
    echo "StorageClass not found: ${CONTROLLER_PVC_STORAGE_CLASS}" >&2
    exit 1
  fi
fi

HELM_VALUE_ARGS=(-f "${VALUES_FILE}")
if [[ -n "${EXTRA_VALUES_FILES}" ]]; then
  IFS=':' read -r -a EXTRA_VALUE_FILE_LIST <<<"${EXTRA_VALUES_FILES}"
  for extra_values_file in "${EXTRA_VALUE_FILE_LIST[@]}"; do
    [[ -n "${extra_values_file}" ]] || continue
    if [[ ! -f "${extra_values_file}" ]]; then
      echo "Extra values file not found: ${extra_values_file}" >&2
      exit 1
    fi
    HELM_VALUE_ARGS+=(-f "${extra_values_file}")
  done
fi

cat >"${VALUES_FILE}" <<EOF
openshift: false
registry: ${REGISTRY}
tag: ${CORE_TAG}
bootstrapPassword: "${BOOTSTRAP_PASSWORD:-}"
autoGenerateCert: ${AUTO_GENERATE_CERT:-true}
internal:
  autoRotateCert: ${INTERNAL_AUTO_ROTATE_CERT:-true}

controller:
  replicas: ${CONTROLLER_REPLICAS}
  image:
    repository: ${IMAGE_NAMESPACE}/controller
    imagePullPolicy: ${IMAGE_PULL_POLICY}
${CONTROLLER_STRATEGY_YAML}
${CONTROLLER_PVC_YAML}
  prime:
    enabled: ${ENABLE_CONTROLLER_PRIME:-false}
    image:
      repository: ${IMAGE_NAMESPACE}/compliance-config
      imagePullPolicy: ${IMAGE_PULL_POLICY}
      tag: ${COMPLIANCE_CONFIG_TAG:-1.0.11}

manager:
  route:
    enabled: false
  image:
    repository: ${IMAGE_NAMESPACE}/manager
    imagePullPolicy: ${IMAGE_PULL_POLICY}
  svc:
    type: ${MANAGER_SERVICE_TYPE:-ClusterIP}
    nodePort: ${MANAGER_NODE_PORT:-}
  ingress:
    enabled: ${MANAGER_INGRESS_ENABLED}
    host: ${MANAGER_HOST:-}
    ingressClassName: "${INGRESS_CLASS:-nginx}"
    tls: ${MANAGER_TLS:-false}
    secretName: "${MANAGER_TLS_SECRET:-}"

enforcer:
  image:
    repository: ${IMAGE_NAMESPACE}/enforcer
    imagePullPolicy: ${IMAGE_PULL_POLICY}

cve:
  adapter:
    enabled: ${ENABLE_REGISTRY_ADAPTER:-false}
    route:
      enabled: false
    image:
      repository: ${IMAGE_NAMESPACE}/registry-adapter
      imagePullPolicy: ${IMAGE_PULL_POLICY}
      tag: ${REGISTRY_ADAPTER_TAG:-0.2.4}
  updater:
    enabled: true
    image:
      registry: ${UPDATER_REGISTRY}
      repository: ${UPDATER_REPOSITORY}
      imagePullPolicy: ${IMAGE_PULL_POLICY}
      tag: ${UPDATER_TAG:-0.0.9}
  scanner:
    replicas: ${SCANNER_REPLICAS:-1}
    image:
      registry: ${REGISTRY}
      repository: ${IMAGE_NAMESPACE}/scanner
      imagePullPolicy: ${IMAGE_PULL_POLICY}
      tag: "${SCANNER_TAG}"

crdwebhook:
  enabled: false
EOF

if [[ -n "${IMAGE_PULL_SECRET:-}" ]]; then
  cat >>"${VALUES_FILE}" <<EOF
imagePullSecrets: ${IMAGE_PULL_SECRET}
EOF
fi

if [[ -n "${RUNTIME_PATH:-}" ]]; then
  cat >>"${VALUES_FILE}" <<EOF
runtimePath: ${RUNTIME_PATH}
EOF
fi

cat >>"${VALUES_FILE}" <<EOF
k3s:
  enabled: ${K3S_ENABLED}

containerd:
  enabled: ${CONTAINERD_ENABLED}
EOF

if [[ -n "${IMAGE_PULL_SECRET:-}" && -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]]; then
  kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n "${NAMESPACE}" create secret docker-registry "${IMAGE_PULL_SECRET}" \
    --docker-server="${REGISTRY}" \
    --docker-username="${REGISTRY_USERNAME}" \
    --docker-password="${REGISTRY_PASSWORD}" \
    --docker-email="${REGISTRY_EMAIL:-devnull@example.com}" \
    --dry-run=client -o yaml | kubectl apply -f -
fi

echo "==> Installing CRDs"
helm upgrade --install "${RELEASE_NAME}-crd" "${CHART_ROOT}/crd" \
  -n "${NAMESPACE}" \
  --create-namespace

echo "==> Installing core services"
helm upgrade --install "${RELEASE_NAME}" "${CHART_ROOT}/core" \
  -n "${NAMESPACE}" \
  "${HELM_VALUE_ARGS[@]}"

echo
echo "Helm release applied."
echo "Values file: ${VALUES_FILE}"
if [[ -n "${EXTRA_VALUES_FILES}" ]]; then
  echo "Extra values: ${EXTRA_VALUES_FILES}"
fi
echo
kubectl get pods -n "${NAMESPACE}" -o wide
