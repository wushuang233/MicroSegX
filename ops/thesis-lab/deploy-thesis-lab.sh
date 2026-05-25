#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB_YAML="${ROOT_DIR}/ops/thesis-lab/web-lab.yaml"
SSTI_YAML="${ROOT_DIR}/ops/thesis-lab/flask-ssti-lab.yaml"
NGINX_IMAGE="docker.io/local/exp-nginx:1.0"
NGINX_ARCHIVE="/tmp/exp-nginx-1.0.tar"
SSTI_ARCHIVE="/home/wushuang/test-py/flask-ssti/flask-ssti.tar"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd kubectl
require_cmd buildah
require_cmd ctr
require_cmd sudo

echo "==> Build nginx reverse proxy image"
sudo buildah bud \
  -t "${NGINX_IMAGE}" \
  -f "${ROOT_DIR}/ops/thesis-lab/nginx/Dockerfile" \
  "${ROOT_DIR}"

echo "==> Import nginx image into cluster runtime"
sudo buildah push "${NGINX_IMAGE}" "docker-archive:${NGINX_ARCHIVE}:${NGINX_IMAGE}"
sudo ctr -n k8s.io images import "${NGINX_ARCHIVE}"

echo "==> Import Flask SSTI image into cluster runtime"
sudo ctr -n k8s.io images import "${SSTI_ARCHIVE}"

echo "==> Apply manifests"
kubectl apply --validate=false -f "${WEB_YAML}"
kubectl apply --validate=false -f "${SSTI_YAML}"

echo "==> Wait for workloads"
kubectl rollout status deployment/nginx -n web --timeout=180s
kubectl rollout status deployment/frontend -n web --timeout=180s
kubectl rollout status deployment/backend -n web --timeout=180s
kubectl rollout status deployment/db -n web --timeout=180s
kubectl rollout status deployment/attacker -n web --timeout=180s
kubectl rollout status deployment/flask-ssti -n web --timeout=180s

echo
kubectl get pods,svc,cronjob -n web -o wide
