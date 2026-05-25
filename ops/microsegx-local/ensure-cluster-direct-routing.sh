#!/usr/bin/env bash
set -euo pipefail

# Keep k3s Pod/Service CIDRs out of workstation proxy policy-routing tables.
# This is useful on development hosts that run transparent proxies such as
# verge-mihomo/clash, which often create a 198.18.0.0/30 tunnel and broad
# policy rules that can accidentally rewrite Kubernetes DNS answers.

POD_CIDR="${POD_CIDR:-10.42.0.0/16}"
SERVICE_CIDR="${SERVICE_CIDR:-10.43.0.0/16}"

ensure_rule() {
  local priority="$1"
  shift

  if ip rule show | grep -Fq "$*"; then
    return
  fi

  ip rule add priority "${priority}" "$@" lookup main
}

ensure_rule 100 to "${POD_CIDR}"
ensure_rule 101 to "${SERVICE_CIDR}"
ensure_rule 102 from "${POD_CIDR}"
ensure_rule 103 from "${SERVICE_CIDR}"

ip route flush cache >/dev/null 2>&1 || true

echo "Cluster CIDR direct-routing rules are installed:"
ip rule show | grep -E "10\\.42\\.|10\\.43\\.|${POD_CIDR}|${SERVICE_CIDR}" || true
