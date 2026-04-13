#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="${1:-${SCRIPT_DIR}/full-release.containerd.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  echo "Copy full-release.containerd.env.example to full-release.containerd.env and fill the required values first." >&2
  exit 1
fi

export DEPLOY_MODE=local
export LOCAL_RUNTIME=containerd

exec "${SCRIPT_DIR}/deploy-core.sh" "${ENV_FILE}"
