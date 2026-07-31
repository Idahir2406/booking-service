#!/usr/bin/env bash
# Sincroniza LOCAL → PRODUCCIÓN (reemplaza por completo el schema public en prod).
#
# Uso:
#   ./scripts/db-sync/local-to-production.sh
#
# Variables:
#   LOCAL  ← .env (POSTGRES_*) o db-sync.env (LOCAL_*)
#   PROD   ← .env (DATABASE_MIGRATIONS_URL) o db-sync.env (PROD_*)
#
# Flags vía env:
#   SKIP_CONFIRM=1  no pide confirmación
#   SKIP_BACKUP=1   no hace backup previo de prod

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_commands

print_connection_summary \
  "LOCAL  ${LOCAL_HOST}:${LOCAL_PORT}/${LOCAL_DB} (user=${LOCAL_USER})" \
  "PROD   ${PROD_HOST}:${PROD_PORT}/${PROD_DB} (user=${PROD_USER})"

confirm_destructive \
  "Se eliminará el schema public en PRODUCCIÓN y se copiarán todos los datos desde LOCAL."

maybe_backup \
  "$PROD_HOST" "$PROD_PORT" "$PROD_USER" "$PROD_PASSWORD" "$PROD_DB" \
  "prod_before_local_sync"

reset_public_schema \
  "$PROD_HOST" "$PROD_PORT" "$PROD_USER" "$PROD_PASSWORD" "$PROD_DB" \
  "producción"

pipe_dump_to_target \
  "$LOCAL_HOST" "$LOCAL_PORT" "$LOCAL_USER" "$LOCAL_PASSWORD" "$LOCAL_DB" \
  "$PROD_HOST" "$PROD_PORT" "$PROD_USER" "$PROD_PASSWORD" "$PROD_DB" \
  "local" "producción"

echo ""
echo "✅ Sincronización LOCAL → PRODUCCIÓN finalizada."
