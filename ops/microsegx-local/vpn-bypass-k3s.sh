#!/usr/bin/env bash
set -euo pipefail

# Mihomo/Clash TUN can install a policy route that sends Kubernetes traffic to
# the VPN table. Keep k3s Pod/Service CIDRs on cni0 so kube-dns and ClusterIP
# access do not leave the local cluster.
VPN_ROUTE_TABLE="${VPN_ROUTE_TABLE:-2022}"
K3S_POD_CIDR="${K3S_POD_CIDR:-10.42.0.0/16}"
K3S_SERVICE_CIDR="${K3S_SERVICE_CIDR:-10.43.0.0/16}"
K3S_CNI_DEV="${K3S_CNI_DEV:-cni0}"

if ! ip link show "${K3S_CNI_DEV}" >/dev/null 2>&1; then
  echo "CNI device not found: ${K3S_CNI_DEV}" >&2
  exit 1
fi

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi

"${SUDO[@]}" ip route replace "${K3S_POD_CIDR}" dev "${K3S_CNI_DEV}" table "${VPN_ROUTE_TABLE}"
"${SUDO[@]}" ip route replace "${K3S_SERVICE_CIDR}" dev "${K3S_CNI_DEV}" table "${VPN_ROUTE_TABLE}"
echo "Applied VPN bypass: table ${VPN_ROUTE_TABLE} routes ${K3S_POD_CIDR}, ${K3S_SERVICE_CIDR} via ${K3S_CNI_DEV}"
