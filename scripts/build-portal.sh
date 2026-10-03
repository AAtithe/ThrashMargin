#!/usr/bin/env bash
# Builds the combined portal deployment: a static landing page at "/" plus
# Niccolo, Niccolò Rising, The Tea Race, Steady Eddie and Thrash Margin's client builds under their
# own subpaths.
# The API (packages/thrash-margin/api) is not built here — it's picked up
# directly by Vercel's function detection via the /api shim files at repo root.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# The Thrash Margin client has its own lockfile outside the workspaces. `npm ci` installs exactly
# what the lockfile records and fails if it is out of date, so a deploy cannot pick up different
# library versions from the last one.
echo "==> Installing Thrash Margin client dependencies"
(cd packages/thrash-margin/client && npm ci --no-audit --no-fund)

# Every typecheck and every game's test suite. A failure here stops the build, and a failed build
# is never deployed: Vercel keeps serving the last good version.
echo "==> Running checks"
bash scripts/check.sh

echo "==> Building Niccolo (base /niccolo/)"
npm run build --workspace=packages/niccolo -- --base=/niccolo/

echo "==> Building Niccolò Rising (base /rising/)"
npm run build --workspace=packages/niccolo-rising -- --base=/rising/

echo "==> Building The Tea Race (base /tea-race/)"
npm run build --workspace=packages/tea-race -- --base=/tea-race/

echo "==> Building Steady Eddie (base /steady-eddie/)"
npm run build --workspace=packages/steady-eddie -- --base=/steady-eddie/

echo "==> Building Thrash Margin client (base /thrash-margin/)"
(cd packages/thrash-margin/client && npm run build -- --base=/thrash-margin/)

echo "==> Assembling dist/"
rm -rf dist
mkdir -p dist/niccolo dist/rising dist/tea-race dist/steady-eddie dist/thrash-margin
cp -r landing/. dist/
cp -r packages/niccolo/dist/. dist/niccolo/
cp -r packages/niccolo-rising/dist/. dist/rising/
cp -r packages/tea-race/dist/. dist/tea-race/
cp -r packages/steady-eddie/dist/. dist/steady-eddie/
cp -r packages/thrash-margin/client/dist/. dist/thrash-margin/

echo "==> Portal build complete"
