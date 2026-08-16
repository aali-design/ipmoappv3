#!/usr/bin/env bash
# Remove a published slug from the ipmo host (containers + volumes + DNS).
# Usage: ./remove.sh <slug>
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

echo "remove: removing $SLUG"
"${SSH[@]}" "$REMOTE" "sudo /usr/local/bin/ipmo-publish remove '$SLUG'"
