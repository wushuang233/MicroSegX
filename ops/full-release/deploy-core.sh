#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="${1:-${SCRIPT_DIR}/full-release.env}"
ARTIFACT_DIR_OVERRIDE="${ARTIFACT_DIR:-}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

if [[ -n "${ARTIFACT_DIR_OVERRIDE}" ]]; then
  ARTIFACT_DIR="${ARTIFACT_DIR_OVERRIDE}"
fi

: "${DEPLOY_MODE:=registry}"
: "${IMAGE_NAMESPACE:?IMAGE_NAMESPACE is required}"
: "${CORE_TAG:?CORE_TAG is required}"
: "${SCANNER_TAG:?SCANNER_TAG is required}"
: "${CONTROLLER_HOST_NETWORK:=false}"
: "${ENFORCER_HOST_NETWORK:=false}"
: "${CONTROLLER_API_SERVICE_TYPE:=ClusterIP}"

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

wait_for_service_ip() {
  local namespace="$1"
  local service_name="$2"
  local timeout_seconds="${3:-120}"
  local elapsed=0
  local ip=""

  while (( elapsed < timeout_seconds )); do
    ip=$(kubectl get svc -n "${namespace}" "${service_name}" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)
    if [[ -n "${ip}" && "${ip}" != "None" && "${ip}" != "<none>" ]]; then
      printf '%s' "${ip}"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  return 1
}

resolve_first_node_internal_ip() {
  kubectl get nodes -o jsonpath='{range .items[0].status.addresses[?(@.type=="InternalIP")]}{.address}{end}' 2>/dev/null || true
}

resolve_port_audit_host_port() {
  local namespace="$1"
  local deployment_name="$2"
  kubectl get deployment -n "${namespace}" "${deployment_name}" \
    -o jsonpath='{range .spec.template.spec.containers[0].ports[*]}{.hostPort}{"\n"}{end}' 2>/dev/null \
    | awk 'NF { print; exit }'
}

patch_runtime_controller_addresses() {
  local namespace="$1"
  local api_ip="${FORCE_CONTROLLER_API_IP:-}"
  local cluster_join_addr="${FORCE_CONTROLLER_CLUSTER_JOIN_IP:-}"

  if [[ -z "${api_ip}" ]]; then
    api_ip=$(wait_for_service_ip "${namespace}" "microsegx-svc-controller-api" 180 || true)
  fi
  if [[ -z "${cluster_join_addr}" ]]; then
    cluster_join_addr="microsegx-svc-controller.${namespace}.svc.cluster.local."
  fi

  if [[ -z "${api_ip}" && -z "${cluster_join_addr}" ]]; then
    echo "==> Skipping runtime controller address patch: service IPs not ready"
    return 0
  fi

  echo "==> Patching runtime controller addresses"
  [[ -n "${api_ip}" ]] && echo "    manager/controller-api IP: ${api_ip}"
  [[ -n "${cluster_join_addr}" ]] && echo "    cluster join address: ${cluster_join_addr}"

  if [[ -n "${api_ip}" ]] && kubectl get deployment -n "${namespace}" microsegx-manager-pod >/dev/null 2>&1; then
    kubectl set env -n "${namespace}" deployment/microsegx-manager-pod CTRL_SERVER_IP="${api_ip}" >/dev/null
    kubectl rollout status -n "${namespace}" deployment/microsegx-manager-pod --timeout=180s
  fi

  if [[ -n "${cluster_join_addr}" ]]; then
    if kubectl get deployment -n "${namespace}" microsegx-scanner-pod >/dev/null 2>&1; then
      kubectl set env -n "${namespace}" deployment/microsegx-scanner-pod CLUSTER_JOIN_ADDR="${cluster_join_addr}" >/dev/null
      kubectl rollout status -n "${namespace}" deployment/microsegx-scanner-pod --timeout=180s
    fi

    if kubectl get daemonset -n "${namespace}" microsegx-enforcer-pod >/dev/null 2>&1; then
      kubectl set env -n "${namespace}" daemonset/microsegx-enforcer-pod CLUSTER_JOIN_ADDR="${cluster_join_addr}" >/dev/null
      kubectl rollout status -n "${namespace}" daemonset/microsegx-enforcer-pod --timeout=300s
    fi

    if kubectl get deployment -n "${namespace}" microsegx-registry-adapter-pod >/dev/null 2>&1; then
      kubectl set env -n "${namespace}" deployment/microsegx-registry-adapter-pod CLUSTER_JOIN_ADDR="${cluster_join_addr}" >/dev/null
      kubectl rollout status -n "${namespace}" deployment/microsegx-registry-adapter-pod --timeout=180s
    fi
  fi
}

patch_runtime_port_audit_address() {
  local manager_namespace="$1"
  local port_audit_namespace="${2:-port-audit}"
  local base_url="${FORCE_PORT_AUDIT_BASE_URL:-}"

  if [[ -z "${base_url}" ]]; then
    base_url="http://k8s-port-audit.${port_audit_namespace}.svc.cluster.local:8080"
  fi

  if [[ -z "${base_url}" ]]; then
    echo "==> Skipping runtime port-audit address patch: base URL is empty"
    return 0
  fi

  if ! kubectl get deployment -n "${manager_namespace}" microsegx-manager-pod >/dev/null 2>&1; then
    echo "==> Skipping runtime port-audit address patch: manager deployment not found"
    return 0
  fi

  echo "==> Patching runtime port-audit address"
  echo "    manager/port-audit base URL: ${base_url}"
  kubectl set env -n "${manager_namespace}" deployment/microsegx-manager-pod MICROSEGX_PORT_AUDIT_BASE_URL="${base_url}" >/dev/null
  kubectl rollout status -n "${manager_namespace}" deployment/microsegx-manager-pod --timeout=180s
}

adopt_existing_cluster_join_service() {
  local namespace="$1"
  local service_name="microsegx-svc-controller-cluster"

  if ! kubectl get service -n "${namespace}" "${service_name}" >/dev/null 2>&1; then
    return 0
  fi

  echo "==> Adopting existing ${service_name} service into Helm release metadata"
  kubectl label service -n "${namespace}" "${service_name}" app.kubernetes.io/managed-by=Helm --overwrite >/dev/null
  kubectl annotate service -n "${namespace}" "${service_name}" \
    meta.helm.sh/release-name="${RELEASE_NAME}" \
    meta.helm.sh/release-namespace="${namespace}" \
    --overwrite >/dev/null
}

yaml_escape() {
  local value="${1//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "${value}"
}

append_controller_env() {
  local name="$1"
  local value="${2:-}"
  [[ -n "${value}" ]] || return 0

  if [[ -z "${CONTROLLER_EXTRA_ENV_YAML:-}" ]]; then
    CONTROLLER_EXTRA_ENV_YAML=$'  env:\n'
  fi

  CONTROLLER_EXTRA_ENV_YAML+="    - name: ${name}"$'\n'
  CONTROLLER_EXTRA_ENV_YAML+="      value: \"$(yaml_escape "${value}")\""$'\n'
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
  CONTROLLER_PVC_ENABLED=$([[ "${DEPLOY_MODE}" == "local" ]] && echo true || echo false)
fi

if [[ "${CONTROLLER_PVC_ENABLED}" == "true" ]]; then
  if [[ -z "${CONTROLLER_PVC_ACCESS_MODE:-}" ]]; then
    if [[ "${DEPLOY_MODE}" == "local" && "${CONTROLLER_REPLICAS}" == "1" ]]; then
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
UPDATER_TAG_VALUE=${UPDATER_TAG:-0.0.9}
LOCAL_UPDATER_IMAGE_MODE=${LOCAL_UPDATER_IMAGE_MODE:-}

IMAGE_PULL_POLICY=IfNotPresent
if [[ "${DEPLOY_MODE}" == "local" ]]; then
  IMAGE_PULL_POLICY=Never
  LOCAL_UPDATER_IMAGE_MODE=${LOCAL_UPDATER_IMAGE_MODE:-controller}
  if [[ "${LOCAL_UPDATER_IMAGE_MODE}" == "controller" ]]; then
    UPDATER_REGISTRY=${REGISTRY}
    UPDATER_REPOSITORY=${IMAGE_NAMESPACE}/controller
    UPDATER_TAG_VALUE=${CORE_TAG}
  fi
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

CONTROLLER_EXTRA_ENV_YAML=""
append_controller_env "AUTO_POLICY_MODE" "${AUTO_POLICY_MODE:-}"
append_controller_env "AUTO_POLICY_WINDOW_SECONDS" "${AUTO_POLICY_WINDOW_SECONDS:-}"
append_controller_env "AUTO_POLICY_SLOT_MINUTES" "${AUTO_POLICY_SLOT_MINUTES:-}"
append_controller_env "AUTO_POLICY_DISTINCT_DAY_DURATION" "${AUTO_POLICY_DISTINCT_DAY_DURATION:-}"
append_controller_env "AUTO_POLICY_TTL_CHECK_SECONDS" "${AUTO_POLICY_TTL_CHECK_SECONDS:-}"

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
  hostNetwork: ${CONTROLLER_HOST_NETWORK}
  image:
    repository: ${IMAGE_NAMESPACE}/controller
    imagePullPolicy: ${IMAGE_PULL_POLICY}
  certupgrader:
    imagePullPolicy: ${IMAGE_PULL_POLICY}
  apisvc:
    type: ${CONTROLLER_API_SERVICE_TYPE}
    ctrlServerPort: 10443
${CONTROLLER_STRATEGY_YAML}
${CONTROLLER_PVC_YAML}
  prime:
    enabled: ${ENABLE_CONTROLLER_PRIME:-false}
    image:
      repository: ${IMAGE_NAMESPACE}/compliance-config
      imagePullPolicy: ${IMAGE_PULL_POLICY}
      tag: ${COMPLIANCE_CONFIG_TAG:-1.0.11}
${CONTROLLER_EXTRA_ENV_YAML}

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
  hostNetwork: ${ENFORCER_HOST_NETWORK}
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
      tag: ${UPDATER_TAG_VALUE}
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
  --force-conflicts \
  --create-namespace

adopt_existing_cluster_join_service "${NAMESPACE}"

echo "==> Installing core services"
helm upgrade --install "${RELEASE_NAME}" "${CHART_ROOT}/core" \
  -n "${NAMESPACE}" \
  --force-conflicts \
  "${HELM_VALUE_ARGS[@]}"

patch_runtime_controller_addresses "${NAMESPACE}"
patch_runtime_port_audit_address "${NAMESPACE}" "${PORT_AUDIT_NAMESPACE:-port-audit}"

echo
echo "Helm release applied."
echo "Values file: ${VALUES_FILE}"
if [[ -n "${EXTRA_VALUES_FILES}" ]]; then
  echo "Extra values: ${EXTRA_VALUES_FILES}"
fi
echo
kubectl get pods -n "${NAMESPACE}" -o wide
