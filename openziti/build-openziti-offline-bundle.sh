#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_TEMPLATE="${SCRIPT_DIR}/openziti.k8s.env.example"
IMAGES_FILE="${SCRIPT_DIR}/openziti-images.txt"
OUTPUT_ROOT="${OUTPUT_ROOT:-${SCRIPT_DIR}/dist}"
OPENZITI_BUNDLE_TAG="${OPENZITI_BUNDLE_TAG:-$(date +%Y.%m.%d)-offline-r1}"
BUNDLE_DIR="${OUTPUT_ROOT}/openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}"
CHARTS_DIR="${BUNDLE_DIR}/charts"
IMAGE_ARCHIVE="${BUNDLE_DIR}/openziti-images-${OPENZITI_BUNDLE_TAG}.tar.gz"
ARCHIVE_PATH="${OUTPUT_ROOT}/openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}.tar.gz"
README_PATH="${BUNDLE_DIR}/README.md"
K3S_CONTAINERD_SOCKET="${K3S_CONTAINERD_SOCKET:-/run/k3s/containerd/containerd.sock}"
K3S_BIN_PATH="${K3S_BIN_PATH:-/usr/local/bin/k3s}"
K3S_EXPORT_HELPER_IMAGE="${K3S_EXPORT_HELPER_IMAGE:-ubuntu:24.04}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd docker
require_cmd gzip
require_cmd helm
require_cmd sha256sum
require_cmd tar

if [[ ! -f "${ENV_TEMPLATE}" ]]; then
  echo "Missing env template: ${ENV_TEMPLATE}" >&2
  exit 1
fi

if [[ ! -f "${IMAGES_FILE}" ]]; then
  echo "Missing image list: ${IMAGES_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_TEMPLATE}"

: "${CERT_MANAGER_CHART_VERSION:=1.20.1}"
: "${TRUST_MANAGER_CHART_VERSION:=0.22.0}"
: "${ZITI_CONTROLLER_CHART_VERSION:=3.1.1}"
: "${ZITI_ROUTER_CHART_VERSION:=2.1.0}"

load_image_via_k3s_containerd() {
  local image="$1"
  local tmp_tar="$2"

  if [[ ! -S "${K3S_CONTAINERD_SOCKET}" || ! -x "${K3S_BIN_PATH}" ]]; then
    return 1
  fi

  chmod 666 "${tmp_tar}"

  docker run --rm -u 0 \
    -v "${K3S_CONTAINERD_SOCKET}:${K3S_CONTAINERD_SOCKET}" \
    -v "${K3S_BIN_PATH}:${K3S_BIN_PATH}" \
    -v "$(dirname "${tmp_tar}"):/out" \
    --entrypoint "${K3S_BIN_PATH}" \
    "${K3S_EXPORT_HELPER_IMAGE}" \
    ctr -a "${K3S_CONTAINERD_SOCKET}" -n k8s.io images export "/out/$(basename "${tmp_tar}")" "${image}" >/dev/null

  docker load -i "${tmp_tar}" >/dev/null
}

rm -rf "${BUNDLE_DIR}"
mkdir -p "${CHARTS_DIR}"
rm -f "${ARCHIVE_PATH}"

helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
helm repo add openziti https://docs.openziti.io/helm-charts/ >/dev/null 2>&1 || true
helm repo update >/dev/null

helm pull jetstack/cert-manager --version "${CERT_MANAGER_CHART_VERSION}" --destination "${CHARTS_DIR}"
helm pull jetstack/trust-manager --version "${TRUST_MANAGER_CHART_VERSION}" --destination "${CHARTS_DIR}"
helm pull openziti/ziti-controller --version "${ZITI_CONTROLLER_CHART_VERSION}" --destination "${CHARTS_DIR}"
helm pull openziti/ziti-router --version "${ZITI_ROUTER_CHART_VERSION}" --destination "${CHARTS_DIR}"

images=()
while IFS= read -r image; do
  image="$(printf '%s' "${image}" | tr -d '[:space:]')"
  [[ -n "${image}" ]] || continue
    if ! docker image inspect "${image}" >/dev/null 2>&1; then
    if ! docker pull "${image}" >/dev/null 2>&1; then
      tmp_tar="$(mktemp -p "${BUNDLE_DIR}" image.XXXXXX.tar)"
      if ! load_image_via_k3s_containerd "${image}" "${tmp_tar}"; then
        rm -f "${tmp_tar}"
        echo "Unable to obtain image: ${image}" >&2
        exit 1
      fi
      rm -f "${tmp_tar}"
    fi
  fi
  images+=("${image}")
done <"${IMAGES_FILE}"

if [[ "${#images[@]}" -eq 0 ]]; then
  echo "No images found in ${IMAGES_FILE}" >&2
  exit 1
fi

docker save "${images[@]}" | gzip >"${IMAGE_ARCHIVE}"
sha256sum "${IMAGE_ARCHIVE}" >"${IMAGE_ARCHIVE}.sha256"

cp "${SCRIPT_DIR}/deploy-openziti-k8s.sh" "${BUNDLE_DIR}/deploy-openziti-k8s.sh"
cp "${SCRIPT_DIR}/install-openziti-k8s.sh" "${BUNDLE_DIR}/install-openziti-k8s.sh"
cp "${SCRIPT_DIR}/import-openziti-images-containerd.sh" "${BUNDLE_DIR}/import-openziti-images-containerd.sh"
cp "${SCRIPT_DIR}/ziti-controller-values.yaml" "${BUNDLE_DIR}/ziti-controller-values.yaml"
cp "${SCRIPT_DIR}/ziti-router-values.yaml" "${BUNDLE_DIR}/ziti-router-values.yaml"
cp "${SCRIPT_DIR}/openziti.k8s.env.example" "${BUNDLE_DIR}/openziti.k8s.env.example"
cp "${SCRIPT_DIR}/openziti-images.txt" "${BUNDLE_DIR}/openziti-images.txt"

chmod +x \
  "${BUNDLE_DIR}/deploy-openziti-k8s.sh" \
  "${BUNDLE_DIR}/install-openziti-k8s.sh" \
  "${BUNDLE_DIR}/import-openziti-images-containerd.sh"

cat >"${README_PATH}" <<EOF
# OpenZiti 离线 Kubernetes 交付包

Bundle 标签：${OPENZITI_BUNDLE_TAG}

目录内容：

- openziti-images-${OPENZITI_BUNDLE_TAG}.tar.gz
- deploy-openziti-k8s.sh
- install-openziti-k8s.sh
- import-openziti-images-containerd.sh
- openziti.k8s.env.example
- ziti-controller-values.yaml
- ziti-router-values.yaml
- charts/

目标机器执行：

\`\`\`bash
cp ./openziti.k8s.env.example ./openziti.k8s.env
vi ./openziti.k8s.env
\`\`\`

每个节点先导入镜像：

\`\`\`bash
sudo bash ./import-openziti-images-containerd.sh
\`\`\`

再在有 kubectl/helm 权限的机器执行安装：

\`\`\`bash
bash ./install-openziti-k8s.sh ./openziti.k8s.env
\`\`\`
EOF

tar -C "${OUTPUT_ROOT}" -czf "${ARCHIVE_PATH}" "$(basename "${BUNDLE_DIR}")"
sha256sum "${ARCHIVE_PATH}" >"${ARCHIVE_PATH}.sha256"

echo "OpenZiti offline bundle created: ${ARCHIVE_PATH}"
