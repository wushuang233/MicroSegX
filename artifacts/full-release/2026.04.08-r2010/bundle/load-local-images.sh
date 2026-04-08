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

DEPLOY_MODE=${DEPLOY_MODE:-local}
LOCAL_RUNTIME=${LOCAL_RUNTIME:-containerd}
CONTAINERD_NAMESPACE=${CONTAINERD_NAMESPACE:-k8s.io}
ARTIFACT_DIR=${ARTIFACT_DIR:-"${SCRIPT_DIR}"}
IMAGE_ARCHIVE=$(find "${ARTIFACT_DIR}" -maxdepth 1 -type f -name 'images-*.tar.gz' | head -n 1)
K3S_IMPORT_HELPER_NAMESPACE=${K3S_IMPORT_HELPER_NAMESPACE:-default}
K3S_IMPORT_HELPER_NAME=${K3S_IMPORT_HELPER_NAME:-k3s-import-helper}
K3S_IMPORT_HELPER_IMAGE=${K3S_IMPORT_HELPER_IMAGE:-alpine:3.20}
K3S_IMPORT_HELPER_NODE_NAME=${K3S_IMPORT_HELPER_NODE_NAME:-}
K3S_IMPORT_HELPER_NODE_IP=${K3S_IMPORT_HELPER_NODE_IP:-}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

detect_k3s_helper_node() {
  local host_ip="${K3S_IMPORT_HELPER_NODE_IP}"
  local nodes

  require_cmd kubectl

  if [[ -n "${K3S_IMPORT_HELPER_NODE_NAME}" ]]; then
    kubectl get node "${K3S_IMPORT_HELPER_NODE_NAME}" >/dev/null 2>&1 || {
      echo "k3s import helper node not found: ${K3S_IMPORT_HELPER_NODE_NAME}" >&2
      exit 1
    }
    return
  fi

  if [[ -z "${host_ip}" ]]; then
    host_ip=$(ip -o route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i + 1); exit}}')
  fi
  if [[ -z "${host_ip}" ]]; then
    host_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  if [[ -z "${host_ip}" ]]; then
    echo "Unable to determine local host IP for k3s image import helper." >&2
    echo "Set K3S_IMPORT_HELPER_NODE_NAME or K3S_IMPORT_HELPER_NODE_IP in the env file." >&2
    exit 1
  fi

  nodes=$(kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .status.addresses[*]}{.type}={.address}{";"}{end}{"\n"}{end}')
  K3S_IMPORT_HELPER_NODE_NAME=$(printf '%s\n' "${nodes}" | awk -F '\t' -v ip="${host_ip}" 'index($2, "InternalIP=" ip ";") {print $1; exit}')
  if [[ -z "${K3S_IMPORT_HELPER_NODE_NAME}" ]]; then
    echo "Unable to match local host IP ${host_ip} to a Kubernetes node." >&2
    echo "Set K3S_IMPORT_HELPER_NODE_NAME explicitly in the env file and retry." >&2
    exit 1
  fi
}

ensure_k3s_import_helper() {
  require_cmd kubectl
  detect_k3s_helper_node
  if kubectl get pod "${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" >/dev/null 2>&1; then
    local phase
    local pod_node
    phase=$(kubectl get pod "${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" -o jsonpath='{.status.phase}')
    pod_node=$(kubectl get pod "${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" -o jsonpath='{.spec.nodeName}')
    if [[ "${pod_node}" != "${K3S_IMPORT_HELPER_NODE_NAME}" ]]; then
      kubectl delete pod "${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" --ignore-not-found >/dev/null
      kubectl wait --for=delete "pod/${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" --timeout=120s >/dev/null || true
    elif [[ "${phase}" != "Pending" && "${phase}" != "Running" ]]; then
      kubectl delete pod "${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" --ignore-not-found >/dev/null
      kubectl wait --for=delete "pod/${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" --timeout=120s >/dev/null || true
    else
      kubectl wait --for=condition=Ready "pod/${K3S_IMPORT_HELPER_NAME}" -n "${K3S_IMPORT_HELPER_NAMESPACE}" --timeout=120s >/dev/null
      return
    fi
  fi

  cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: ${K3S_IMPORT_HELPER_NAME}
  namespace: ${K3S_IMPORT_HELPER_NAMESPACE}
spec:
  nodeName: ${K3S_IMPORT_HELPER_NODE_NAME}
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
  echo "==> Importing images into k3s containerd namespace ${CONTAINERD_NAMESPACE} via helper pod"
  kubectl exec -n "${K3S_IMPORT_HELPER_NAMESPACE}" "${K3S_IMPORT_HELPER_NAME}" -- \
    /host/bin/k3s ctr -a /run/k3s/containerd/containerd.sock -n "${CONTAINERD_NAMESPACE}" images import --all-platforms "/hostfs${image_tar_abs}"
}

if [[ "${DEPLOY_MODE}" != "local" ]]; then
  echo "This script is only for DEPLOY_MODE=local." >&2
  exit 1
fi

if [[ -z "${IMAGE_ARCHIVE}" || ! -f "${IMAGE_ARCHIVE}" ]]; then
  echo "Cannot find images-*.tar.gz under ${ARTIFACT_DIR}" >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

IMAGE_TAR="${TMP_DIR}/images.tar"
echo "==> Expanding ${IMAGE_ARCHIVE}"
gzip -dc "${IMAGE_ARCHIVE}" >"${IMAGE_TAR}"

case "${LOCAL_RUNTIME}" in
  k3s)
    import_with_k3s_helper "${IMAGE_TAR}"
    ;;
  docker)
    require_cmd docker
    echo "==> Loading images into docker"
    docker load -i "${IMAGE_TAR}"
    ;;
  containerd)
    require_cmd ctr
    echo "==> Importing images into containerd namespace ${CONTAINERD_NAMESPACE}"
    ctr -n "${CONTAINERD_NAMESPACE}" images import --all-platforms "${IMAGE_TAR}"
    ;;
  nerdctl)
    require_cmd nerdctl
    echo "==> Loading images with nerdctl namespace ${CONTAINERD_NAMESPACE}"
    nerdctl --namespace "${CONTAINERD_NAMESPACE}" load -i "${IMAGE_TAR}"
    ;;
  *)
    echo "Unsupported LOCAL_RUNTIME: ${LOCAL_RUNTIME}" >&2
    echo "Supported values: k3s, docker, containerd, nerdctl" >&2
    exit 1
    ;;
esac

echo
echo "Local image import complete."
echo "If your cluster has multiple nodes, run this script on every node."
echo "Then run deploy-core.sh on a machine that has kubectl and helm access to the cluster."
