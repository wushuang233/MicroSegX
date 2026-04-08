#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ZITI_NAMESPACE="${ZITI_NAMESPACE:-openziti}"
CERT_MANAGER_NAMESPACE="${CERT_MANAGER_NAMESPACE:-cert-manager}"

ZITI_CONTROLLER_RELEASE="${ZITI_CONTROLLER_RELEASE:-ziti-controller}"
ZITI_ROUTER_RELEASE="${ZITI_ROUTER_RELEASE:-ziti-router}"
ZITI_ROUTER_NAME="${ZITI_ROUTER_NAME:-ziti-router}"
ZITI_ROUTER_ROLE="${ZITI_ROUTER_ROLE:-public-router}"

CERT_MANAGER_CHART_VERSION="${CERT_MANAGER_CHART_VERSION:-1.20.1}"
TRUST_MANAGER_CHART_VERSION="${TRUST_MANAGER_CHART_VERSION:-0.22.0}"
ZITI_CONTROLLER_CHART_VERSION="${ZITI_CONTROLLER_CHART_VERSION:-3.1.1}"
ZITI_ROUTER_CHART_VERSION="${ZITI_ROUTER_CHART_VERSION:-2.1.0}"

ZITI_CONTROLLER_NODEPORT="${ZITI_CONTROLLER_NODEPORT:-31280}"
ZITI_ROUTER_NODEPORT="${ZITI_ROUTER_NODEPORT:-30222}"

ZITI_CONTROLLER_DB_PVC="${ZITI_CONTROLLER_DB_PVC:-ziti-controller-db}"
ZITI_CONTROLLER_DB_SIZE="${ZITI_CONTROLLER_DB_SIZE:-2Gi}"
ZITI_ROUTER_ENROLLMENT_SECRET="${ZITI_ROUTER_ENROLLMENT_SECRET:-ziti-router-enrollment}"
ZITI_STORAGE_CLASS_NAME="${ZITI_STORAGE_CLASS_NAME:-}"

detect_node_ip() {
  kubectl get nodes -o json \
    | jq -r '
      .items[0].status.addresses
      | map(select(.type == "InternalIP"))[0].address // empty
    '
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

is_ip_address() {
  local value="$1"
  [[ "${value}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || [[ "${value}" == *:* ]]
}

controller_exec() {
  local cmd="$1"
  kubectl exec -n "${ZITI_NAMESPACE}" deploy/"${ZITI_CONTROLLER_RELEASE}" -- sh -lc "${cmd}"
}

require_cmd bash
require_cmd helm
require_cmd jq
require_cmd kubectl

ZITI_PUBLIC_HOST="${ZITI_PUBLIC_HOST:-${ZITI_HOST_IP:-$(detect_node_ip)}}"
if [[ -z "${ZITI_PUBLIC_HOST}" ]]; then
  echo "unable to determine ZITI_PUBLIC_HOST; set ZITI_PUBLIC_HOST or ZITI_HOST_IP explicitly" >&2
  exit 1
fi

current_trust_namespace="$(
  helm get values trust-manager -n "${CERT_MANAGER_NAMESPACE}" -a 2>/dev/null \
    | awk '
        $1 == "namespace:" && seen == 1 { print $2; exit }
        $1 == "trust:" { seen = 1; next }
        seen == 1 && $1 != "" && $1 !~ /^namespace:/ && $1 !~ /^trust:/ { seen = 0 }
      ' \
    || true
)"

if [[ -n "${current_trust_namespace}" && "${current_trust_namespace}" != "null" && "${current_trust_namespace}" != "${ZITI_NAMESPACE}" ]]; then
  cat >&2 <<EOF
trust-manager is currently configured with app.trust.namespace=${current_trust_namespace}
requested controller namespace is ${ZITI_NAMESPACE}

The official ziti-controller chart depends on trust-manager reading CA sources from a single trust namespace.
To avoid breaking an existing deployment, either:
  1. deploy OpenZiti into ${current_trust_namespace}
  2. or deliberately retarget trust-manager to ${ZITI_NAMESPACE}
EOF
  exit 1
fi

storage_class_block=""
if [[ -n "${ZITI_STORAGE_CLASS_NAME}" ]]; then
  storage_class_block="  storageClassName: ${ZITI_STORAGE_CLASS_NAME}"
fi

echo "public host: ${ZITI_PUBLIC_HOST}"
echo "controller address: https://${ZITI_PUBLIC_HOST}:${ZITI_CONTROLLER_NODEPORT}"
echo "router address: tls://${ZITI_PUBLIC_HOST}:${ZITI_ROUTER_NODEPORT}"
echo "namespace: ${ZITI_NAMESPACE}"
echo "controller pvc: ${ZITI_CONTROLLER_DB_PVC}"
echo "router enrollment secret: ${ZITI_ROUTER_ENROLLMENT_SECRET}"

echo "[1/9] ensure helm repos"
helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
helm repo add openziti https://docs.openziti.io/helm-charts/ >/dev/null 2>&1 || true
helm repo update >/dev/null

echo "[2/9] install cert-manager"
helm upgrade --install cert-manager jetstack/cert-manager \
  -n "${CERT_MANAGER_NAMESPACE}" \
  --create-namespace \
  --version "${CERT_MANAGER_CHART_VERSION}" \
  --set crds.enabled=true

echo "[3/9] create namespace and controller pvc"
kubectl get namespace "${ZITI_NAMESPACE}" >/dev/null 2>&1 || kubectl create namespace "${ZITI_NAMESPACE}"
kubectl label namespace "${ZITI_NAMESPACE}" openziti.io/namespace=enabled --overwrite

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${ZITI_CONTROLLER_DB_PVC}
  namespace: ${ZITI_NAMESPACE}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: ${ZITI_CONTROLLER_DB_SIZE}
${storage_class_block}
EOF

echo "[4/9] install trust-manager"
helm upgrade --install trust-manager jetstack/trust-manager \
  -n "${CERT_MANAGER_NAMESPACE}" \
  --version "${TRUST_MANAGER_CHART_VERSION}" \
  --set app.trust.namespace="${ZITI_NAMESPACE}"

echo "[5/9] install controller"
helm upgrade --install "${ZITI_CONTROLLER_RELEASE}" openziti/ziti-controller \
  -n "${ZITI_NAMESPACE}" \
  --version "${ZITI_CONTROLLER_CHART_VERSION}" \
  --server-side=false \
  -f "${SCRIPT_DIR}/ziti-controller-values.yaml" \
  --set persistence.existingClaim="${ZITI_CONTROLLER_DB_PVC}" \
  --set clientApi.advertisedHost="${ZITI_PUBLIC_HOST}" \
  --set clientApi.advertisedPort="${ZITI_CONTROLLER_NODEPORT}"

if is_ip_address "${ZITI_PUBLIC_HOST}"; then
  kubectl patch certificate -n "${ZITI_NAMESPACE}" "${ZITI_CONTROLLER_RELEASE}"-ctrl-plane-identity \
    --type=merge \
    -p "{\"spec\":{\"ipAddresses\":[\"127.0.0.1\",\"::1\",\"${ZITI_PUBLIC_HOST}\"]}}"
  kubectl patch certificate -n "${ZITI_NAMESPACE}" "${ZITI_CONTROLLER_RELEASE}"-web-identity-cert \
    --type=merge \
    -p "{\"spec\":{\"ipAddresses\":[\"127.0.0.1\",\"::1\",\"${ZITI_PUBLIC_HOST}\"]}}"
fi

kubectl wait certificate.cert-manager.io/"${ZITI_CONTROLLER_RELEASE}"-ctrl-plane-identity \
  -n "${ZITI_NAMESPACE}" \
  --for=condition=Ready=true \
  --timeout=180s
kubectl wait certificate.cert-manager.io/"${ZITI_CONTROLLER_RELEASE}"-web-identity-cert \
  -n "${ZITI_NAMESPACE}" \
  --for=condition=Ready=true \
  --timeout=180s

kubectl rollout restart deployment/"${ZITI_CONTROLLER_RELEASE}" -n "${ZITI_NAMESPACE}"
kubectl rollout status deployment/"${ZITI_CONTROLLER_RELEASE}" -n "${ZITI_NAMESPACE}" --timeout=180s

echo "[6/9] recreate router release and edge-router enrollment"
helm uninstall -n "${ZITI_NAMESPACE}" "${ZITI_ROUTER_RELEASE}" >/dev/null 2>&1 || true
kubectl delete pvc -n "${ZITI_NAMESPACE}" "${ZITI_ROUTER_RELEASE}" --ignore-not-found=true >/dev/null 2>&1 || true

router_id="$(
  controller_exec "zitiLogin >/dev/null && ziti edge list edge-routers -j" \
    | jq -r --arg router_name "${ZITI_ROUTER_NAME}" '.data[]? | select(.name == $router_name) | .id'
)"

if [[ -n "${router_id}" && "${router_id}" != "null" ]]; then
  controller_exec "zitiLogin >/dev/null && ziti edge delete edge-router \"${router_id}\" >/dev/null"
fi

echo "[7/9] create router enrollment jwt"
router_jwt="$(
  controller_exec "zitiLogin >/dev/null && ziti edge create edge-router \"${ZITI_ROUTER_NAME}\" --role-attributes \"${ZITI_ROUTER_ROLE}\" --jwt-output-file /tmp/${ZITI_ROUTER_NAME}.jwt >/dev/null && cat /tmp/${ZITI_ROUTER_NAME}.jwt"
)"

kubectl delete secret "${ZITI_ROUTER_ENROLLMENT_SECRET}" -n "${ZITI_NAMESPACE}" --ignore-not-found=true
kubectl create secret generic "${ZITI_ROUTER_ENROLLMENT_SECRET}" \
  -n "${ZITI_NAMESPACE}" \
  --from-literal=enrollmentJwt="${router_jwt}"

echo "[8/9] install router"
router_set_args=(
  --set enrollmentJwtSecretName="${ZITI_ROUTER_ENROLLMENT_SECRET}"
  --set ctrl.endpoint="${ZITI_PUBLIC_HOST}:${ZITI_CONTROLLER_NODEPORT}"
  --set edge.advertisedHost="${ZITI_PUBLIC_HOST}"
  --set edge.advertisedPort="${ZITI_ROUTER_NODEPORT}"
)

if is_ip_address "${ZITI_PUBLIC_HOST}"; then
  router_set_args+=(--set csr.sans.ip[1]="${ZITI_PUBLIC_HOST}")
else
  router_set_args+=(--set csr.sans.dns[1]="${ZITI_PUBLIC_HOST}")
fi

helm upgrade --install "${ZITI_ROUTER_RELEASE}" openziti/ziti-router \
  -n "${ZITI_NAMESPACE}" \
  --version "${ZITI_ROUTER_CHART_VERSION}" \
  --server-side=false \
  -f "${SCRIPT_DIR}/ziti-router-values.yaml" \
  "${router_set_args[@]}"

kubectl rollout status deployment/"${ZITI_ROUTER_RELEASE}" -n "${ZITI_NAMESPACE}" --timeout=180s

echo "[9/9] verify"
kubectl get pods,svc,pvc,certificate -n "${ZITI_NAMESPACE}" -o wide
controller_exec "zitiLogin >/dev/null && ziti edge list edge-routers"

echo
echo "OpenZiti deployment completed."
