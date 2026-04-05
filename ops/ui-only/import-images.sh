#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  import-images.sh <cluster-type> <image> [<image> ...]

Supported cluster types:
  kind
  k3d
  minikube

Environment variables:
  KIND_CLUSTER_NAME   default: kind
  K3D_CLUSTER_NAME    default: k3s-default
  MINIKUBE_PROFILE    default: minikube
EOF
}

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

CLUSTER_TYPE="$1"
shift

KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-kind}"
K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-k3s-default}"
MINIKUBE_PROFILE="${MINIKUBE_PROFILE:-minikube}"

log() {
  printf '[import-images] %s\n' "$*"
}

import_kind() {
  command -v kind >/dev/null 2>&1 || {
    printf 'Missing required command: kind\n' >&2
    exit 1
  }
  local image
  for image in "$@"; do
    log "Loading into kind/${KIND_CLUSTER_NAME}: ${image}"
    kind load docker-image "${image}" --name "${KIND_CLUSTER_NAME}"
  done
}

import_k3d() {
  command -v k3d >/dev/null 2>&1 || {
    printf 'Missing required command: k3d\n' >&2
    exit 1
  }
  local image
  for image in "$@"; do
    log "Loading into k3d/${K3D_CLUSTER_NAME}: ${image}"
    k3d image import "${image}" -c "${K3D_CLUSTER_NAME}"
  done
}

import_minikube() {
  command -v minikube >/dev/null 2>&1 || {
    printf 'Missing required command: minikube\n' >&2
    exit 1
  }
  local image
  for image in "$@"; do
    log "Loading into minikube/${MINIKUBE_PROFILE}: ${image}"
    minikube image load --profile "${MINIKUBE_PROFILE}" "${image}"
  done
}

case "${CLUSTER_TYPE}" in
  kind)
    import_kind "$@"
    ;;
  k3d)
    import_k3d "$@"
    ;;
  minikube)
    import_minikube "$@"
    ;;
  *)
    printf 'Unsupported cluster type: %s\n' "${CLUSTER_TYPE}" >&2
    usage
    exit 1
    ;;
esac
