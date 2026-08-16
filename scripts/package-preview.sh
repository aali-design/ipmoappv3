#!/usr/bin/env bash
set -euo pipefail

# Assemble a deployable release directory from the current build.
# Expects `pnpm build` to have been run already.
# Output: .release/app  (self-contained deployable; run with node on the target)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${ROOT}/.release/app"

rm -rf "${ROOT}/.release"
mkdir -p "${APP}/apps/api" "${APP}/apps/web"

cp -R "${ROOT}/apps/web/dist" "${APP}/apps/web/dist"
cp -R "${ROOT}/apps/api/src" "${APP}/apps/api/src"
cp "${ROOT}/apps/api/package.json" "${APP}/apps/api/package.json"
cp "${ROOT}/package.json" "${ROOT}/pnpm-lock.yaml" "${ROOT}/pnpm-workspace.yaml" "${ROOT}/tsconfig.base.json" "${APP}/"
cp "${ROOT}/apps/api/tsconfig.json" "${APP}/apps/api/tsconfig.json"

echo "Release assembled at ${APP}"
echo "Run: cd .release/app && pnpm install --prod && pnpm --filter @ipmo/api start"
echo "(or deploy the bundled Docker image)"