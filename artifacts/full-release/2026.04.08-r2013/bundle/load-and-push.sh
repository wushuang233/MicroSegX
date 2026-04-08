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

: "${REGISTRY:?REGISTRY is required}"

ARTIFACT_DIR=${ARTIFACT_DIR:-"${SCRIPT_DIR}"}
IMAGE_ARCHIVE=$(find "${ARTIFACT_DIR}" -maxdepth 1 -type f -name 'images-*.tar.gz' | head -n 1)
IMAGES_FILE="${ARTIFACT_DIR}/bundle/image-list.txt"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd docker

if [[ -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]]; then
  echo "==> Logging in to ${REGISTRY}"
  printf '%s' "${REGISTRY_PASSWORD}" | docker login "${REGISTRY}" --username "${REGISTRY_USERNAME}" --password-stdin
fi

if [[ -z "${IMAGE_ARCHIVE}" || ! -f "${IMAGE_ARCHIVE}" ]]; then
  echo "Cannot find images-*.tar.gz under ${ARTIFACT_DIR}" >&2
  exit 1
fi

if [[ ! -f "${IMAGES_FILE}" ]]; then
  echo "Cannot find image list: ${IMAGES_FILE}" >&2
  exit 1
fi

echo "==> Loading ${IMAGE_ARCHIVE}"
docker load -i "${IMAGE_ARCHIVE}"

while IFS= read -r image; do
  [[ -z "${image}" ]] && continue
  echo "==> Pushing ${image}"
  docker push "${image}"
done <"${IMAGES_FILE}"

echo
echo "Image push complete."
echo "You can now run deploy-core.sh on this server."
