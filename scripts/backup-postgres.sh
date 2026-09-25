#!/usr/bin/env sh
set -euo pipefail
: "${POSTGRES_CONTAINER:=gamevortex-postgres}"
: "${POSTGRES_USER:=gamevortex}"
: "${POSTGRES_DB:=gamevortex}"
OUT="${1:-./backups/gamevortex-$(date +%Y%m%d-%H%M%S).sql.gz}"
mkdir -p "$(dirname "$OUT")"
tmp_out="${OUT}.tmp"
trap 'rm -f "$tmp_out"' EXIT
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$tmp_out"
test -s "$tmp_out"
mv "$tmp_out" "$OUT"
trap - EXIT
echo "Backup written to $OUT"
