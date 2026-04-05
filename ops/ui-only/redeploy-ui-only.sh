#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NV_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
IMPORT_SCRIPT="${SCRIPT_DIR}/import-images.sh"

if [[ -n "${ENV_FILE:-}" ]]; then
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
fi

usage() {
  cat <<'EOF'
Usage:
  ENV_FILE=/abs/path/to/ui-only.env ./ops/ui-only/redeploy-ui-only.sh

Modes:
  DEPLOY_MODE=registry
    Build manager, sync unchanged core images to a new tag, push to registry,
    then run helm upgrade.

  DEPLOY_MODE=local-import
    Build manager, sync unchanged core images locally, import them into a local
    cluster runtime, then run helm upgrade with local image references.

  DEPLOY_MODE=export-only
    Build/sync images and export tar archives only. No helm action.

Important environment variables:
  RELEASE_NAME
  NAMESPACE
  DEPLOY_MODE
  TARGET_REGISTRY
  TARGET_REPO_PREFIX
  TARGET_TAG
  SOURCE_REGISTRY
  SOURCE_REPO_PREFIX
  SOURCE_TAG
  SOURCE_SCANNER_TAG
  SOURCE_UPDATER_TAG
  BASE_VALUES_FILE
  IMAGE_PULL_SECRET
  CLUSTER_TYPE
EOF
}

log() {
  printf '[redeploy-ui-only] %s\n' "$*"
}

die() {
  printf '[redeploy-ui-only] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "${cmd}" >/dev/null 2>&1 || die "Missing required command: ${cmd}"
  done
}

safe_name() {
  printf '%s' "$1" | sed 's#[/:]#_#g'
}

render_optional_line() {
  local key="$1"
  local value="$2"
  if [[ -n "${value}" ]]; then
    printf '%s: %s\n' "${key}" "${value}"
  fi
}

RELEASE_NAME="${RELEASE_NAME:-neuvector}"
NAMESPACE="${NAMESPACE:-neuvector}"
DEPLOY_MODE="${DEPLOY_MODE:-registry}"
TARGET_REGISTRY="${TARGET_REGISTRY:-}"
TARGET_REPO_PREFIX="${TARGET_REPO_PREFIX:-nv}"
TARGET_TAG="${TARGET_TAG:-}"
SOURCE_REGISTRY="${SOURCE_REGISTRY:-docker.io}"
SOURCE_REPO_PREFIX="${SOURCE_REPO_PREFIX:-neuvector}"
SOURCE_TAG="${SOURCE_TAG:-}"
SOURCE_SCANNER_TAG="${SOURCE_SCANNER_TAG:-6}"
SOURCE_UPDATER_TAG="${SOURCE_UPDATER_TAG:-0.0.9}"
TARGET_SCANNER_TAG="${TARGET_SCANNER_TAG:-${SOURCE_SCANNER_TAG}}"
TARGET_UPDATER_TAG="${TARGET_UPDATER_TAG:-${SOURCE_UPDATER_TAG}}"
BASE_VALUES_FILE="${BASE_VALUES_FILE:-}"
IMAGE_PULL_SECRET="${IMAGE_PULL_SECRET:-}"
CLUSTER_TYPE="${CLUSTER_TYPE:-kind}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-containerd}"
RUNTIME_PATH="${RUNTIME_PATH:-}"
SKIP_SYNC_CORE_IMAGES="${SKIP_SYNC_CORE_IMAGES:-false}"
EXPORT_DIR="${EXPORT_DIR:-${SCRIPT_DIR}/artifacts/${TARGET_TAG}}"
HELM_CHART_PATH="${HELM_CHART_PATH:-${NV_ROOT}/neuvector-helm/charts/core}"
KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-kind}"
K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-k3s-default}"
MINIKUBE_PROFILE="${MINIKUBE_PROFILE:-minikube}"

[[ -n "${TARGET_REGISTRY}" ]] || die "TARGET_REGISTRY is required"
[[ -n "${TARGET_TAG}" ]] || die "TARGET_TAG is required"
[[ -n "${SOURCE_TAG}" ]] || die "SOURCE_TAG is required"
[[ -n "${TARGET_REPO_PREFIX}" ]] || die "TARGET_REPO_PREFIX is required"

case "${DEPLOY_MODE}" in
  registry|local-import|export-only)
    ;;
  *)
    usage
    die "Unsupported DEPLOY_MODE: ${DEPLOY_MODE}"
    ;;
esac

if [[ -n "${BASE_VALUES_FILE}" && ! -f "${BASE_VALUES_FILE}" ]]; then
  die "BASE_VALUES_FILE does not exist: ${BASE_VALUES_FILE}"
fi

IMAGE_REPO="${TARGET_REGISTRY}/${TARGET_REPO_PREFIX}"

TARGET_MANAGER_IMAGE="${IMAGE_REPO}/manager:${TARGET_TAG}"
TARGET_CONTROLLER_IMAGE="${IMAGE_REPO}/controller:${TARGET_TAG}"
TARGET_ENFORCER_IMAGE="${IMAGE_REPO}/enforcer:${TARGET_TAG}"
TARGET_SCANNER_IMAGE="${IMAGE_REPO}/scanner:${TARGET_SCANNER_TAG}"
TARGET_UPDATER_IMAGE="${IMAGE_REPO}/updater:${TARGET_UPDATER_TAG}"

SOURCE_CONTROLLER_IMAGE="${SOURCE_REGISTRY}/${SOURCE_REPO_PREFIX}/controller:${SOURCE_TAG}"
SOURCE_ENFORCER_IMAGE="${SOURCE_REGISTRY}/${SOURCE_REPO_PREFIX}/enforcer:${SOURCE_TAG}"
SOURCE_SCANNER_IMAGE="${SOURCE_REGISTRY}/${SOURCE_REPO_PREFIX}/scanner:${SOURCE_SCANNER_TAG}"
SOURCE_UPDATER_IMAGE="${SOURCE_REGISTRY}/${SOURCE_REPO_PREFIX}/updater:${SOURCE_UPDATER_TAG}"

WORK_DIR="${SCRIPT_DIR}/.work"
mkdir -p "${WORK_DIR}"
TMP_VALUES_FILE="${WORK_DIR}/ui-only-overlay-${TARGET_TAG}.yaml"

build_manager_image() {
  require_cmd make docker
  log "Building manager image: ${TARGET_MANAGER_IMAGE}"
  (
    cd "${NV_ROOT}/manager"
    make build-image REPO="${IMAGE_REPO}" TAG="${TARGET_TAG}"
  )
}

sync_image() {
  local source_image="$1"
  local target_image="$2"

  log "Pulling source image: ${source_image}"
  docker pull "${source_image}"
  log "Tagging ${source_image} -> ${target_image}"
  docker tag "${source_image}" "${target_image}"
}

sync_core_images() {
  if [[ "${SKIP_SYNC_CORE_IMAGES}" == "true" ]]; then
    log "Skipping controller/enforcer/scanner/updater sync because SKIP_SYNC_CORE_IMAGES=true"
    return
  fi

  sync_image "${SOURCE_CONTROLLER_IMAGE}" "${TARGET_CONTROLLER_IMAGE}"
  sync_image "${SOURCE_ENFORCER_IMAGE}" "${TARGET_ENFORCER_IMAGE}"
  sync_image "${SOURCE_SCANNER_IMAGE}" "${TARGET_SCANNER_IMAGE}"
  sync_image "${SOURCE_UPDATER_IMAGE}" "${TARGET_UPDATER_IMAGE}"
}

push_image() {
  local image="$1"
  log "Pushing image: ${image}"
  docker push "${image}"
}

push_images() {
  push_image "${TARGET_MANAGER_IMAGE}"

  if [[ "${SKIP_SYNC_CORE_IMAGES}" != "true" ]]; then
    push_image "${TARGET_CONTROLLER_IMAGE}"
    push_image "${TARGET_ENFORCER_IMAGE}"
    push_image "${TARGET_SCANNER_IMAGE}"
    push_image "${TARGET_UPDATER_IMAGE}"
  fi
}

export_image() {
  local image="$1"
  local output_file="${EXPORT_DIR}/$(safe_name "${image}").tar"
  mkdir -p "${EXPORT_DIR}"
  log "Exporting ${image} -> ${output_file}"
  docker save -o "${output_file}" "${image}"
}

export_images() {
  export_image "${TARGET_MANAGER_IMAGE}"

  if [[ "${SKIP_SYNC_CORE_IMAGES}" != "true" ]]; then
    export_image "${TARGET_CONTROLLER_IMAGE}"
    export_image "${TARGET_ENFORCER_IMAGE}"
    export_image "${TARGET_SCANNER_IMAGE}"
    export_image "${TARGET_UPDATER_IMAGE}"
  fi
}

import_images() {
  require_cmd bash
  [[ -f "${IMPORT_SCRIPT}" ]] || die "Import helper does not exist: ${IMPORT_SCRIPT}"

  local images=("${TARGET_MANAGER_IMAGE}")
  if [[ "${SKIP_SYNC_CORE_IMAGES}" != "true" ]]; then
    images+=(
      "${TARGET_CONTROLLER_IMAGE}"
      "${TARGET_ENFORCER_IMAGE}"
      "${TARGET_SCANNER_IMAGE}"
      "${TARGET_UPDATER_IMAGE}"
    )
  fi

  log "Importing images into ${CLUSTER_TYPE}"
  KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME}" \
  K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME}" \
  MINIKUBE_PROFILE="${MINIKUBE_PROFILE}" \
    bash "${IMPORT_SCRIPT}" "${CLUSTER_TYPE}" "${images[@]}"
}

write_overlay_values() {
  log "Writing helm overlay: ${TMP_VALUES_FILE}"
  cat > "${TMP_VALUES_FILE}" <<EOF
registry: ${TARGET_REGISTRY}
tag: ${TARGET_TAG}
controller:
  image:
    repository: ${TARGET_REPO_PREFIX}/controller
    imagePullPolicy: IfNotPresent
enforcer:
  image:
    repository: ${TARGET_REPO_PREFIX}/enforcer
    imagePullPolicy: IfNotPresent
manager:
  image:
    repository: ${TARGET_REPO_PREFIX}/manager
    imagePullPolicy: IfNotPresent
cve:
  updater:
    image:
      registry: ""
      repository: ${TARGET_REPO_PREFIX}/updater
      imagePullPolicy: IfNotPresent
      tag: "${TARGET_UPDATER_TAG}"
  scanner:
    image:
      registry: ""
      repository: ${TARGET_REPO_PREFIX}/scanner
      imagePullPolicy: IfNotPresent
      tag: "${TARGET_SCANNER_TAG}"
EOF

  if [[ -n "${IMAGE_PULL_SECRET}" ]]; then
    cat >> "${TMP_VALUES_FILE}" <<EOF
imagePullSecrets: ${IMAGE_PULL_SECRET}
EOF
  fi

  case "${CONTAINER_RUNTIME}" in
    containerd)
      cat >> "${TMP_VALUES_FILE}" <<'EOF'
containerd:
  enabled: true
EOF
      ;;
    crio)
      cat >> "${TMP_VALUES_FILE}" <<'EOF'
crio:
  enabled: true
EOF
      ;;
    docker)
      cat >> "${TMP_VALUES_FILE}" <<'EOF'
containerd:
  enabled: false
crio:
  enabled: false
EOF
      ;;
    *)
      die "Unsupported CONTAINER_RUNTIME: ${CONTAINER_RUNTIME}"
      ;;
  esac

  if [[ -n "${RUNTIME_PATH}" ]]; then
    cat >> "${TMP_VALUES_FILE}" <<EOF
runtimePath: ${RUNTIME_PATH}
EOF
  fi
}

helm_upgrade() {
  require_cmd helm kubectl

  local cmd=(
    helm upgrade --install "${RELEASE_NAME}" "${HELM_CHART_PATH}"
    -n "${NAMESPACE}"
    --create-namespace
  )

  if [[ -n "${BASE_VALUES_FILE}" ]]; then
    cmd+=(-f "${BASE_VALUES_FILE}")
  fi
  cmd+=(-f "${TMP_VALUES_FILE}")

  log "Running helm upgrade"
  "${cmd[@]}"
}

main() {
  build_manager_image
  sync_core_images
  write_overlay_values

  case "${DEPLOY_MODE}" in
    registry)
      push_images
      helm_upgrade
      ;;
    local-import)
      export_images
      import_images
      helm_upgrade
      ;;
    export-only)
      export_images
      log "Export-only mode completed. No helm action was executed."
      ;;
  esac

  log "Overlay file: ${TMP_VALUES_FILE}"
  if [[ "${DEPLOY_MODE}" == "local-import" || "${DEPLOY_MODE}" == "export-only" ]]; then
    log "Image archives: ${EXPORT_DIR}"
  fi
}

main "$@"
