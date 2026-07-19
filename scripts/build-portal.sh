#!/usr/bin/env bash
# Builds the combined portal deployment: a static landing page at "/" plus
# Niccolo and Thrash Margin's client builds under their own subpaths.
# The API (packages/thrash-margin/api) is not built here — it's picked up
# directly by Vercel's function detection via the /api shim files at repo root.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Building Niccolo (base /niccolo/)"
npm run build --workspace=packages/niccolo -- --base=/niccolo/

echo "==> Building Thrash Margin client (base /thrash-margin/)"
(cd packages/thrash-margin/client && npm install && npm run build -- --base=/thrash-margin/)

echo "==> Assembling dist/"
rm -rf dist
mkdir -p dist/niccolo dist/thrash-margin
cp -r landing/. dist/
cp -r packages/niccolo/dist/. dist/niccolo/
cp -r packages/thrash-margin/client/dist/. dist/thrash-margin/

echo "==> Portal build complete"
