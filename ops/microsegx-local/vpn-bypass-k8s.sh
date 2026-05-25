#!/usr/bin/env bash
set -euo pipefail

# Keep kubeadm Kubernetes Pod/Service CIDRs out of workstation proxy routing.
VPN_ROUTE_TABLE="${VPN_ROUTE_TABLE:-2022}"
K8S_POD_CIDR="${K8S_POD_CIDR:-10.244.0.0/16}"
K8S_SERVICE_CIDR="${K8S_SERVICE_CIDR:-10.96.0.0/12}"
K8S_CNI_DEV="${K8S_CNI_DEV:-cni0}"

if ! ip link show "${K8S_CNI_DEV}" >/dev/null 2>&1; then
  echo "CNI device not found: ${K8S_CNI_DEV}" >&2
  exit 1
fi

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi

"${SUDO[@]}" ip route replace "${K8S_POD_CIDR}" dev "${K8S_CNI_DEV}" table "${VPN_ROUTE_TABLE}"
"${SUDO[@]}" ip route replace "${K8S_SERVICE_CIDR}" dev "${K8S_CNI_DEV}" table "${VPN_ROUTE_TABLE}"
"${SUDO[@]}" ip route flush cache >/dev/null 2>&1 || true

echo "Applied VPN bypass: table ${VPN_ROUTE_TABLE} routes ${K8S_POD_CIDR}, ${K8S_SERVICE_CIDR} via ${K8S_CNI_DEV}"
