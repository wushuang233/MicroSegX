#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-${SCRIPT_DIR}/openziti.k8s.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  echo "Copy openziti.k8s.env.example to openziti.k8s.env and fill the required values first." >&2
  exit 1
fi

# Export every variable from the env file so deploy-openziti-k8s.sh
# receives the intended values after exec.
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

exec "${SCRIPT_DIR}/deploy-openziti-k8s.sh"
