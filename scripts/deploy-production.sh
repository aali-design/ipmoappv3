#!/usr/bin/env bash
set -euo pipefail

# Deploy the production release to the production host.
# Requires: PRODUCTION_HOST, PRODUCTION_HOST_USER, PRODUCTION_HOST_KEY, PRODUCTION_BASE_URL
# Installs .release/app to ~/app, installs prod deps, and (re)starts the ipmo
# systemd service (or PM2 process). See DEPLOYMENT.md.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${ROOT}/.release/app"

: "${PRODUCTION_HOST:?PRODUCTION_HOST is required}"
: "${PRODUCTION_HOST_USER:?PRODUCTION_HOST_USER is required}"
: "${PRODUCTION_HOST_KEY:?PRODUCTION_HOST_KEY is required}"
: "${PRODUCTION_BASE_URL:?PRODUCTION_BASE_URL is required}"

KEY_FILE="$(mktemp)"
trap 'rm -f "${KEY_FILE}"' EXIT
printf '%s' "${PRODUCTION_HOST_KEY}" > "${KEY_FILE}"
chmod 600 "${KEY_FILE}"

PORT="${PRODUCTION_HOST_PORT:-22}"

REMOTE_HOST="${PRODUCTION_HOST_USER}@${PRODUCTION_HOST}"
SSH="ssh -p ${PORT} -i ${KEY_FILE} -o StrictHostKeyChecking=no"

"${SSH}" "${REMOTE_HOST}" "mkdir -p ~/app && rm -rf ~/app/current"
scp -P "${PORT}" -i "${KEY_FILE}" -o StrictHostKeyChecking=no -r "${APP}" "${REMOTE_HOST}:~/app/current"

"${SSH}" "${REMOTE_HOST}" \
  "cd ~/app/current && pnpm install --prod --frozen-lockfile && \
   (systemctl --user restart ipmo 2>/dev/null || pm2 restart ipmo 2>/dev/null || echo 'restart ipmo service manually')"

echo "Production deployed: ${PRODUCTION_BASE_URL}"