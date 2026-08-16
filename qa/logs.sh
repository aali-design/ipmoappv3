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

echo "===== ipmo-publish --help ====="
"${SSH[@]}" "$REMOTE" 'sudo /usr/local/bin/ipmo-publish --help' 2>&1 || true

echo "===== ipmo-publish list ====="
"${SSH[@]}" "$REMOTE" 'sudo /usr/local/bin/ipmo-publish list' || true

echo "===== ipmo-publish logs $SLUG ====="
"${SSH[@]}" "$REMOTE" "sudo /usr/local/bin/ipmo-publish logs '$SLUG'" 2>&1 || true

echo "===== ipmo-publish status $SLUG ====="
"${SSH[@]}" "$REMOTE" "sudo /usr/local/bin/ipmo-publish status '$SLUG'" 2>&1 || true
