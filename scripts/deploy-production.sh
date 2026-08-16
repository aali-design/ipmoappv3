#!/usr/bin/env bash
# Deploy the ipmo app to the ipmo host via ipmo-publish.
#
# WHY: the original scp'd a build to ~/app/current and then ran
#   systemctl --user restart ipmo || pm2 restart ipmo || echo 'restart manually'
# None of those exist on the host, so the workflow went GREEN while publishing
# nothing. This version hands the bundle to ipmo-publish, which starts the
# containers and returns a real https://{slug}.ipmo.app URL.
#
# Required env (GitHub Actions secrets):
#   PRODUCTION_HOST, PRODUCTION_HOST_USER, PRODUCTION_HOST_PORT, PRODUCTION_HOST_KEY
# Optional:
#   APP_SLUG   pin a stable hostname across deploys; omit to mint a new one.
#              Pin this in production — otherwise every deploy publishes a new URL.
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

# The bundle is what ipmo-publish consumes: docker-compose.yml at the root plus
# ipmo-app.json naming the web service. Build contexts must be included, so ship
# sources but never node_modules/.git.
BUNDLE_DIR=$(mktemp -d)
BUNDLE="$BUNDLE_DIR/bundle.tgz"

if [[ ! -f ipmo-app.json ]]; then
  echo "deploy: ipmo-app.json missing; defaulting to service=web port=80" >&2
  echo '{ "service": "web", "port": 80 }' > ipmo-app.json
fi

# -h dereferences symlinks: the publisher refuses archives containing links,
# because it extracts as root.
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

# Surface the URL to the workflow so it shows in the run summary / PR comment.
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "url=$URL" >> "$GITHUB_OUTPUT"; fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "### Deployed: $URL" >> "$GITHUB_STEP_SUMMARY"; fi
