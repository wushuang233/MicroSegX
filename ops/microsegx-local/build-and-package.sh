#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FULL_RELEASE_ENV="${FULL_RELEASE_ENV:-${1:-${ROOT_DIR}/ops/full-release/full-release.env}}"
KNS_ROOT="${ROOT_DIR}/k8s-node-surface"
STACK_VERSION="$(head -n 1 "${KNS_ROOT}/VERSION" | tr -d '[:space:]')"

if [[ ! -f "${FULL_RELEASE_ENV}" ]]; then
  echo "Missing full-release env: ${FULL_RELEASE_ENV}" >&2
  echo "Set FULL_RELEASE_ENV or pass the env file path as the first argument." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${FULL_RELEASE_ENV}"

: "${CORE_TAG:?CORE_TAG is required in ${FULL_RELEASE_ENV}}"

FULL_RELEASE_ARTIFACT_DIR="${ARTIFACT_DIR:-${ROOT_DIR}/artifacts/full-release/${CORE_TAG}}"
MICROSEGX_ARTIFACT_DIR="${MICROSEGX_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/microsegx-local/${CORE_TAG}}"
STACK_BUNDLE_DIR="${KNS_ROOT}/dist/k8s-port-audit-stack-local-${STACK_VERSION}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd bash
require_cmd mkdir
require_cmd tar

echo "==> Building manager/core full-release bundle"
bash "${ROOT_DIR}/ops/full-release/build-and-package.sh" "${FULL_RELEASE_ENV}"

echo "==> Building MicroSegX port-audit + OpenZiti stack bundle"
(
  cd "${KNS_ROOT}"
  bash scripts/build-stack-image-bundle.sh
)

if [[ ! -d "${FULL_RELEASE_ARTIFACT_DIR}" ]]; then
  echo "Expected core artifact directory does not exist: ${FULL_RELEASE_ARTIFACT_DIR}" >&2
  exit 1
fi

if [[ ! -d "${STACK_BUNDLE_DIR}" ]]; then
  echo "Expected stack bundle directory does not exist: ${STACK_BUNDLE_DIR}" >&2
  exit 1
fi

rm -rf "${MICROSEGX_ARTIFACT_DIR}"
mkdir -p "${MICROSEGX_ARTIFACT_DIR}/core" "${MICROSEGX_ARTIFACT_DIR}/port-audit-stack"

tar -C "${FULL_RELEASE_ARTIFACT_DIR}" -cf - . | tar -C "${MICROSEGX_ARTIFACT_DIR}/core" -xf -
tar -C "${STACK_BUNDLE_DIR}" -cf - . | tar -C "${MICROSEGX_ARTIFACT_DIR}/port-audit-stack" -xf -

cp "${SCRIPT_DIR}/deploy-local.sh" "${MICROSEGX_ARTIFACT_DIR}/deploy-local.sh"
cp "${SCRIPT_DIR}/setup-k3s-offline-auto-import.sh" "${MICROSEGX_ARTIFACT_DIR}/setup-k3s-offline-auto-import.sh"
cp "${SCRIPT_DIR}/manager-microsegx.overlay.yaml.example" "${MICROSEGX_ARTIFACT_DIR}/manager-microsegx.overlay.yaml.example"
cp "${SCRIPT_DIR}/microsegx-local.env.example" "${MICROSEGX_ARTIFACT_DIR}/microsegx-local.env.example"
cp "${ROOT_DIR}/MicroSegX-本地K8s一体化部署说明.zh-CN.md" "${MICROSEGX_ARTIFACT_DIR}/MicroSegX-本地K8s一体化部署说明.zh-CN.md"

cat >"${MICROSEGX_ARTIFACT_DIR}/README.md" <<EOF
# MicroSegX 本地 K8s 交付包

这份目录把两条交付链收在一起：

- \`core/\`
  MicroSegX manager/controller/enforcer/scanner 的 full-release 产物
- \`port-audit-stack/\`
  port-audit + OpenZiti 的 stack bundle

快速入口：

\`\`\`bash
FULL_RELEASE_ENV=/abs/path/to/full-release.env bash ./deploy-local.sh
\`\`\`

部署完成后，如果目标机器是单机 k3s，本地离线模式建议再执行：

\`\`\`bash
bash ./setup-k3s-offline-auto-import.sh
\`\`\`

更详细说明：

- \`MicroSegX-本地K8s一体化部署说明.zh-CN.md\`

关键产物：

- Core 镜像归档：\`core/images-${CORE_TAG}.tar.gz\`
- Core helm charts：\`core/bundle/charts/\`
- Port-audit stack 镜像：\`port-audit-stack/k8s-port-audit-stack-${STACK_VERSION}.tar\`
- Port-audit installer：\`port-audit-stack/openziti-stack-installer-local.yaml\`
- 开机自动导入脚本：\`setup-k3s-offline-auto-import.sh\`
EOF

echo
echo "MicroSegX bundle created:"
echo "  ${MICROSEGX_ARTIFACT_DIR}"
