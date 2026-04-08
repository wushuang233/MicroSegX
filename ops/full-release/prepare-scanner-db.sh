#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../.." && pwd)
POINTER_FILE=${SCANNER_DB_POINTER_FILE:-"${ROOT_DIR}/scanner/data/cvedb"}
OUTPUT_FILE=${SCANNER_DB_OUTPUT_FILE:-"${ROOT_DIR}/scanner/data/cvedb.regular"}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

normalize_github_remote() {
  local remote="$1"

  case "${remote}" in
    git@github.com:*)
      remote="https://github.com/${remote#git@github.com:}"
      ;;
    ssh://git@github.com/*)
      remote="https://github.com/${remote#ssh://git@github.com/}"
      ;;
    http://github.com/*)
      remote="https://github.com/${remote#http://github.com/}"
      ;;
    https://github.com/*)
      ;;
    *)
      echo "" >&2
      return 1
      ;;
  esac

  echo "${remote%.git}"
}

read_pointer_field() {
  local pattern="$1"
  sed -n "s/^${pattern}//p" "${POINTER_FILE}"
}

validate_output() {
  local expected_sha="$1"
  local expected_size="$2"

  if [[ ! -f "${OUTPUT_FILE}" ]]; then
    return 1
  fi

  local actual_sha actual_size
  actual_sha=$(sha256sum "${OUTPUT_FILE}" | awk '{print $1}')
  actual_size=$(wc -c <"${OUTPUT_FILE}" | tr -d '[:space:]')

  [[ "${actual_sha}" == "${expected_sha}" && "${actual_size}" == "${expected_size}" ]]
}

require_cmd awk
require_cmd curl
require_cmd git
require_cmd mktemp
require_cmd sed
require_cmd sha256sum
require_cmd wc

if [[ ! -f "${POINTER_FILE}" ]]; then
  echo "Scanner DB pointer file not found: ${POINTER_FILE}" >&2
  exit 1
fi

if ! grep -qxF "version https://git-lfs.github.com/spec/v1" "${POINTER_FILE}"; then
  echo "Scanner DB pointer file is not a Git LFS pointer: ${POINTER_FILE}" >&2
  exit 1
fi

expected_sha=$(read_pointer_field "oid sha256:")
expected_size=$(read_pointer_field "size ")

if [[ -z "${expected_sha}" || -z "${expected_size}" ]]; then
  echo "Failed to parse oid/size from ${POINTER_FILE}" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_FILE}")"

if validate_output "${expected_sha}" "${expected_size}"; then
  echo "Scanner DB already prepared: ${OUTPUT_FILE}"
  exit 0
fi

REMOTE_URL=${SCANNER_DB_REMOTE:-$(git -C "${ROOT_DIR}" remote get-url origin)}
if ! GITHUB_REMOTE=$(normalize_github_remote "${REMOTE_URL}"); then
  echo "Unsupported Git remote for scanner DB download: ${REMOTE_URL}" >&2
  echo "Set SCANNER_DB_REMOTE to a GitHub repository URL, for example https://github.com/owner/repo" >&2
  exit 1
fi

BATCH_ENDPOINT="${GITHUB_REMOTE}.git/info/lfs/objects/batch"
BATCH_PAYLOAD=$(printf '{"operation":"download","transfers":["basic"],"objects":[{"oid":"%s","size":%s}]}' "${expected_sha}" "${expected_size}")
BATCH_RESPONSE=$(curl -fsSL -X POST "${BATCH_ENDPOINT}" \
  -H 'Accept: application/vnd.git-lfs+json' \
  -H 'Content-Type: application/vnd.git-lfs+json' \
  --data "${BATCH_PAYLOAD}")
DOWNLOAD_URL=$(printf '%s' "${BATCH_RESPONSE}" | tr -d '\n' | sed -n 's/.*"href"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [[ -z "${DOWNLOAD_URL}" ]]; then
  echo "Failed to resolve scanner DB download URL from ${BATCH_ENDPOINT}" >&2
  echo "${BATCH_RESPONSE}" >&2
  exit 1
fi

TMP_FILE=$(mktemp "${OUTPUT_FILE}.tmp.XXXXXX")
cleanup() {
  rm -f "${TMP_FILE}"
}
trap cleanup EXIT

echo "==> Downloading scanner DB from ${GITHUB_REMOTE}"
curl -fL --retry 3 --output "${TMP_FILE}" "${DOWNLOAD_URL}"

actual_sha=$(sha256sum "${TMP_FILE}" | awk '{print $1}')
actual_size=$(wc -c <"${TMP_FILE}" | tr -d '[:space:]')

if [[ "${actual_sha}" != "${expected_sha}" || "${actual_size}" != "${expected_size}" ]]; then
  echo "Downloaded scanner DB does not match Git LFS pointer metadata." >&2
  echo "Expected sha=${expected_sha} size=${expected_size}" >&2
  echo "Actual   sha=${actual_sha} size=${actual_size}" >&2
  exit 1
fi

mv "${TMP_FILE}" "${OUTPUT_FILE}"
chmod 0644 "${OUTPUT_FILE}"

echo "Scanner DB prepared: ${OUTPUT_FILE}"
