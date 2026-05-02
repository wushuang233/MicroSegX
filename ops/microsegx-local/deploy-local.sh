#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MICROSEGX_PORT_AUDIT_BASE_URL="${MICROSEGX_PORT_AUDIT_BASE_URL:-http://k8s-port-audit.port-audit.svc.cluster.local:8080}"
STACK_LOCAL_RUNTIME="${STACK_LOCAL_RUNTIME:-k3s}"
STACK_CONTAINERD_NAMESPACE="${STACK_CONTAINERD_NAMESPACE:-k8s.io}"
K3S_IMPORT_HELPER_NAMESPACE="${K3S_IMPORT_HELPER_NAMESPACE:-default}"
K3S_IMPORT_HELPER_NAME="${K3S_IMPORT_HELPER_NAME:-k3s-import-helper}"
K3S_IMPORT_HELPER_IMAGE="${K3S_IMPORT_HELPER_IMAGE:-alpine:3.20}"
PORT_AUDIT_NAMESPACE="${PORT_AUDIT_NAMESPACE:-port-audit}"
PORT_AUDIT_SERVICE_NAME="${PORT_AUDIT_SERVICE_NAME:-k8s-port-audit}"

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

patch_runtime_port_audit_address() {
  local manager_namespace="$1"
  local base_url="${MICROSEGX_PORT_AUDIT_BASE_URL:-}"

  if [[ -z "${base_url}" ]]; then
    echo "==> Skipping manager port-audit runtime patch: base URL is empty"
    return 0
  fi

  echo "==> Patching manager port-audit runtime URL to ${base_url}"
  kubectl set env -n "${manager_namespace}" deployment/microsegx-manager-pod MICROSEGX_PORT_AUDIT_BASE_URL="${base_url}" >/dev/null
  kubectl rollout status -n "${manager_namespace}" deployment/microsegx-manager-pod --timeout=180s
}

if [[ -d "${SCRIPT_DIR}/core" && -d "${SCRIPT_DIR}/port-audit-stack" ]]; then
  DEPLOY_LAYOUT="artifact"
  ROOT_DIR="${SCRIPT_DIR}"
  FULL_RELEASE_ENV="${FULL_RELEASE_ENV:-${1:-${SCRIPT_DIR}/core/bundle/full-release.env}}"
  FULL_RELEASE_LOAD_SCRIPT="${SCRIPT_DIR}/core/bundle/load-local-images.sh"
  FULL_RELEASE_DEPLOY_SCRIPT="${SCRIPT_DIR}/core/bundle/deploy-core.sh"
  FULL_RELEASE_ARTIFACT_DIR="${SCRIPT_DIR}/core"
  STACK_BUNDLE_DIR="${SCRIPT_DIR}/port-audit-stack"
  STACK_TAR="$(find "${STACK_BUNDLE_DIR}" -maxdepth 1 -type f -name 'k8s-port-audit-stack-*.tar' | head -n 1)"
  STACK_INSTALLER_MANIFEST="${STACK_BUNDLE_DIR}/openziti-stack-installer-local.yaml"
else
  DEPLOY_LAYOUT="repo"
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  FULL_RELEASE_ENV="${FULL_RELEASE_ENV:-${1:-${ROOT_DIR}/ops/full-release/full-release.env}}"
  FULL_RELEASE_LOAD_SCRIPT="${ROOT_DIR}/ops/full-release/load-local-images.sh"
  FULL_RELEASE_DEPLOY_SCRIPT="${ROOT_DIR}/ops/full-release/deploy-core.sh"
  KNS_ROOT="${ROOT_DIR}/k8s-node-surface"
  STACK_VERSION="$(head -n 1 "${KNS_ROOT}/VERSION" | tr -d '[:space:]')"
  STACK_BUNDLE_DIR="${KNS_ROOT}/dist/k8s-port-audit-stack-local-${STACK_VERSION}"
  STACK_TAR="${STACK_BUNDLE_DIR}/k8s-port-audit-stack-${STACK_VERSION}.tar"
  STACK_INSTALLER_MANIFEST="${STACK_BUNDLE_DIR}/openziti-stack-installer-local.yaml"
fi

if [[ ! -f "${FULL_RELEASE_ENV}" ]]; then
  echo "Missing full-release env: ${FULL_RELEASE_ENV}" >&2
  if [[ "${DEPLOY_LAYOUT}" == "artifact" ]]; then
    echo "Artifact mode expects core/bundle/full-release.env to exist. Rebuild the artifact with the latest scripts, or set FULL_RELEASE_ENV explicitly." >&2
  else
    echo "Set FULL_RELEASE_ENV or pass the env file path as the first argument." >&2
  fi
  exit 1
fi

# shellcheck disable=SC1090
source "${FULL_RELEASE_ENV}"

if [[ "${DEPLOY_LAYOUT}" == "repo" ]]; then
  FULL_RELEASE_ARTIFACT_DIR="${ARTIFACT_DIR:-${ROOT_DIR}/artifacts/full-release/${CORE_TAG}}"
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

prepare_local_full_release_env() {
  local target_env="$1"
  cp "${FULL_RELEASE_ENV}" "${target_env}"

  if ! grep -q '^AUTO_POLICY_MODE=' "${target_env}"; then
    cat >>"${target_env}" <<'EOF'
AUTO_POLICY_MODE=shadow
AUTO_POLICY_WINDOW_SECONDS=5
AUTO_POLICY_SLOT_MINUTES=1
AUTO_POLICY_DISTINCT_DAY_DURATION=60s
AUTO_POLICY_TTL_CHECK_SECONDS=60
EOF
    echo "==> Applying default local auto-policy shadow settings for single-node validation"
  fi

  if [[ "${STACK_LOCAL_RUNTIME}" != "k3s" ]]; then
    return
  fi

  require_cmd kubectl

  local node_count
  node_count=$(kubectl get nodes --no-headers 2>/dev/null | sed '/^$/d' | wc -l | tr -d '[:space:]')
  if [[ "${node_count}" != "1" ]]; then
    return
  fi

  cat >>"${target_env}" <<'EOF'
CONTROLLER_REPLICAS=1
SCANNER_REPLICAS=1
EOF

  echo "==> Single-node k3s detected, overriding core/scanner replicas to 1 for local deployment"
}

ensure_k3s_import_helper() {
  require_cmd kubectl
  if kubectl get pod "${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" >/dev/null 2>&1; then
    kubectl wait --for=condition=Ready "pod/${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" --timeout=120s >/dev/null
    return
  fi

  cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: ${K3S_IMPORT_HELPER_NAME}
  namespace: ${K3S_IMPORT_HELPER_NAMESPACE}
spec:
  restartPolicy: Never
  containers:
    - name: helper
      image: ${K3S_IMPORT_HELPER_IMAGE}
      command: ["sh", "-lc", "sleep 3600"]
      securityContext:
        privileged: true
      volumeMounts:
        - name: host-root
          mountPath: /hostfs
          readOnly: true
        - name: k3s-bin
          mountPath: /host/bin/k3s
          readOnly: true
        - name: k3s-sock
          mountPath: /run/k3s/containerd/containerd.sock
  volumes:
    - name: host-root
      hostPath:
        path: /
        type: Directory
    - name: k3s-bin
      hostPath:
        path: /usr/local/bin/k3s
        type: File
    - name: k3s-sock
      hostPath:
        path: /run/k3s/containerd/containerd.sock
        type: Socket
EOF

  kubectl wait --for=condition=Ready "pod/${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" --timeout=120s >/dev/null
}

import_with_k3s_helper() {
  local image_tar="$1"
  local image_tar_abs
  image_tar_abs="$(cd "$(dirname "${image_tar}")" && pwd)/$(basename "${image_tar}")"
  ensure_k3s_import_helper
  echo "==> Importing images into k3s containerd namespace ${STACK_CONTAINERD_NAMESPACE} via helper pod"
  kubectl exec -n "${K3S_IMPORT_HELPER_NAMESPACE}" "${K3S_IMPORT_HELPER_NAME}" -- \
    /host/bin/k3s ctr -a /run/k3s/containerd/containerd.sock -n "${STACK_CONTAINERD_NAMESPACE}" images import --all-platforms "/hostfs${image_tar_abs}"
}

import_stack_image() {
  case "${STACK_LOCAL_RUNTIME}" in
    k3s)
      import_with_k3s_helper "${STACK_TAR}"
      ;;
    containerd)
      require_cmd ctr
      sudo ctr -n "${STACK_CONTAINERD_NAMESPACE}" images import "${STACK_TAR}"
      ;;
    nerdctl)
      require_cmd nerdctl
      sudo nerdctl --namespace "${STACK_CONTAINERD_NAMESPACE}" load -i "${STACK_TAR}"
      ;;
    docker)
      require_cmd docker
      docker load -i "${STACK_TAR}"
      ;;
    *)
      echo "Unsupported STACK_LOCAL_RUNTIME: ${STACK_LOCAL_RUNTIME}" >&2
      echo "Supported values: k3s, containerd, nerdctl, docker" >&2
      exit 1
      ;;
  esac
}

if [[ ! -f "${STACK_TAR}" || ! -f "${STACK_INSTALLER_MANIFEST}" ]]; then
  if [[ "${DEPLOY_LAYOUT}" == "artifact" ]]; then
    echo "MicroSegX stack bundle is missing under ${STACK_BUNDLE_DIR}" >&2
    exit 1
  fi
  echo "MicroSegX stack bundle is missing, building it now..."
  (
    cd "${KNS_ROOT}"
    bash scripts/build-stack-image-bundle.sh
  )
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

FULL_RELEASE_DEPLOY_ENV="${TMP_DIR}/full-release.local.env"
prepare_local_full_release_env "${FULL_RELEASE_DEPLOY_ENV}"

MANAGER_OVERLAY_FILE="${TMP_DIR}/manager-microsegx.overlay.yaml"
cat >"${MANAGER_OVERLAY_FILE}" <<EOF
manager:
  env:
    envs:
      - name: MICROSEGX_PORT_AUDIT_BASE_URL
        value: ${MICROSEGX_PORT_AUDIT_BASE_URL}
EOF

echo "==> Importing local manager/core images"
ARTIFACT_DIR="${FULL_RELEASE_ARTIFACT_DIR}" bash "${FULL_RELEASE_LOAD_SCRIPT}" "${FULL_RELEASE_DEPLOY_ENV}"

echo "==> Deploying manager/core with MicroSegX overlay"
EXTRA_VALUES_FILES="${MANAGER_OVERLAY_FILE}" \
  ARTIFACT_DIR="${FULL_RELEASE_ARTIFACT_DIR}" \
  bash "${FULL_RELEASE_DEPLOY_SCRIPT}" "${FULL_RELEASE_DEPLOY_ENV}"

echo "==> Importing port-audit + OpenZiti stack image"
import_stack_image

echo "==> Resetting previous OpenZiti installer job if it exists"
kubectl delete job -n openziti-installer openziti-stack-installer --ignore-not-found >/dev/null 2>&1 || true

echo "==> Applying MicroSegX port-audit + OpenZiti installer"
kubectl apply -f "${STACK_INSTALLER_MANIFEST}"

echo "==> Waiting for installer job to finish"
kubectl wait --for=condition=complete -n openziti-installer job/openziti-stack-installer --timeout="${STACK_INSTALLER_TIMEOUT:-30m}" || true

patch_runtime_port_audit_address "${NAMESPACE:-microsegx}"

echo
echo "Manager/core pods:"
kubectl get pods -n "${NAMESPACE:-microsegx}" -o wide
echo
echo "OpenZiti pods:"
kubectl get pods -n openziti -o wide || true
echo
echo "Port-audit pods:"
kubectl get pods -n port-audit -o wide || true
