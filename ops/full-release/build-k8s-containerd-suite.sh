#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${1:-${SCRIPT_DIR}/full-release.k8s-delivery.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

: "${CORE_TAG:?CORE_TAG is required}"

PORT_AUDIT_VERSION="$(head -n 1 "${ROOT_DIR}/k8s-node-surface/VERSION" | tr -d '[:space:]')"
OPENZITI_BUNDLE_TAG="${OPENZITI_BUNDLE_TAG:-${CORE_TAG}}"

MICROSEGX_RELEASE_DIR="${ROOT_DIR}/artifacts/full-release/${CORE_TAG}"
MICROSEGX_ARCHIVE="${ROOT_DIR}/artifacts/full-release/microsegx-release-${CORE_TAG}.tar.gz"
PORT_AUDIT_ARCHIVE="${ROOT_DIR}/k8s-node-surface/dist/k8s-port-audit-containerd-${PORT_AUDIT_VERSION}.tar.gz"
OPENZITI_ARCHIVE="${ROOT_DIR}/openziti/dist/openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}.tar.gz"
SUITE_ROOT="${ROOT_DIR}/artifacts/k8s-delivery"
SUITE_DIR="${SUITE_ROOT}/microsegx-suite-${CORE_TAG}"
SUITE_ARCHIVE="${SUITE_ROOT}/microsegx-suite-${CORE_TAG}.tar.gz"
DOC_SOURCE="${ROOT_DIR}/docs/K8S-CONTAINERD-DELIVERY-MANUAL.md"
DOC_TARGET="${SUITE_DIR}/DEPLOY.md"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd bash
require_cmd sha256sum
require_cmd tar

bash "${SCRIPT_DIR}/build-and-package.sh" "${ENV_FILE}"
tar -C "${ROOT_DIR}/artifacts/full-release" -czf "${MICROSEGX_ARCHIVE}" "${CORE_TAG}"
sha256sum "${MICROSEGX_ARCHIVE}" >"${MICROSEGX_ARCHIVE}.sha256"

bash "${ROOT_DIR}/k8s-node-surface/scripts/build-containerd-bundle.sh"
OPENZITI_BUNDLE_TAG="${OPENZITI_BUNDLE_TAG}" bash "${ROOT_DIR}/openziti/build-openziti-offline-bundle.sh"

rm -rf "${SUITE_DIR}"
mkdir -p "${SUITE_DIR}"

cp "${MICROSEGX_ARCHIVE}" "${SUITE_DIR}/"
cp "${MICROSEGX_ARCHIVE}.sha256" "${SUITE_DIR}/"
cp "${PORT_AUDIT_ARCHIVE}" "${SUITE_DIR}/"
cp "${PORT_AUDIT_ARCHIVE}.sha256" "${SUITE_DIR}/"
cp "${OPENZITI_ARCHIVE}" "${SUITE_DIR}/"
cp "${OPENZITI_ARCHIVE}.sha256" "${SUITE_DIR}/"
cp "${DOC_SOURCE}" "${DOC_TARGET}"

cat >"${SUITE_DIR}/VERSION.txt" <<EOF
CORE_TAG=${CORE_TAG}
PORT_AUDIT_VERSION=${PORT_AUDIT_VERSION}
OPENZITI_BUNDLE_TAG=${OPENZITI_BUNDLE_TAG}
MICROSEGX_ARCHIVE=$(basename "${MICROSEGX_ARCHIVE}")
PORT_AUDIT_ARCHIVE=$(basename "${PORT_AUDIT_ARCHIVE}")
OPENZITI_ARCHIVE=$(basename "${OPENZITI_ARCHIVE}")
EOF

(
  cd "${SUITE_DIR}"
  sha256sum \
    "$(basename "${MICROSEGX_ARCHIVE}")" \
    "$(basename "${PORT_AUDIT_ARCHIVE}")" \
    "$(basename "${OPENZITI_ARCHIVE}")" \
    DEPLOY.md \
    VERSION.txt >CHECKSUMS.sha256
)

tar -C "${SUITE_ROOT}" -czf "${SUITE_ARCHIVE}" "$(basename "${SUITE_DIR}")"
sha256sum "${SUITE_ARCHIVE}" >"${SUITE_ARCHIVE}.sha256"

echo "Suite bundle created: ${SUITE_ARCHIVE}"
