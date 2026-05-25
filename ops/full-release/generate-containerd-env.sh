#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SOURCE_ENV="${1:-${SCRIPT_DIR}/full-release.env}"
METADATA_FILE="${2:-${SCRIPT_DIR}/bundle/build-metadata.txt}"
OUTPUT_FILE="${3:-${SCRIPT_DIR}/full-release.containerd.env.example}"

if [[ ! -f "${METADATA_FILE}" ]]; then
  echo "Missing metadata file: ${METADATA_FILE}" >&2
  exit 1
fi

read_kv() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { print substr($0, length($1) + 2) }' "${METADATA_FILE}" | tail -n 1
}

PACKAGE_REGISTRY="$(read_kv registry)"
IMAGE_NAMESPACE="$(read_kv image_namespace)"
CORE_TAG="$(read_kv core_tag)"
SCANNER_TAG="$(read_kv scanner_tag)"
RELEASE_NAME="$(read_kv release_name)"
NAMESPACE="$(read_kv namespace)"

UPDATER_TAG="0.0.9"
LOCAL_UPDATER_IMAGE_MODE="controller"
MANAGER_NODE_PORT="30000"
CONTROLLER_PVC_CAPACITY="2Gi"
CONTROLLER_REPLICAS="1"
SCANNER_REPLICAS="1"

if [[ -f "${SOURCE_ENV}" ]]; then
  # shellcheck disable=SC1090
  source "${SOURCE_ENV}"
  UPDATER_TAG="${UPDATER_TAG:-0.0.9}"
  LOCAL_UPDATER_IMAGE_MODE="${LOCAL_UPDATER_IMAGE_MODE:-controller}"
  MANAGER_NODE_PORT="${MANAGER_NODE_PORT:-30000}"
  CONTROLLER_PVC_CAPACITY="${CONTROLLER_PVC_CAPACITY:-2Gi}"
  CONTROLLER_REPLICAS="${CONTROLLER_REPLICAS:-1}"
  SCANNER_REPLICAS="${SCANNER_REPLICAS:-1}"
fi

cat >"${OUTPUT_FILE}" <<EOF
# Copy this file to full-release.containerd.env on the target server.
#
# You must fill these values before deployment:
#   BOOTSTRAP_PASSWORD=<set a real admin bootstrap password>
#   CONTROLLER_PVC_STORAGE_CLASS=<your k8s StorageClass>
# Optional values you may change:
#   MANAGER_NODE_PORT=<default 30000>
#   KUBECONFIG=<path to kubeconfig on the deployment machine>

RELEASE_NAME=${RELEASE_NAME:-microsegx}
NAMESPACE=${NAMESPACE:-microsegx}

DEPLOY_MODE=local
LOCAL_RUNTIME=containerd
CONTAINERD_NAMESPACE=k8s.io

# This is the image prefix already embedded in the packaged images archive.
# It does not need to be a real registry service when imagePullPolicy=Never.
LOCAL_IMAGE_REGISTRY=${PACKAGE_REGISTRY}
IMAGE_NAMESPACE=${IMAGE_NAMESPACE}

CORE_TAG=${CORE_TAG}
SCANNER_TAG=${SCANNER_TAG}
UPDATER_TAG=${UPDATER_TAG}
LOCAL_UPDATER_IMAGE_MODE=${LOCAL_UPDATER_IMAGE_MODE}

MANAGER_SERVICE_TYPE=NodePort
MANAGER_NODE_PORT=${MANAGER_NODE_PORT}

CONTROLLER_REPLICAS=${CONTROLLER_REPLICAS}
SCANNER_REPLICAS=${SCANNER_REPLICAS}

CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP

CONTROLLER_PVC_ENABLED=true
CONTROLLER_PVC_EXISTING_CLAIM=
CONTROLLER_PVC_ACCESS_MODE=ReadWriteOnce
CONTROLLER_PVC_STORAGE_CLASS=__FILL_ME_STORAGE_CLASS__
CONTROLLER_PVC_CAPACITY=${CONTROLLER_PVC_CAPACITY}
CONTROLLER_STRATEGY_TYPE=Recreate

AUTO_GENERATE_CERT=true
INTERNAL_AUTO_ROTATE_CERT=true
BOOTSTRAP_PASSWORD=__FILL_ME_BOOTSTRAP_PASSWORD__

MIRROR_UPDATER=true
ENABLE_REGISTRY_ADAPTER=false
ENABLE_CONTROLLER_PRIME=false

KUBECONFIG=
EOF

echo "Wrote ${OUTPUT_FILE}"
