#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="${ROOT_DIR}/.artifacts/k3s-auto-import"
HELPER_NAMESPACE="${HELPER_NAMESPACE:-default}"
HELPER_NAME="${HELPER_NAME:-k3s-offline-auto-import-helper}"
HELPER_IMAGE="${HELPER_IMAGE:-busybox:1.36}"
K3S_IMAGE_DIR="${K3S_IMAGE_DIR:-/var/lib/rancher/k3s/agent/images}"
CONTAINERD_NAMESPACE="${CONTAINERD_NAMESPACE:-k8s.io}"
NODE_NAME="${NODE_NAME:-}"

CORE_RELEASE_TGZ="${CORE_RELEASE_TGZ:-${ROOT_DIR}/artifacts/k8s-delivery/microsegx-suite-2026.04.13-k8s-ctr-r1/microsegx-release-2026.04.13-k8s-ctr-r1.tar.gz}"
CORE_INNER_IMAGE_GZ="${CORE_INNER_IMAGE_GZ:-2026.04.13-k8s-ctr-r1/images-2026.04.13-k8s-ctr-r1.tar.gz}"
OPENZITI_IMAGE_GZ="${OPENZITI_IMAGE_GZ:-${ROOT_DIR}/openziti/dist/openziti-k8s-offline-2026.04.13-k8s-ctr-r1/openziti-images-2026.04.13-k8s-ctr-r1.tar.gz}"
PORT_AUDIT_IMAGE_TAR="${PORT_AUDIT_IMAGE_TAR:-${ROOT_DIR}/.artifacts/k8s-port-audit-0.2.2.tar}"
EDGE_TUNNEL_IMAGE="${EDGE_TUNNEL_IMAGE:-openziti/ziti-edge-tunnel:latest}"
MANAGER_IMAGE="${MANAGER_IMAGE:-}"
CONTROLLER_IMAGE="${CONTROLLER_IMAGE:-}"
ENFORCER_IMAGE="${ENFORCER_IMAGE:-}"
SCANNER_IMAGE="${SCANNER_IMAGE:-}"
EXTRA_IMAGE_TARS=()

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_file() {
  [[ -f "$1" ]] || {
    echo "Required file not found: $1" >&2
    exit 1
  }
}

detect_manager_image() {
  if [[ -n "${MANAGER_IMAGE}" ]]; then
    return
  fi
  MANAGER_IMAGE="$(kubectl get deploy microsegx-manager-pod -n microsegx -o jsonpath='{.spec.template.spec.containers[0].image}')"
  if [[ -z "${MANAGER_IMAGE}" ]]; then
    echo "Unable to detect current manager image from deployment." >&2
    exit 1
  fi
}

detect_current_microsegx_images() {
  if [[ -z "${CONTROLLER_IMAGE}" ]]; then
    CONTROLLER_IMAGE="$(kubectl get deploy microsegx-controller-pod -n microsegx -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
  fi
  if [[ -z "${ENFORCER_IMAGE}" ]]; then
    ENFORCER_IMAGE="$(kubectl get ds microsegx-enforcer-pod -n microsegx -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
  fi
  if [[ -z "${SCANNER_IMAGE}" ]]; then
    SCANNER_IMAGE="$(kubectl get deploy microsegx-scanner-pod -n microsegx -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
  fi
}

sanitize_image_name() {
  echo "$1" | tr '/:' '__'
}

export_if_docker_present() {
  local image="$1"
  [[ -n "${image}" ]] || return 0
  if ! docker image inspect "${image}" >/dev/null 2>&1; then
    echo "WARN: image not present in local docker, skipping archive export: ${image}" >&2
    return 0
  fi

  local image_tar="${ARTIFACT_DIR}/$(sanitize_image_name "${image}").tar"
  if [[ ! -f "${image_tar}" ]]; then
    echo "==> Exporting runtime image ${image}"
    docker save -o "${image_tar}" "${image}"
  fi
  EXTRA_IMAGE_TARS+=("${image_tar}")
}

ensure_artifacts() {
  mkdir -p "${ARTIFACT_DIR}"

  require_file "${CORE_RELEASE_TGZ}"
  require_file "${OPENZITI_IMAGE_GZ}"

  local core_image_tar="${ARTIFACT_DIR}/images-2026.04.13-k8s-ctr-r1.tar"
  if [[ ! -f "${core_image_tar}" ]]; then
    echo "==> Extracting core image bundle"
    tar -xOf "${CORE_RELEASE_TGZ}" "${CORE_INNER_IMAGE_GZ}" | gzip -dc >"${core_image_tar}"
  fi

  if [[ ! -f "${PORT_AUDIT_IMAGE_TAR}" ]]; then
    echo "==> Exporting port-audit image from docker"
    docker image inspect local/k8s-port-audit:0.2.2 >/dev/null
    docker save -o "${PORT_AUDIT_IMAGE_TAR}" local/k8s-port-audit:0.2.2
  fi

  local openziti_image_tar="${ARTIFACT_DIR}/openziti-images-2026.04.13-k8s-ctr-r1.tar"
  if [[ ! -f "${openziti_image_tar}" ]]; then
    echo "==> Expanding OpenZiti offline image bundle"
    gzip -dc "${OPENZITI_IMAGE_GZ}" >"${openziti_image_tar}"
  fi

  detect_manager_image
  detect_current_microsegx_images
  local manager_tar="${ARTIFACT_DIR}/$(sanitize_image_name "${MANAGER_IMAGE}").tar"
  if [[ ! -f "${manager_tar}" ]]; then
    echo "==> Exporting current manager image ${MANAGER_IMAGE}"
    docker image inspect "${MANAGER_IMAGE}" >/dev/null
    docker save -o "${manager_tar}" "${MANAGER_IMAGE}"
  fi

  local edge_tunnel_tar="${ARTIFACT_DIR}/$(sanitize_image_name "${EDGE_TUNNEL_IMAGE}").tar"
  if [[ ! -f "${edge_tunnel_tar}" ]]; then
    echo "==> Exporting edge tunnel image ${EDGE_TUNNEL_IMAGE}"
    docker image inspect "${EDGE_TUNNEL_IMAGE}" >/dev/null
    docker save -o "${edge_tunnel_tar}" "${EDGE_TUNNEL_IMAGE}"
  fi

  export_if_docker_present "${CONTROLLER_IMAGE}"
  export_if_docker_present "${ENFORCER_IMAGE}"
  export_if_docker_present "${SCANNER_IMAGE}"
}

ensure_helper_node() {
  if [[ -n "${NODE_NAME}" ]]; then
    kubectl get node "${NODE_NAME}" >/dev/null
    return
  fi
  NODE_NAME="$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')"
  if [[ -z "${NODE_NAME}" ]]; then
    echo "Unable to determine Kubernetes node name." >&2
    exit 1
  fi
}

ensure_helper_pod() {
  ensure_helper_node
  kubectl delete pod "${HELPER_NAME}" -n "${HELPER_NAMESPACE}" --ignore-not-found >/dev/null 2>&1 || true
  cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: ${HELPER_NAME}
  namespace: ${HELPER_NAMESPACE}
spec:
  nodeName: ${NODE_NAME}
  restartPolicy: Never
  containers:
    - name: helper
      image: ${HELPER_IMAGE}
      command: ["sh", "-lc", "sleep 3600"]
      securityContext:
        privileged: true
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
          ephemeral-storage: 128Mi
        limits:
          cpu: 200m
          memory: 256Mi
          ephemeral-storage: 512Mi
      volumeMounts:
        - name: host-root
          mountPath: /hostfs
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
  kubectl wait --for=condition=Ready "pod/${HELPER_NAME}" -n "${HELPER_NAMESPACE}" --timeout=120s >/dev/null
}

copy_archive_to_host() {
  local src="$1"
  local filename
  filename="$(basename "${src}")"
  kubectl exec -n "${HELPER_NAMESPACE}" "${HELPER_NAME}" -- sh -lc \
    "mkdir -p /hostfs${K3S_IMAGE_DIR} && cp /hostfs${src} /hostfs${K3S_IMAGE_DIR}/${filename}"
}

import_archive_now() {
  local src="$1"
  if ! kubectl exec -n "${HELPER_NAMESPACE}" "${HELPER_NAME}" -- sh -lc \
    "/host/bin/k3s ctr -a /run/k3s/containerd/containerd.sock -n ${CONTAINERD_NAMESPACE} images import --all-platforms /hostfs${src}"; then
    echo "WARN: immediate import failed for $(basename "${src}"), but the archive has already been persisted under ${K3S_IMAGE_DIR} for future k3s auto-import." >&2
    return 1
  fi
}

main() {
  require_cmd kubectl
  require_cmd docker
  require_cmd tar
  require_cmd gzip

  ensure_artifacts
  ensure_helper_pod

  local core_tar="${ARTIFACT_DIR}/images-2026.04.13-k8s-ctr-r1.tar"
  local openziti_tar="${ARTIFACT_DIR}/openziti-images-2026.04.13-k8s-ctr-r1.tar"
  local manager_tar="${ARTIFACT_DIR}/$(sanitize_image_name "${MANAGER_IMAGE}").tar"
  local edge_tunnel_tar="${ARTIFACT_DIR}/$(sanitize_image_name "${EDGE_TUNNEL_IMAGE}").tar"
  local archives=(
    "${core_tar}"
    "${PORT_AUDIT_IMAGE_TAR}"
    "${openziti_tar}"
    "${manager_tar}"
    "${edge_tunnel_tar}"
    "${EXTRA_IMAGE_TARS[@]}"
  )

  echo "==> Syncing required archives into ${K3S_IMAGE_DIR}"
  for archive in "${archives[@]}"; do
    [[ -n "${archive}" ]] || continue
    copy_archive_to_host "${archive}"
  done

  echo "==> Importing required archives into current k3s containerd"
  local import_failed=0
  for archive in "${archives[@]}"; do
    [[ -n "${archive}" ]] || continue
    import_archive_now "${archive}" || import_failed=1
  done

  echo "==> Current k3s image store now contains"
  kubectl exec -n "${HELPER_NAMESPACE}" "${HELPER_NAME}" -- sh -lc \
    "/host/bin/k3s ctr -a /run/k3s/containerd/containerd.sock -n ${CONTAINERD_NAMESPACE} images ls | grep -E 'local.microsegx/microsegx/(controller|scanner|enforcer|updater|manager)|local/k8s-port-audit|openziti/ziti-edge-tunnel|docker.io/openziti/ziti-(controller|router)'"

  echo
  echo "Offline auto-import archives are now persisted under ${K3S_IMAGE_DIR}."
  echo "On future k3s restarts, these archives will be available for auto-import."
  if [[ "${import_failed}" -ne 0 ]]; then
    echo "Some archives were not imported immediately into the current runtime, but the persisted auto-import set is complete." >&2
  fi
}

main "$@"
