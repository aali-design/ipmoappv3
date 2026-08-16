#!/usr/bin/env bash
# Dump container status + logs for a published QA slug on the ipmo host.
# Usage: ./logs.sh <slug>   (uses PRODUCTION_HOST* env for SSH auth)
set -euo pipefail

SLUG="${1:?slug required}"
: "${PRODUCTION_HOST:?PRODUCTION_HOST not set}"
: "${PRODUCTION_HOST_USER:?PRODUCTION_HOST_USER not set}"
: "${PRODUCTION_HOST_KEY:?PRODUCTION_HOST_KEY not set}"
PORT="${PRODUCTION_HOST_PORT:-22}"

KEY_FILE=$(mktemp)
printf '%s\n' "$PRODUCTION_HOST_KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"
trap 'shred -u "$KEY_FILE" 2>/dev/null || rm -f "$KEY_FILE"' EXIT

SSH=(ssh -p "$PORT" -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
REMOTE="${PRODUCTION_HOST_USER}@${PRODUCTION_HOST}"

echo "===== ipmo-publish list ====="
"${SSH[@]}" "$REMOTE" 'sudo /usr/local/bin/ipmo-publish list' || true

echo "===== docker ps -a (matching $SLUG) ====="
"${SSH[@]}" "$REMOTE" "sudo docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Image}}' | grep '$SLUG' || true"

echo "===== docker compose ps (project) ====="
"${SSH[@]}" "$REMOTE" "sudo docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -i 'qa\|ipmoapp' || true"

echo "===== backend logs ====="
"${SSH[@]}" "$REMOTE" "for c in \$(sudo docker ps -a --format '{{.Names}}' | grep -E 'backend|_api_|qa.*back'); do echo \"--- \$c ---\"; sudo docker logs --tail 80 \"\$c\" 2>&1; done" || true

echo "===== db logs ====="
"${SSH[@]}" "$REMOTE" "for c in \$(sudo docker ps -a --format '{{.Names}}' | grep -E 'db|postgres'); do echo \"--- \$c ---\"; sudo docker logs --tail 40 \"\$c\" 2>&1; done" || true
