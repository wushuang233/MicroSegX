#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NV_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
ENV_FILE="${1:-${SCRIPT_DIR}/full-release.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  echo "Copy ${SCRIPT_DIR}/full-release.env.example to ${SCRIPT_DIR}/full-release.env first." >&2
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

TARGET_PLATFORM=${TARGET_PLATFORM:-linux/amd64}
ARTIFACT_DIR=${ARTIFACT_DIR:-"${NV_ROOT}/artifacts/full-release/${CORE_TAG}"}
BUNDLE_DIR="${ARTIFACT_DIR}/bundle"
IMAGES_FILE="${BUNDLE_DIR}/image-list.txt"
METADATA_FILE="${BUNDLE_DIR}/build-metadata.txt"
IMAGE_TAR="${ARTIFACT_DIR}/images-${CORE_TAG}.tar.gz"

MICROSEGX_DIR="${NV_ROOT}/microsegx"
MANAGER_DIR="${NV_ROOT}/manager"
SCANNER_DIR="${NV_ROOT}/scanner"
HELM_DIR="${NV_ROOT}/microsegx-helm"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd docker
require_cmd git
require_cmd gzip
require_cmd tar
require_cmd bash

mkdir -p "${ARTIFACT_DIR}" "${BUNDLE_DIR}"
rm -f "${IMAGES_FILE}" "${METADATA_FILE}" "${IMAGE_TAR}"
rm -rf "${BUNDLE_DIR}/charts"
mkdir -p "${BUNDLE_DIR}/charts"

tagged_image() {
  local name="$1"
  echo "${REGISTRY}/${IMAGE_NAMESPACE}/${name}"
}

append_image() {
  local image="$1"
  if ! grep -qxF "${image}" "${IMAGES_FILE}" 2>/dev/null; then
    echo "${image}" >>"${IMAGES_FILE}"
  fi
}

build_local_image() {
  local name="$1"
  local context_dir="$2"
  local dockerfile="$3"
  local version_tag="$4"
  local commit
  commit=$(git -C "${context_dir}" rev-parse --short HEAD)
  local image
  image="$(tagged_image "${name}"):${version_tag}"

  echo "==> Building ${image}"
  docker buildx build \
    --platform "${TARGET_PLATFORM}" \
    --load \
    --build-arg VERSION="${version_tag}" \
    --build-arg COMMIT="${commit}" \
    -t "${image}" \
    -f "${dockerfile}" \
    "${context_dir}"

  append_image "${image}"
  {
    echo "${name}.repo=${context_dir}"
    echo "${name}.commit=${commit}"
    echo "${name}.image=${image}"
  } >>"${METADATA_FILE}"
}

mirror_upstream_image() {
  local source_image="$1"
  local target_name="$2"
  local target_tag="$3"
  local target_image
  target_image="$(tagged_image "${target_name}"):${target_tag}"

  echo "==> Mirroring ${source_image} -> ${target_image}"
  docker pull "${source_image}"
  docker tag "${source_image}" "${target_image}"

  append_image "${target_image}"
  {
    echo "${target_name}.source=${source_image}"
    echo "${target_name}.image=${target_image}"
  } >>"${METADATA_FILE}"
}

build_microsegx_binaries() {
  require_cmd make

  echo "==> Building controller/enforcer binaries from source"
  make -C "${MICROSEGX_DIR}/controller"
  make -C "${MICROSEGX_DIR}/agent"
  make -C "${MICROSEGX_DIR}/upgrader"
  make -C "${MICROSEGX_DIR}/tools/nstools"
  make -C "${MICROSEGX_DIR}/monitor"
  make -C "${MICROSEGX_DIR}/agent/workerlet/pathWalker"
  make -C "${MICROSEGX_DIR}/dp"
}

build_scanner_binaries() {
  require_cmd make
  require_cmd go

  echo "==> Building scanner binaries from source"
  (
    cd "${SCANNER_DIR}"
    GOFLAGS=-mod=mod go build -ldflags='-s -w' -buildvcs=false -o scanner .
    GOFLAGS=-mod=mod make -C task
    GOFLAGS=-mod=mod make -C monitor
  )
}

build_manager_artifacts() {
  echo "==> Building manager artifacts from source"
  (
    cd "${MANAGER_DIR}"
    bash package/build_manager.sh
  )
}

cp -R "${HELM_DIR}/charts" "${BUNDLE_DIR}/"
cp "${SCRIPT_DIR}/deploy-core.sh" "${BUNDLE_DIR}/deploy-core.sh"
cp "${SCRIPT_DIR}/load-and-push.sh" "${BUNDLE_DIR}/load-and-push.sh"
cp "${SCRIPT_DIR}/load-local-images.sh" "${BUNDLE_DIR}/load-local-images.sh"
cp "${SCRIPT_DIR}/reset-microsegx.sh" "${BUNDLE_DIR}/reset-microsegx.sh"
cp "${SCRIPT_DIR}/full-release.env.example" "${BUNDLE_DIR}/full-release.env.example"
cp "${ENV_FILE}" "${BUNDLE_DIR}/full-release.env"

bash "${SCRIPT_DIR}/prepare-scanner-db.sh"

USE_LOCAL_DOCKERFILES=${USE_LOCAL_DOCKERFILES:-true}
BUILD_FROM_SOURCE=${BUILD_FROM_SOURCE:-true}

if [[ "${USE_LOCAL_DOCKERFILES}" == "true" ]]; then
  if [[ "${BUILD_FROM_SOURCE}" == "true" ]]; then
    build_microsegx_binaries
    build_scanner_binaries
    build_manager_artifacts
  fi

  build_local_image controller "${NV_ROOT}" "${NV_ROOT}/docker-images/Dockerfile.controller" "${CORE_TAG}"
  build_local_image enforcer "${NV_ROOT}" "${NV_ROOT}/docker-images/Dockerfile.enforcer" "${CORE_TAG}"
  build_local_image manager "${NV_ROOT}" "${NV_ROOT}/docker-images/Dockerfile.manager" "${CORE_TAG}"
  build_local_image scanner "${NV_ROOT}" "${NV_ROOT}/docker-images/Dockerfile.scanner" "${SCANNER_TAG}"
else
  build_local_image controller "${MICROSEGX_DIR}" "${MICROSEGX_DIR}/package/Dockerfile.controller" "${CORE_TAG}"
  build_local_image enforcer "${MICROSEGX_DIR}" "${MICROSEGX_DIR}/package/Dockerfile.enforcer" "${CORE_TAG}"
  build_local_image manager "${MANAGER_DIR}" "${MANAGER_DIR}/package/Dockerfile" "${CORE_TAG}"
  build_local_image scanner "${SCANNER_DIR}" "${SCANNER_DIR}/package/Dockerfile" "${SCANNER_TAG}"
fi

if [[ "${BUILD_UPDATER_FROM_SOURCE:-true}" == "true" ]]; then
  build_local_image updater "${NV_ROOT}" "${NV_ROOT}/docker-images/Dockerfile.updater" "${UPDATER_TAG:-0.0.9}"
elif [[ "${MIRROR_UPDATER:-true}" == "true" ]]; then
  mirror_upstream_image "${UPSTREAM_UPDATER_IMAGE:-microsegx/updater:0.0.9}" updater "${UPDATER_TAG:-0.0.9}"
fi

if [[ "${MIRROR_REGISTRY_ADAPTER:-false}" == "true" ]]; then
  mirror_upstream_image "${UPSTREAM_REGISTRY_ADAPTER_IMAGE:-microsegx/registry-adapter:0.2.4}" registry-adapter "${REGISTRY_ADAPTER_TAG:-0.2.4}"
fi

if [[ "${MIRROR_COMPLIANCE_CONFIG:-false}" == "true" ]]; then
  mirror_upstream_image "${UPSTREAM_COMPLIANCE_CONFIG_IMAGE:-microsegx/compliance-config:1.0.11}" compliance-config "${COMPLIANCE_CONFIG_TAG:-1.0.11}"
fi

echo "==> Exporting images to ${IMAGE_TAR}"
# shellcheck disable=SC2046
docker save $(tr '\n' ' ' <"${IMAGES_FILE}") | gzip >"${IMAGE_TAR}"
sha256sum "${IMAGE_TAR}" >"${IMAGE_TAR}.sha256"

{
  echo "release_name=${RELEASE_NAME:-microsegx}"
  echo "namespace=${NAMESPACE:-microsegx}"
  echo "registry=${REGISTRY}"
  echo "image_namespace=${IMAGE_NAMESPACE}"
  echo "core_tag=${CORE_TAG}"
  echo "scanner_tag=${SCANNER_TAG}"
  echo "target_platform=${TARGET_PLATFORM}"
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >>"${METADATA_FILE}"

echo
echo "Bundle created:"
echo "  Images archive: ${IMAGE_TAR}"
echo "  Image list:     ${IMAGES_FILE}"
echo "  Metadata:       ${METADATA_FILE}"
echo "  Charts copy:    ${BUNDLE_DIR}/charts"
echo
echo "Next step on the target server:"
echo "  1. Copy ${ARTIFACT_DIR} to the target server"
if [[ "${DEPLOY_MODE}" == "local" ]]; then
  echo "  2. Run load-local-images.sh"
  echo "  3. Run deploy-core.sh"
else
  echo "  2. Run load-and-push.sh"
  echo "  3. Run deploy-core.sh"
fi
