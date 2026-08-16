#!/usr/bin/env bash
set -euo pipefail

# Publish a preview release to the preview host.
# Requires: PREVIEW_HOST, PREVIEW_HOST_USER, PREVIEW_HOST_KEY, PREVIEW_BASE_URL
# Deploys .release/app to ~/previews/<slug> and serves it via the host's
# static + API reverse proxy. See DEPLOYMENT.md.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${ROOT}/.release/app"
SLUG="${PREVIEW_SLUG:-preview}"

: "${PREVIEW_HOST:?PREVIEW_HOST is required}"
: "${PREVIEW_HOST_USER:?PREVIEW_HOST_USER is required}"
: "${PREVIEW_HOST_KEY:?PREVIEW_HOST_KEY is required}"
: "${PREVIEW_BASE_URL:?PREVIEW_BASE_URL is required}"

KEY_FILE="$(mktemp)"
trap 'rm -f "${KEY_FILE}"' EXIT
printf '%s' "${PREVIEW_HOST_KEY}" > "${KEY_FILE}"
chmod 600 "${KEY_FILE}"

TARGET_DIR="previews/${SLUG}"
ssh -i "${KEY_FILE}" -o StrictHostKeyChecking=no "${PREVIEW_HOST_USER}@${PREVIEW_HOST}" \
  "mkdir -p ${TARGET_DIR} && rm -rf ${TARGET_DIR}/app"
scp -i "${KEY_FILE}" -o StrictHostKeyChecking=no -r "${APP}" "${PREVIEW_HOST_USER}@${PREVIEW_HOST}:${TARGET_DIR}/app"

URL="${PREVIEW_BASE_URL}/${SLUG}/"
echo "Preview published: ${URL}"