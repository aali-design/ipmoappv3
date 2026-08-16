#!/usr/bin/env bash
# Deploy the QA platform to the ipmo host via ipmo-publish.
# Run from the repo's qa/ directory (the compose bundle root).
#
# Required env (GitHub Actions secrets):
#   PRODUCTION_HOST, PRODUCTION_HOST_USER, PRODUCTION_HOST_PORT, PRODUCTION_HOST_KEY
# Optional:
#   APP_SLUG   pin a stable hostname across deploys; omit to mint a new one.
set -euo pipefail

: "${PRODUCTION_HOST:?PRODUCTION_HOST not set}"
: "${PRODUCTION_HOST_USER:?PRODUCTION_HOST_USER not set}"
: "${PRODUCTION_HOST_KEY:?PRODUCTION_HOST_KEY not set}"
PORT="${PRODUCTION_HOST_PORT:-22}"
SLUG="${APP_SLUG:-}"

KEY_FILE=$(mktemp)
printf '%s\n' "$PRODUCTION_HOST_KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"
trap 'shred -u "$KEY_FILE" 2>/dev/null || rm -f "$KEY_FILE"' EXIT

SSH=(ssh -p "$PORT" -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
REMOTE="${PRODUCTION_HOST_USER}@${PRODUCTION_HOST}"

if [[ ! -f ipmo-app.json ]]; then
  echo '{ "service": "frontend", "port": 80 }' > ipmo-app.json
fi

BUNDLE_DIR=$(mktemp -d)
BUNDLE="$BUNDLE_DIR/qa.tgz"

# -h dereferences symlinks; the publisher refuses archives containing links.
tar -czhf "$BUNDLE" \
    --exclude=node_modules --exclude=.git --exclude=.github \
    -C . .

echo "deploy: bundle $(du -h "$BUNDLE" | cut -f1) -> $REMOTE"
[[ -n "$SLUG" ]] || SLUG=$("${SSH[@]}" "$REMOTE" 'sudo /usr/local/bin/ipmo-publish new-slug')
SLUG=$(tr -dc 'a-z0-9' <<<"$SLUG")
[[ "$SLUG" =~ ^[a-z0-9]{12}$ ]] || { echo "deploy: bad slug '$SLUG'" >&2; exit 1; }

scp -P "$PORT" -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new \
    "$BUNDLE" "$REMOTE:/srv/ipmo-deploy/incoming/${SLUG}.tgz"

echo "deploy: publishing as $SLUG"
"${SSH[@]}" "$REMOTE" "sudo /usr/local/bin/ipmo-publish deploy /srv/ipmo-deploy/incoming/${SLUG}.tgz ${SLUG}"

URL="https://${SLUG}.ipmo.app"
echo "deploy: live at $URL"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "url=$URL" >> "$GITHUB_OUTPUT"; fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "### Deployed: $URL" >> "$GITHUB_STEP_SUMMARY"; fi
