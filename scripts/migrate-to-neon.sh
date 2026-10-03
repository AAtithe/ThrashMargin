#!/usr/bin/env bash
# One-shot copy of the portal database from Supabase to Neon.
#
#   SOURCE_URL=<Supabase session-mode URL, port 5432> \
#   TARGET_URL=<Neon DIRECT URL, the host without -pooler> \
#   bash scripts/migrate-to-neon.sh
#
# Use direct (non-pooled) URLs on both sides: pg_dump and a multi-statement restore do not run
# reliably through a transaction-mode pooler. The app itself should use Neon's pooled URL.
#
# Steps: apply db/schema.sql to the target, copy the public-schema rows only (Supabase's own
# auth/storage schemas are not used by the app and are left behind), then compare row counts
# table by table. Refuses to run if the target already holds users, so it cannot double-load.
# Writes nothing to the source.
set -euo pipefail

: "${SOURCE_URL:?set SOURCE_URL to the Supabase connection string}"
: "${TARGET_URL:?set TARGET_URL to the Neon direct connection string}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TABLES=(users player_stats games game_actions feedback)
export PGOPTIONS="-c client_min_messages=warning"

echo "Applying schema to target"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/db/schema.sql"

existing=$(psql "$TARGET_URL" -tAc "SELECT COUNT(*) FROM users")
if [ "$existing" != "0" ]; then
  echo "Target already has $existing users; refusing to load on top of existing data." >&2
  exit 1
fi

echo "Copying rows"
table_args=()
for t in "${TABLES[@]}"; do table_args+=(--table="public.$t"); done
# Tables listed parents first; pg_dump orders the data by foreign keys regardless, and the
# single transaction means a failure leaves the target empty rather than half-loaded.
pg_dump "$SOURCE_URL" --data-only --no-owner --no-privileges "${table_args[@]}" \
  | psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q --single-transaction >/dev/null

echo "Verifying row counts"
fail=0
for t in "${TABLES[@]}"; do
  src=$(psql "$SOURCE_URL" -tAc "SELECT COUNT(*) FROM public.$t")
  dst=$(psql "$TARGET_URL" -tAc "SELECT COUNT(*) FROM public.$t")
  printf '  %-14s source %-8s target %s\n' "$t" "$src" "$dst"
  [ "$src" = "$dst" ] || fail=1
done

if [ "$fail" = "1" ]; then
  echo "Row counts differ; do not switch DATABASE_URL." >&2
  exit 1
fi
echo "Done. Point DATABASE_URL in Vercel at the Neon pooled URL and redeploy."
