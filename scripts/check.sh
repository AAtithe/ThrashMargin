#!/usr/bin/env bash
# Every fast check the portal has: typechecks for all five games, their APIs and the /api entry
# points, then every game's test suite. Run before every deploy (scripts/build-portal.sh calls it,
# so a failure stops the deploy) and on every push to GitHub (.github/workflows/ci.yml).
#
#   npm run check
#
# Expects `npm ci` at the repo root and in packages/thrash-margin/client.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
TSC="$ROOT_DIR/node_modules/.bin/tsc"

step() { echo; echo "==> $*"; }

step "Typecheck: /api entry points"
"$TSC" -p tsconfig.api.json

step "Typecheck: Thrash Margin (API, then client)"
"$TSC" --noEmit -p packages/thrash-margin/tsconfig.json
(cd packages/thrash-margin/client && ./node_modules/.bin/tsc --noEmit)

step "Typecheck: Banco di Niccolò"
npm run typecheck --workspace=packages/niccolo --silent

step "Typecheck: Niccolò Rising"
npm run typecheck --workspace=packages/niccolo-rising --silent

for game in tea-race steady-eddie; do
  step "Typecheck: $game (client, then API)"
  "$TSC" --noEmit -p "packages/$game/tsconfig.json"
  "$TSC" --noEmit -p "packages/$game/api/tsconfig.json"
done

for game in thrash-margin tea-race steady-eddie niccolo niccolo-rising; do
  step "Test suite: $game"
  npm run drive --workspace="packages/$game" --silent | tail -3
done

echo
echo "==> All checks passed"
