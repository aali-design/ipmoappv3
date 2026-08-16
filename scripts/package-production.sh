#!/usr/bin/env bash
set -euo pipefail

# Package the production release (same assembly as preview).
# Output: .release/app

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${ROOT}/scripts/package-preview.sh"